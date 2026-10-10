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
const imagesURL = (ep) => `${normalizeEndpoint(ep)}/v1/images/generations`;
// ComfyUI REST (backend 'comfyui'): queue → poll → download.
const comfyPromptURL = (ep) => `${normalizeEndpoint(ep)}/prompt`;
const comfyHistoryURL = (ep, id) => `${normalizeEndpoint(ep)}/history/${encodeURIComponent(id)}`;
const comfyViewURL = (ep, img) => `${normalizeEndpoint(ep)}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=${encodeURIComponent(img.type ?? 'output')}`;
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

// Per-role connection overrides (Settings → Connection → Role connections):
// each role may carry its own endpoint+key pair ('aux'/'gen'/'embed'/'image'
// → <role>Endpoint/<role>ApiKey). Resolution walks the role chain and takes
// the first non-blank value PER FIELD, ending at the main connection — an
// endpoint-only override inherits the key, exactly like the long-standing
// image connection. Chains mirror the model fallbacks: the generator resolves
// ('gen','aux') → main, aux roles ('aux') → main, embeddings/images their own
// role → main; no roles = the main connection verbatim.
function roleConn(st, ...roles) {
  const pick = (suffix, main) => {
    for (const r of roles) {
      const v = String(st?.[`${r}${suffix}`] ?? '').trim();
      if (v) return v;
    }
    return String(main ?? '');
  };
  return { endpoint: pick('Endpoint', st?.endpoint), apiKey: pick('ApiKey', st?.apiKey) };
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
// once without it so the browser's cached Basic creds take over. Only OUR
// server's own 401s (tagged X-FictionPad-Auth) trigger the bare retry: an
// upstream LLM 401 passed through the proxy is a real credential failure
// whose error body must surface to the caller, not be retried bare.
// Direct (non-proxy) endpoints never retry: their Authorization is the LLM key.
async function fetchAPI(endpoint, url, opts = {}) {
  let res = await fetch(url, opts);
  if (res.status === 401 && isServerProxy(endpoint) && opts.headers?.Authorization
      && res.headers.get('X-FictionPad-Auth')) {
    const headers = { ...opts.headers };
    delete headers.Authorization;
    res = await fetch(url, { ...opts, headers });
  }
  return res;
}

// Returns { ids, ctxs }: sorted model ids, plus per-model context lengths
// from vendor extensions to the OpenAI model card — vLLM `max_model_len`,
// llama.cpp `n_ctx` (nested under `meta` on current builds), OpenRouter
// `context_length` (absent elsewhere → {}).
async function listModels({ endpoint, apiKey, serverToken, signal } = {}) {
  const res = await fetchAPI(endpoint, modelsURL(endpoint), { headers: { ...authHeaders(apiKey, endpoint, serverToken) }, signal });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const json = await res.json(); msg = json?.error?.message ?? json?.message ?? msg; } catch {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const ids = [], ctxs = {};
  for (const m of json.data ?? []) {
    if (!m?.id) continue;
    ids.push(m.id);
    const ctx = Number(m.max_model_len ?? m.n_ctx ?? m.meta?.n_ctx ?? m.context_length);
    if (Number.isFinite(ctx) && ctx > 0) ctxs[m.id] = ctx;
  }
  return { ids: ids.sort(), ctxs };
}

// Error for a non-OK API response. An OpenAI-style JSON error body wins;
// otherwise a plain-text body is used verbatim (truncated) — the FictionPad
// /proxy route rejects with text/plain (e.g. the FICTIONPAD_PROXY_ALLOW 403)
// and that reason must reach the user. A body-less or message-less JSON
// response keeps "HTTP <status>".
async function apiHttpError(res) {
  let msg = `HTTP ${res.status}`;
  try {
    const text = (await res.text()).trim();
    if (text) {
      let jsonMsg = null;
      try { const j = JSON.parse(text); jsonMsg = j?.error?.message ?? j?.message ?? null; } catch {}
      if (jsonMsg) msg = String(jsonMsg);
      else if (!text.startsWith('{') && !text.startsWith('['))
        msg = text.length > 300 ? `${text.slice(0, 300)}…` : text;
    }
  } catch {}
  const err = new Error(msg);
  err.status = res.status; // lets callers special-case e.g. a 400 about stop strings
  return err;
}

// Human-readable API failure for banners and the settings test button — a
// bare "401" tells the user nothing; name the likely cause and where to fix it.
function describeApiError(e) {
  const status = e?.status;
  const msg = String(e?.message ?? e);
  const detail = msg && !/^HTTP \d+$/.test(msg) ? ` — ${msg}` : '';
  if (status === 401) return `401 Unauthorized${detail}. The API key is missing or was rejected — check Settings → Connection.`;
  if (status === 403) return `403 Forbidden${detail}.${detail ? '' : ' The key lacks access, or the server refused the request.'}`;
  if (status === 404) return `404 Not Found${detail}. The endpoint URL looks wrong — expected an OpenAI-compatible server (…/v1).`;
  if (status === 429) return `429 Too Many Requests${detail}. Rate-limited by the backend — wait a moment and retry.`;
  if (status != null) return `HTTP ${status}${detail}`;
  if (/failed to fetch|networkerror|load failed/i.test(msg))
    return 'Could not reach the endpoint — is it running, and is the URL right? (A cross-origin server may need "Route API requests through this server".)';
  return msg;
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
//   { think }    — reasoning text (delta.reasoning_content / delta.reasoning,
//                  vLLM/DeepSeek/OpenRouter convention); displayed, never prompted
//   { usage }    — { prompt, completion } token counts from the trailing
//                  usage-only chunk (stream_options.include_usage); absent
//                  when the backend doesn't report usage
// Consumers display/accumulate content and collect the lp tape separately;
// alignment against the text happens ONCE, globally, via alignTokensToSpans.
async function* openaiChatStream({ endpoint, apiKey, serverToken, model, messages, samplers = {}, maxTokens, signal, tokenProbs = false, topLogprobs = 10, logitBias = null, stop = null, usageStats = true }) {
  const stopSet = Array.isArray(stop) && stop.length ? new Set(stop) : null;
  // Client-side stop filter (fallback — backends normally strip server-side).
  // A stop string split across chunks must not leak into the display text or
  // the tape, so the stream holds back the longest tail that could still grow
  // INTO a stop string (bounded by the longest one) and emits only the text
  // before it; the tail flushes at stream end, minus any complete stop
  // string it turned out to hold. (On abort the held tail is simply dropped.)
  const stopList = stopSet ? [...stopSet].filter(s => typeof s === 'string' && s) : null;
  const maxStop = stopList?.length ? Math.max(...stopList.map(s => s.length)) : 0;
  // Longest suffix of s (≤ maxStop chars) that starts some stop string —
  // equality counts, so a stop string arriving whole at the tail is held too.
  const stopTail = maxStop ? (s) => {
    for (let len = Math.min(s.length, maxStop); len > 0; len--) {
      const tail = s.slice(-len);
      for (const st of stopList) if (st.startsWith(tail)) return tail;
    }
    return '';
  } : null;
  // Earliest index any stop string occurs at in s, -1 when none (flush cut).
  const stopCut = maxStop ? (s) => {
    let cut = -1;
    for (const st of stopList) {
      const i = s.indexOf(st);
      if (i !== -1 && (cut === -1 || i < cut)) cut = i;
    }
    return cut;
  } : null;
  let heldText = '';  // held-back content tail (split stop-string guard)
  const lpHeld = [];  // the same guard for the logprob tape
  const res = await fetchAPI(endpoint, chatCompletionsURL(endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint, serverToken) },
    body: JSON.stringify({
      // expandSamplerParams: dotted custom-sampler keys (e.g.
      // chat_template_kwargs.enable_thinking) become nested objects.
      model, messages, stream: true, max_tokens: maxTokens, ...expandSamplerParams(samplers),
      ...(tokenProbs ? { logprobs: true, top_logprobs: Math.max(1, Math.min(20, topLogprobs | 0 || 10)) } : {}),
      ...(logitBias && Object.keys(logitBias).length ? { logit_bias: logitBias } : {}),
      ...(stopSet ? { stop } : {}),
      // Usage reporting: backends that don't know stream_options either ignore
      // it or 400 — the caller retries once without it on a 400 naming it.
      ...(usageStats ? { stream_options: { include_usage: true } } : {}),
    }),
    signal,
  });
  if (!res.ok) throw await apiHttpError(res);
  for await (const json of parseEventStream(res.body)) {
    // The trailing usage-only chunk (stream_options.include_usage) arrives
    // with choices: [] — capture the counts BEFORE the choices gate below.
    if (json.usage) yield { usage: {
      prompt: json.usage.prompt_tokens ?? null,
      completion: json.usage.completion_tokens ?? null,
    } };
    const choice = json.choices?.[0];
    // Chunks with no choices left (the usage-only chunk, keepalives) carry
    // nothing more to yield — skip them.
    if (!choice) continue;
    // delta.content is the text authority — logprobs never alter it.
    const deltaText = choice?.delta?.content ?? choice?.message?.content;
    // Reasoning channel (vLLM/DeepSeek/OpenRouter): own field, never part of
    // content. Yielded separately so the caller can show it collapsibly.
    const thinkText = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning
      ?? choice?.message?.reasoning_content;
    if (thinkText) yield { think: thinkText };
    // Terminal chunk: report the finish reason so the caller can tell a clean
    // finish from a dropped connection (stream that just ends). A finish
    // chunk with empty/missing delta carries the sampled EOS in logprobs —
    // yield neither text nor tape for it.
    if (choice.finish_reason) {
      yield { done: true, finishReason: choice.finish_reason };
      if (!deltaText) continue;
    }
    if (deltaText) {
      if (!stopTail) yield { content: deltaText };
      // A chunk that IS exactly a stop string is dropped outright, anywhere in
      // the stream — the hold-back guard only covers split/tail cases and
      // would re-emit an exact match once more text follows.
      else if (stopSet.has(deltaText) && !heldText) { /* dropped */ }
      else {
        const combined = heldText + deltaText;
        heldText = stopTail(combined);
        if (combined.length > heldText.length)
          yield { content: combined.slice(0, combined.length - heldText.length) };
      }
    }
    // vLLM/OpenAI put logprobs at choice level; tolerate delta-nested too.
    const lpContent = choice?.logprobs?.content ?? choice?.delta?.logprobs?.content;
    if (Array.isArray(lpContent) && lpContent.length) {
      const tape = [];
      for (const t of lpContent) {
        if (!t?.token) continue;
        if (stopSet?.has(t.token)) continue; // whole-token stop match, anywhere in the stream
        tape.push({
          token: t.token,
          logprob: t.logprob ?? null,
          top: (t.top_logprobs ?? []).slice(0, Math.max(1, Math.min(20, topLogprobs | 0 || 10)))
            .map(x => ({ token: x.token, logprob: x.logprob ?? null })),
        });
      }
      if (tape.length) {
        if (!stopTail) yield { lp: tape };
        else {
          // Hold back enough trailing entries to cover a stop string still
          // split across them; release the rest — their text can no longer
          // be part of one.
          lpHeld.push(...tape);
          let total = 0;
          for (const e of lpHeld) total += e.token.length;
          const keep = stopTail(lpHeld.map(e => e.token).join('')).length;
          let n = 0;
          while (n < lpHeld.length && total - lpHeld[n].token.length >= keep)
            total -= lpHeld[n++].token.length;
          if (n) yield { lp: lpHeld.splice(0, n) };
        }
      }
    }
  }
  // Stream end: flush the held tails. A complete stop string inside is the
  // backend's unstripped stop marker — cut from its first occurrence; a
  // shorter tail is real text that merely prefixed a stop string.
  if (heldText) {
    const cut = stopCut(heldText);
    const out = cut === -1 ? heldText : heldText.slice(0, cut);
    if (out) yield { content: out };
  }
  if (lpHeld.length) {
    const joined = lpHeld.map(e => e.token).join('');
    const cut = stopCut(joined);
    let out = lpHeld;
    if (cut !== -1) {
      // Keep the entries starting before the cut; a token straddling the
      // boundary is approximated away by the global alignment pass.
      out = [];
      let acc = 0;
      for (const e of lpHeld) { if (acc >= cut) break; out.push(e); acc += e.token.length; }
    }
    if (out.length) yield { lp: out };
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
//   tape-longer — reasoning-model backends may logprob the RAW output:
//            the tape then carries think/marker tokens the content never
//            shows. Text is an in-order subsequence of such a tape, so
//            unmatched tape entries are DROPPED (never misattributed).
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
  // Tape longer than the text (think tokens mixed in): fast case first — if
  // the text is a suffix of the tape on a token boundary, drop the leading
  // junk wholesale (reasoning always streams before content).
  if (joined.endsWith(text)) {
    const dropLen = joined.length - text.length;
    let accLen = 0, k = 0;
    while (k < toks.length && accLen < dropLen) accLen += toks[k++].token.length;
    if (accLen === dropLen) return toks.slice(k).map(span);
  }
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
  // Drop-tolerant fallback for interleaved junk the greedy pass can't resync
  // around: discard tape entries that don't match at the cursor (first match
  // wins — content is an in-order subsequence of the tape). Used only when it
  // covers strictly more of the text with real probs than the greedy pass.
  const coverage = (sp) => sp.reduce((n, s) => n + (s.logprob != null ? s.text.length : 0), 0);
  const baseCov = coverage(spans);
  if (baseCov >= text.length) return spans;
  const alt = [];
  {
    let aPos = 0, aI = 0, aGap = '';
    const aFlush = () => { if (aGap) { alt.push(plain(aGap)); aGap = ''; } };
    while (aPos < text.length) {
      let j = aI;
      while (j < toks.length && !text.startsWith(toks[j].token, aPos)) j++;
      if (j >= toks.length) { aGap += text.slice(aPos); break; }
      aFlush();
      alt.push(span(toks[j]));
      aPos += toks[j].token.length;
      aI = j + 1;
    }
    aFlush();
  }
  return coverage(alt) > baseCov ? alt : spans;
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
// count-only {count}, or OpenAI-ish {data:{tokens}}. Cached per endpoint+model+text
// (keyed by textHash — full prompt text must never sit in the cache key).
// Aborts (generation Stop) return null WITHOUT caching — a canceled count
// isn't a "tokenize unavailable" verdict. Neither is a transient failure
// (network blip, 5xx): only a definitive HTTP answer is cached, so one
// hiccup doesn't poison the key into estimates for the rest of the session.
const tokenizeCache = new Map();
async function tokenize({ endpoint, apiKey, serverToken, model, prompt, signal }) {
  const key = `${endpoint}|${model}|${textHash(prompt)}`;
  if (tokenizeCache.has(key)) return tokenizeCache.get(key);
  if (tokenizeCache.size > 500) tokenizeCache.clear();
  let out = null, cacheable = false;
  try {
    const res = await fetchAPI(endpoint, `${normalizeEndpoint(endpoint)}/tokenize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint, serverToken) },
      body: JSON.stringify({ model, prompt }),
      signal,
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
    // Definitive answers only: ok, or a client-error status meaning this
    // endpoint doesn't do /tokenize. A 5xx stays uncached (retried next time).
    cacheable = res.ok || [400, 404, 405, 501].includes(res.status);
  } catch (e) {
    if (e?.name === 'AbortError') return null;
  }
  if (cacheable) tokenizeCache.set(key, out);
  return out;
}

async function getTokenCount({ endpoint, apiKey, serverToken, model, text, signal }) {
  const r = await tokenize({ endpoint, apiKey, serverToken, model, prompt: text, signal });
  return r?.count ?? null;
}

// ---- /embeddings (OpenAI-style; semantic lore activation) ----
// Similarity threshold for smart lore activation — tune in one place.
const SEMANTIC_THRESHOLD = 0.55;
// Session-lifetime cache for piece embeddings: endpoint|model|hash(text) →
// vector. Endpoint is in the key like tokenizeCache — switching embedding
// backends mid-session must not reuse the old backend's vectors.
const embedCache = new Map();
const textHash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h.toString(36);
};

async function embed({ endpoint, apiKey, serverToken, model, inputs, signal }) {
  const res = await fetchAPI(endpoint, `${normalizeEndpoint(endpoint)}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint, serverToken) },
    body: JSON.stringify({ model, input: inputs }),
    signal,
  });
  if (!res.ok) throw await apiHttpError(res);
  const json = await res.json();
  if (!Array.isArray(json?.data)) throw new Error('Malformed embeddings response');
  return [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(d => d.embedding);
}

// Cached single-text embedding (piece match texts change rarely).
async function embedCached({ endpoint, apiKey, serverToken, model, text, signal }) {
  const key = `${endpoint}|${model}|${textHash(text)}`;
  if (embedCache.has(key)) return embedCache.get(key);
  if (embedCache.size > 500) embedCache.clear();
  const [vec] = await embed({ endpoint, apiKey, serverToken, model, inputs: [text], signal });
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
// suggestions, /improve, ✦ generator). Returns trimmed text; throws on
// HTTP/API errors. `samplers` (optional) is merged into the request like the
// streaming path does — dotted custom-sampler keys nest (expandSamplerParams).
// `signal` (optional) aborts the call — the composer's Stop aborts all
// in-flight aux calls.
async function auxCall({ endpoint, apiKey, serverToken, model, system, user, maxTokens = 300, temperature = 0.7, stop = null, samplers = null, signal = null }) {
  const res = await fetchAPI(endpoint, chatCompletionsURL(endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint, serverToken) },
    ...(signal ? { signal } : {}),
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
      ...(samplers ? expandSamplerParams(samplers) : {}),
    }),
  });
  if (!res.ok) throw await apiHttpError(res);
  const json = await res.json();
  if (json?.error?.message) throw new Error(json.error.message);
  return String(json.choices?.[0]?.message?.content ?? '').trim();
}

// ---- /images/generations (OpenAI-compatible; /image command) ----
// One image per call, returned as a data URL at the backend's native
// resolution and format — no downscale, no re-encode: imageSize is the
// user's explicit size control, so a 960x1440 PNG render stays exactly that.
// b64_json is the primary shape; a url response is fetched and converted
// (through our own /proxy when the request went through it, so an absolute
// image URL on a CORS-less host still loads). The LLM key is never sent on
// the url fetch — image CDNs don't need it and it must not leak off-origin.
async function generateImage({ endpoint, apiKey, serverToken, model, prompt, size, signal, prefix = '', backend = 'openai', workflow = '', negative = '' }) {
  if (backend === 'comfyui')
    return generateComfyImage({ endpoint, apiKey, serverToken, workflow, prompt, negative, size, signal, prefix });
  const res = await fetchAPI(endpoint, imagesURL(endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint, serverToken) },
    ...(signal ? { signal } : {}),
    body: JSON.stringify({
      prompt: imagePromptWithPrefix(prefix, prompt),
      ...(model ? { model } : {}),
      ...(size ? { size } : {}),
      response_format: 'b64_json',
    }),
  });
  if (!res.ok) throw await apiHttpError(res);
  const json = await res.json();
  if (json?.error?.message) throw new Error(json.error.message);
  const item = json?.data?.[0];
  let dataURL;
  if (item?.b64_json) {
    dataURL = `data:image/png;base64,${item.b64_json}`;
  } else if (item?.url) {
    // The proxy target is the part after /proxy/; the image fetch reuses that
    // shape with the image URL as the target (server.mjs decodes it whole).
    const u = String(item.url);
    const proxied = isServerProxy(endpoint) && /^https?:\/\//i.test(u) ? `/proxy/${u}` : u;
    const imgRes = await fetchAPI(endpoint, proxied, {
      headers: { ...(serverToken && isServerProxy(endpoint) ? { 'Authorization': `Bearer ${serverToken}` } : {}) },
      ...(signal ? { signal } : {}),
    });
    if (!imgRes.ok) {
      const err = new Error(`image fetch failed (HTTP ${imgRes.status})`);
      err.status = imgRes.status;
      throw err;
    }
    const blob = await imgRes.blob();
    dataURL = await blobToDataURL(blob);
  } else {
    throw new Error('Malformed images response — no b64_json or url in data[0]');
  }
  return dataURL;
}

const blobToDataURL = (blob) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result));
  fr.onerror = () => reject(new Error('could not read the image response'));
  fr.readAsDataURL(blob);
});

// ---- ComfyUI backend (settings.imageBackend === 'comfyui') ----
// Queue the substituted workflow, poll /history until the run lands, then
// download the first output image from /view. Same native-resolution
// data-URL contract as the OpenAI path (no downscale, no re-encode).
// ComfyUI answers identical graphs from its cache, so the
// history is checked BEFORE the first sleep — a cached run returns at once.
// The workflow comes from settings.imageWorkflow (web UI "Save (API Format)"
// export); substitution + seed rules live in substituteComfyWorkflow (core).
async function generateComfyImage({ endpoint, apiKey, serverToken, workflow, prompt, negative, size, signal, prefix = '', timeoutMs = 300000 }) {
  let graph;
  try { graph = JSON.parse(String(workflow ?? '')); } catch {
    throw new Error('The ComfyUI workflow in Settings is not valid JSON — paste the "Save (API Format)" export.');
  }
  const { width, height } = parseImageSize(size);
  const payload = substituteComfyWorkflow(graph, {
    prompt: imagePromptWithPrefix(prefix, prompt), negative, width, height });
  const headers = { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint, serverToken) };
  const res = await fetchAPI(endpoint, comfyPromptURL(endpoint), {
    method: 'POST', headers, ...(signal ? { signal } : {}),
    body: JSON.stringify({ prompt: payload }),
  });
  if (!res.ok) throw await apiHttpError(res);
  const queued = await res.json();
  const promptId = queued?.prompt_id;
  if (!promptId) throw new Error('ComfyUI did not return a prompt_id — is this a ComfyUI server?');
  const deadline = Date.now() + timeoutMs;
  const sleep = (ms) => new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason ?? new Error('aborted')); }, { once: true });
  });
  for (;;) {
    const hRes = await fetchAPI(endpoint, comfyHistoryURL(endpoint, promptId), {
      headers: { ...authHeaders(apiKey, endpoint, serverToken) }, ...(signal ? { signal } : {}) });
    if (!hRes.ok) {
      const err = new Error(`HTTP ${hRes.status}`);
      err.status = hRes.status;
      throw err;
    }
    const result = comfyHistoryResult(await hRes.json(), promptId);
    if (result.error) throw new Error(result.error);
    if (result.done && result.image) {
      // /view authenticates exactly like /prompt above (the configured image
      // key belongs to this host; through our proxy it maps as usual).
      const imgRes = await fetchAPI(endpoint, comfyViewURL(endpoint, result.image), {
        headers: { ...authHeaders(apiKey, endpoint, serverToken) }, ...(signal ? { signal } : {}) });
      if (!imgRes.ok) {
        const err = new Error(`image fetch failed (HTTP ${imgRes.status})`);
        err.status = imgRes.status;
        throw err;
      }
      return blobToDataURL(await imgRes.blob());
    }
    if (Date.now() > deadline) throw new Error('ComfyUI timed out — the run never landed in history');
    await sleep(1500);
  }
}

