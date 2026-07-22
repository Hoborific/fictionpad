// ============================================================================
// BACKEND — OpenAI-compatible chat completions only. Endpoint normalization,
// hand-rolled SSE parser, AbortController cancel, normalized { content } chunks.
// ============================================================================
function normalizeEndpoint(url) {
  return String(url ?? '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1\/(chat\/completions|models)$/i, '')
    .replace(/\/v1$/i, '');
}
const chatCompletionsURL = (ep) => `${normalizeEndpoint(ep)}/v1/chat/completions`;
const modelsURL = (ep) => `${normalizeEndpoint(ep)}/v1/models`;
// True when the endpoint goes through OUR server's /proxy/ (same-origin).
// Relative '/proxy/…' is same-origin by construction; absolute URLs must match.
function isServerProxy(endpoint) {
  const ep = String(endpoint ?? '');
  if (ep.startsWith('/proxy/')) return true;
  try {
    const u = new URL(ep, location.href);
    return u.origin === location.origin && u.pathname.startsWith('/proxy/');
  } catch { return false; }
}

// "Route API requests through the server": rewrite the configured endpoint to
// a relative /proxy/ URL at request time (never persisted). Only when server
// storage is active AND the toggle is on; empty and hand-written /proxy/
// endpoints pass through unchanged.
function effectiveEndpoint(settings, serverStorageActive) {
  const ep = String(settings?.endpoint ?? '');
  if (!ep || ep.startsWith('/proxy/')) return ep;
  return serverStorageActive && settings?.routeViaServer !== false ? `/proxy/${ep}` : ep;
}

// LLM credential header. Through our own (possibly Basic-authed) proxy the
// browser already attaches the server's Basic creds to same-origin fetches —
// so the LLM key travels as X-Real-Authorization, which the proxy maps to the
// upstream Authorization header (and never leaks the Basic creds upstream).
// When the server instead gates with FICTIONPAD_TOKEN (Bearer, no Basic), the
// proxy requires that token too — send serverToken as Authorization, exactly
// like the storage routes do.
const authHeaders = (apiKey, endpoint, serverToken = '') => {
  if (!isServerProxy(endpoint)) return apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};
  return {
    ...(apiKey ? { 'X-Real-Authorization': `Bearer ${apiKey}` } : {}),
    ...(serverToken ? { 'Authorization': `Bearer ${serverToken}` } : {}),
  };
};

// Same-origin /proxy requests carry the serverToken as Bearer; on a
// Basic-auth deployment (or with a stale token) that Bearer 401s — retry
// once without it so the browser's cached Basic creds take over. Direct
// (non-proxy) endpoints never retry: their Authorization is the LLM key.
async function fetchAPI(endpoint, url, opts = {}) {
  let res = await fetch(url, opts);
  if (res.status === 401 && isServerProxy(endpoint) && opts.headers?.Authorization) {
    const headers = { ...opts.headers };
    delete headers.Authorization;
    res = await fetch(url, { ...opts, headers });
  }
  return res;
}

async function listModels({ endpoint, apiKey, serverToken, signal } = {}) {
  const res = await fetchAPI(endpoint, modelsURL(endpoint), { headers: { ...authHeaders(apiKey, endpoint, serverToken) }, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return (json.data ?? []).map(m => m.id).filter(Boolean).sort();
}

// Minimal SSE parser: line-based, only data: fields, JSON payloads.
// getReader()+TextDecoder instead of pipeThrough(TextDecoderStream): some
// mobile WebKit builds lack ReadableStream.pipeThrough / TextDecoderStream.
async function* parseEventStream(body) {
  let buf = '';
  const take = function* (line) {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    const json = JSON.parse(data);
    if (json.error?.message) throw new Error(json.error.message);
    yield json;
  };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = (buf + decoder.decode(value, { stream: true })).split(/\r\n|\r|\n/);
      buf = lines.pop();
      for (const line of lines) yield* take(line);
    }
    buf += decoder.decode();
    if (buf) yield* take(buf);
  } finally {
    reader.releaseLock();
  }
}

// Normalized async-generator chunk stream. Two separate streams, because a
// chunk's delta text and its logprob tokens are NOT reliably related (a
// middleware may re-chunk deltas into arbitrary byte windows and attach
// logprob entries off by one position — observed in the wild):
//   { content }  — display text; delta.content is the sole authority
//   { lp: [{ token, logprob, top }] } — raw logprob tape entries, no content
// Consumers display/accumulate content and collect the lp tape separately;
// alignment against the text happens ONCE, globally, via alignTokensToSpans.
async function* openaiChatStream({ endpoint, apiKey, serverToken, model, messages, samplers = {}, maxTokens, signal, tokenProbs = false, topLogprobs = 10, logitBias = null, stop = null }) {
  const stopSet = Array.isArray(stop) && stop.length ? new Set(stop) : null;
  const res = await fetchAPI(endpoint, chatCompletionsURL(endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint, serverToken) },
    body: JSON.stringify({
      model, messages, stream: true, max_tokens: maxTokens, ...samplers,
      ...(tokenProbs ? { logprobs: true, top_logprobs: Math.max(1, Math.min(20, topLogprobs | 0 || 10)) } : {}),
      ...(logitBias && Object.keys(logitBias).length ? { logit_bias: logitBias } : {}),
      ...(stopSet ? { stop } : {}),
    }),
    signal,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const json = await res.json();
      msg = json?.error?.message ?? json?.message ?? msg;
    } catch {}
    throw new Error(msg);
  }
  for await (const json of parseEventStream(res.body)) {
    const choice = json.choices?.[0];
    // Chunks with no choices (e.g. a trailing usage-only chunk with
    // choices: []) carry nothing to yield — skip them.
    if (!choice) continue;
    // delta.content is the text authority — logprobs never alter it.
    const deltaText = choice?.delta?.content ?? choice?.message?.content;
    // Terminal chunk: report the finish reason so the caller can tell a clean
    // finish from a dropped connection (stream that just ends). A finish
    // chunk with empty/missing delta carries the sampled EOS in logprobs —
    // yield neither text nor tape for it.
    if (choice.finish_reason) {
      yield { done: true, finishReason: choice.finish_reason };
      if (!deltaText) continue;
    }
    if (deltaText && !stopSet?.has(deltaText)) yield { content: deltaText };
    // vLLM/OpenAI put logprobs at choice level; tolerate delta-nested too.
    const lpContent = choice?.logprobs?.content ?? choice?.delta?.logprobs?.content;
    if (Array.isArray(lpContent) && lpContent.length) {
      const tape = lpContent.filter(t => t?.token && !stopSet?.has(t.token)).map(t => ({
        token: t.token,
        logprob: t.logprob ?? null,
        top: (t.top_logprobs ?? []).slice(0, Math.max(1, Math.min(20, topLogprobs | 0 || 10)))
          .map(x => ({ token: x.token, logprob: x.logprob ?? null })),
      }));
      if (tape.length) yield { lp: tape };
    }
  }
}

// Global alignment of the raw lp tape against the finished message text.
// Returns ProbsView spans [{ text, logprob, top }] covering `text` exactly,
// in order; spans without prob data get logprob: null. Runs once per
// generation (or abort), when both tapes are complete and alignment is
// unambiguous for the anchored cases:
//   exact  — tape tiles the text (healthy per-token streams)
//   suffix — tape covers the tail (middleware dropped leading entries, or
//            attached them off-by-one: tape = text minus a leading span)
//   prefix — tape covers the head only
//   greedy — anything else: match tokens in order, plain text in the gaps
function alignTokensToSpans(text, lpTape) {
  const toks = (lpTape ?? []).filter(t => t?.token);
  if (!text) return [];
  if (!toks.length) return [{ text, logprob: null, top: [] }];
  const plain = (text) => ({ text, logprob: null, top: [] });
  const span = (t) => ({ text: t.token, logprob: t.logprob ?? null, top: t.top ?? [] });
  const joined = toks.map(t => t.token).join('');
  if (joined === text) return toks.map(span);
  if (text.endsWith(joined)) {
    const pre = text.slice(0, text.length - joined.length);
    return [...(pre ? [plain(pre)] : []), ...toks.map(span)];
  }
  if (text.startsWith(joined)) return [...toks.map(span), plain(text.slice(joined.length))];
  const spans = [];
  let pos = 0, i = 0, gap = '';
  const flush = () => { if (gap) { spans.push(plain(gap)); gap = ''; } };
  while (pos < text.length) {
    if (i < toks.length && text.startsWith(toks[i].token, pos)) {
      flush();
      const t = toks[i++];
      spans.push(span(t));
      pos += t.token.length;
    } else {
      // Resync: find the best next match over a small lookahead, scored by
      // text gap + a cost per skipped tape entry. Without the skip cost a
      // dropped lp entry lets a DISTANT token (e.g. an "I" 100 tokens later)
      // match the current position and misaligns the rest of the message.
      let bestK = -1, bestJ = -1, bestScore = Infinity;
      for (let j = i; j < Math.min(toks.length, i + 5); j++) {
        let k = -1;
        if (j > i && text.startsWith(toks[j].token, pos)) k = pos; // drop tape entr(ies)
        else k = text.indexOf(toks[j].token, pos + 1);             // text gap, then match
        if (k === -1) continue;
        const score = (k - pos) + 4 * (j - i);
        if (score < bestScore) { bestScore = score; bestK = k; bestJ = j; }
      }
      const end = bestK === -1 ? text.length : bestK;
      gap += text.slice(pos, end);
      pos = end;
      if (bestK === -1) break;
      i = bestJ;
    }
  }
  flush();
  return spans;
}

// Tool replies: align the raw lp tape against the RAW text (which it tiles
// exactly), then project the spans through stripToolBlocksMapped's char map
// onto the stripped display text. Protocol-text spans vanish; a token that
// straddles a strip boundary keeps its prob on the surviving fragment(s)
// (approximation — fences almost always tokenize separately).
//   rawText  — the raw streamed text being aligned (may be a slice)
//   map      — map[strippedIdx] = rawIdx, absolute in the FULL raw reply
//   rawOffset — absolute raw index of rawText[0] (continuation base length)
// Returns spans tiling the stripped text, or null when they don't (map
// mismatch — caller falls back to plain alignment).
function alignStrippedToolSpans(rawText, lpTape, map, rawOffset, strippedText) {
  const rawSpans = alignTokensToSpans(rawText, lpTape);
  const inv = new Int32Array(rawOffset + rawText.length).fill(-1); // rawIdx → strippedIdx
  for (let i = 0; i < map.length; i++) inv[map[i]] = i;
  const spans = [];
  const pushPlain = (t) => {
    if (!t) return;
    const last = spans[spans.length - 1];
    if (last && last.logprob == null) last.text += t;
    else spans.push({ text: t, logprob: null, top: [] });
  };
  let pos = 0;
  for (const s of rawSpans) {
    const a = pos, b = pos + s.text.length;
    pos = b;
    let frag = '';
    const flushFrag = () => {
      if (!frag) return;
      if (s.logprob == null) pushPlain(frag);
      else spans.push({ text: frag, logprob: s.logprob, top: s.top });
      frag = '';
    };
    for (let i = a; i < b; i++) {
      if (inv[rawOffset + i] !== -1) frag += rawText[i];
      else flushFrag();
    }
    flushFrag();
  }
  return spans.map(s => s.text).join('') === strippedText ? spans : null;
}

// ---- /tokenize (vLLM; degrade to null when unavailable) ----
// Defensive about response shapes: {tokens:[ids]}, {tokens:["str"]},
// count-only {count}, or OpenAI-ish {data:{tokens}}. Cached per endpoint+model+text.
const tokenizeCache = new Map();
async function tokenize({ endpoint, apiKey, serverToken, model, prompt }) {
  const key = `${endpoint}|${model}|${prompt}`;
  if (tokenizeCache.has(key)) return tokenizeCache.get(key);
  if (tokenizeCache.size > 500) tokenizeCache.clear();
  let out = null;
  try {
    const res = await fetchAPI(endpoint, `${normalizeEndpoint(endpoint)}/tokenize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint, serverToken) },
      body: JSON.stringify({ model, prompt }),
    });
    if (res.ok) {
      const json = await res.json();
      const raw = json?.tokens ?? json?.data?.tokens ?? null;
      let ids = null, strings = null, count = null;
      if (Array.isArray(raw)) {
        count = raw.length;
        if (raw.every(t => Number.isInteger(t))) ids = raw;
        else if (raw.every(t => typeof t === 'string')) strings = raw;
      }
      if (Number.isFinite(json?.count)) count = json.count;
      if (count != null || ids || strings) out = { ids, strings, count };
    }
  } catch {}
  tokenizeCache.set(key, out);
  return out;
}

async function getTokenCount({ endpoint, apiKey, serverToken, model, text }) {
  const r = await tokenize({ endpoint, apiKey, serverToken, model, prompt: text });
  return r?.count ?? null;
}

// ---- /embeddings (OpenAI-style; semantic lore activation) ----
// Similarity threshold for smart lore activation — tune in one place.
const SEMANTIC_THRESHOLD = 0.55;
// Session-lifetime cache for piece embeddings: model|hash(text) → vector.
const embedCache = new Map();
const textHash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h.toString(36);
};

async function embed({ endpoint, apiKey, serverToken, model, inputs }) {
  const res = await fetchAPI(endpoint, `${normalizeEndpoint(endpoint)}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint, serverToken) },
    body: JSON.stringify({ model, input: inputs }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const json = await res.json();
      msg = json?.error?.message ?? json?.message ?? msg;
    } catch {}
    throw new Error(msg);
  }
  const json = await res.json();
  if (!Array.isArray(json?.data)) throw new Error('Malformed embeddings response');
  return [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(d => d.embedding);
}

// Cached single-text embedding (piece match texts change rarely).
async function embedCached({ endpoint, apiKey, serverToken, model, text }) {
  const key = `${model}|${textHash(text)}`;
  if (embedCache.has(key)) return embedCache.get(key);
  if (embedCache.size > 500) embedCache.clear();
  const [vec] = await embed({ endpoint, apiKey, serverToken, model, inputs: [text] });
  embedCache.set(key, vec);
  return vec;
}

const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a?.length ?? 0, b?.length ?? 0);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
};

// Single NON-streaming chat completion for auxiliary tasks (memory, recap,
// suggestions, /improve). Returns trimmed text; throws on HTTP/API errors.
async function auxCall({ endpoint, apiKey, serverToken, model, system, user, maxTokens = 300, temperature = 0.7, stop = null }) {
  const res = await fetchAPI(endpoint, chatCompletionsURL(endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint, serverToken) },
    body: JSON.stringify({
      model,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: user },
      ],
      stream: false,
      max_tokens: maxTokens,
      temperature,
      ...(Array.isArray(stop) && stop.length ? { stop } : {}),
    }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const json = await res.json();
      msg = json?.error?.message ?? json?.message ?? msg;
    } catch {}
    throw new Error(msg);
  }
  const json = await res.json();
  if (json?.error?.message) throw new Error(json.error.message);
  return String(json.choices?.[0]?.message?.content ?? '').trim();
}

