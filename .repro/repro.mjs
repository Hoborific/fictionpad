// Repro harness for Bug 1 (Context Inspector preview blanks the page).
// Transforms fictionpad.html's module script for Node, then exercises the
// exact "Preview current context" path: assemblePrompt(...) -> render
// <ContextInspector> with react-dom/server. Any render throw is fatal here,
// just like it is to the React root in the browser (no error boundary).
import { readFileSync, writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';

let src = readFileSync(new URL('../fictionpad.html', import.meta.url), 'utf8');
src = src.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
// Neutralize the browser boot line; export what we need instead.
src = src.replace(/createRoot\(document\.getElementById\('root'\)\)\.render[\s\S]*$/, `
export { ContextInspector, MessageItem, Markdown, assemblePrompt, ProbsView,
  openaiChatStream, tokenize, getTokenCount, embed, embedCached, cosine, SEMANTIC_THRESHOLD,
  effectiveEndpoint, html };`);
writeFileSync(new URL('./fp-module.mjs', import.meta.url), src);

const fp = await import('./fp-module.mjs');
const { ContextInspector, MessageItem, Markdown, assemblePrompt, html } = fp;

const node = (id, parentId, role, text, createdAt = 1) => ({
  id, parentId, role, activeSwipe: 0, edited: false,
  swipes: [{ text, createdAt, modelId: 'test-model' }],
});

function makeFixture(overrides = {}) {
  const scenario = {
    id: 'S', name: 'Veyra', description: '', tags: [],
    backstory: 'A floating city.', greeting: 'Welcome, {{user}}.',
    scenarioInstructions: 'Second person.',
    lorePieces: [
      { id: 'L1', type: 'character', title: 'Vex', content: 'A smuggler.', keys: ['vex'], pinned: true, weight: 1, links: [], enabled: true, searchDepth: null },
      { id: 'L2', type: 'lore', title: 'Docks', content: 'Sky docks.', keys: ['dock'], pinned: false, weight: 0, links: ['L1'], enabled: true, searchDepth: null },
    ],
    ...overrides.scenario,
  };
  const persona = { id: 'P', name: 'Ari', description: 'a courier' };
  const chat = {
    id: 'C', scenarioId: 'S', personaId: 'P', customInstructions: '',
    rootMessageId: 'root', activeLeafId: 'a1',
    messages: {
      root: node('root', null, 'assistant', 'Welcome, {{user}}.'),
      u1: node('u1', 'root', 'user', 'I head to the dock.'),
      a1: node('a1', 'u1', 'assistant', '*Vex grins.* "About time."'),
    },
    memoryStore: { memories: [
      { id: 'memA1', text: 'Ari owes Vex money.', pinned: true, createdAt: 1 },
      { id: 'memB2', text: 'The crew left.', pinned: false, createdAt: 2 },
    ], cursor: 0 },
    ...overrides.chat,
  };
  const settings = { contextLength: 8192, maxTokens: 400, responseLength: 'medium', samplers: {} };
  return { scenario, persona, chat, settings, platformPrompt: 'RP prompt.' };
}

let failures = 0;
const trials = [];
function trial(name, fn) { trials.push([name, fn]); }

// The exact onPreview path, then render the inspector with the result.
function previewAndRender(fixture) {
  const { manifest } = assemblePrompt(fixture); // == onPreview body (post-fix)
  return renderToStaticMarkup(
    html`<${ContextInspector} manifest=${manifest} hasChat=${true} onPreview=${() => {}} />`);
}

trial('preview + inspector render (healthy data)', () => previewAndRender(makeFixture()));

// Regression: the pre-fix bug stored the whole {messages, manifest} result in
// state. The inspector must now degrade to the empty state instead of throwing.
trial('wrong-shape manifest (bug-1 regression) is guarded', () => {
  const wrongShape = assemblePrompt(makeFixture());
  const out = renderToStaticMarkup(
    html`<${ContextInspector} manifest=${wrongShape} hasChat=${true} onPreview=${() => {}} />`);
  if (!out.includes('No generation recorded yet')) throw new Error('guard did not render empty state');
});

// Hostile variants — old/imported/hand-edited data shapes:
trial('memory without id', () => previewAndRender(makeFixture({
  chat: { memoryStore: { memories: [{ text: 'no id', pinned: false, createdAt: 1 }], cursor: 0 } },
})));
trial('lore piece without id/title', () => previewAndRender(makeFixture({
  scenario: { lorePieces: [{ type: 'lore', content: 'x', keys: ['dock'], pinned: true, weight: 0, links: [], enabled: true }] },
})));
trial('memoryStore.memories not an array', () => previewAndRender(makeFixture({
  chat: { memoryStore: { memories: { id: 'x' }, cursor: 0 } },
})));
trial('lore keys as string', () => previewAndRender(makeFixture({
  scenario: { lorePieces: [{ id: 'L9', type: 'lore', title: 'T', content: 'x', keys: 'dock', pinned: false, weight: 0, links: [], enabled: true }] },
})));
trial('chat with no messages (empty tree)', () => previewAndRender(makeFixture({
  chat: { messages: {}, activeLeafId: null, rootMessageId: null },
})));
trial('missing scenario (imported chat)', () => {
  const f = makeFixture();
  f.scenario = undefined;
  previewAndRender(f);
});
trial('settings.responseLength unknown key', () => {
  const f = makeFixture();
  f.settings.responseLength = 'huge';
  previewAndRender(f);
});

// Also render the chat pane messages (assistant prose markdown) for good measure.
trial('message list render incl. prose markdown', () => {
  const f = makeFixture();
  renderToStaticMarkup(html`
    <${MessageItem} node=${f.chat.messages.a1} isRoot=${false} personaName="Ari"
      characterNames=${['Vex']} streaming=${false} generating=${false}
      onEdit=${() => {}} onRegenerate=${() => {}} onSwipe=${() => {}}
      onBranch=${() => {}} onRewind=${() => {}} onDelete=${() => {}} onReply=${() => {}} />`);
});

// ProbsView renders per-token spans with popovers (no client JS needed for SSR).
trial('ProbsView renders tokens + alternatives', () => {
  const out = renderToStaticMarkup(html`
    <${fp.ProbsView} tokens=${[
      { text: 'Hello', logprob: -0.1, top: [{ token: 'Hi', logprob: -0.5 }, { token: 'Hey', logprob: -1.2 }] },
      { text: ' world', logprob: -2.0, top: [{ token: ' there', logprob: -0.3 }] },
      { text: '\n', logprob: null, top: [] },
    ]} onPick=${() => {}} />`);
  if (!out.includes('probs-view') || !out.includes('world')) throw new Error('probs view markup incomplete');
  if (!out.includes('90.5%')) throw new Error('probability % missing');
});

// The streaming normalizer parses vLLM logprobs chunks and sends logit_bias.
// Real vLLM shape: logprobs at CHOICE level (choices[0].logprobs.content),
// first chunk has logprobs:null; delta-nested is tolerated as a fallback.
trial('openaiChatStream: logprobs chunks + request body', async () => {
  const sse = [
    'data: {"choices":[{"delta":{"role":"assistant","content":""},"logprobs":null}]}',
    'data: {"choices":[{"delta":{"content":"Hel"},"logprobs":{"content":[{"token":"Hel","logprob":-0.2,"top_logprobs":[{"token":"Hel","logprob":-0.2},{"token":"Hi","logprob":-1.1}]}]}}]}',
    // inline stop-string match in the logprobs path — must be filtered
    'data: {"choices":[{"delta":{},"logprobs":{"content":[{"token":"<turn|>","logprob":-0.4,"top_logprobs":[]}]}}]}',
    'data: {"choices":[{"delta":{"content":"lo","logprobs":{"content":[{"token":"lo","logprob":-3.0,"top_logprobs":[]}]}}}]}',
    'data: {"choices":[{"delta":{"content":"!","logprobs":{"content":[{"token":"!","logprob":-0.9,"top_logprobs":[]}]}}}]}',
    // inline stop-string match in the plain path — must be filtered
    'data: {"choices":[{"delta":{"content":"<turn|>"}}]}',
    // real vLLM stop emission: finish_reason set, empty delta, EOS in logprobs
    'data: {"choices":[{"finish_reason":"stop","delta":{},"logprobs":{"content":[{"token":"<turn|>","logprob":-0.01,"top_logprobs":[]}]}}]}',
    'data: [DONE]', '',
  ].join('\n');
  let sentBody = null;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    const chunks = [];
    for await (const c of fp.openaiChatStream({ endpoint: 'http://x/v1', model: 'm', messages: [], tokenProbs: true, logitBias: { '123': -5 }, stop: ['<turn|>'] }))
      chunks.push(c);
    const text = chunks.map(c => c.content).join('');
    if (chunks.length !== 3) throw new Error('chunk count ' + chunks.length + ': ' + JSON.stringify(chunks));
    if (text !== 'Hello!') throw new Error('stop token leaked into text: ' + JSON.stringify(text));
    if (chunks[0].content !== 'Hel' || chunks[0].logprob !== -0.2 || chunks[0].top.length !== 2)
      throw new Error('bad logprob chunk: ' + JSON.stringify(chunks[0]));
    if (chunks[1].logprob !== -3.0) throw new Error('delta-nested fallback broken: ' + JSON.stringify(chunks[1]));
    if (chunks[2].logprob !== -0.9) throw new Error('choice-level logprobs broken: ' + JSON.stringify(chunks[2]));
    if (sentBody.logprobs !== true || sentBody.top_logprobs !== 10) throw new Error('logprobs not requested');
    if (sentBody.logit_bias?.['123'] !== -5) throw new Error('logit_bias not sent');
    if (!Array.isArray(sentBody.stop) || sentBody.stop[0] !== '<turn|>') throw new Error('stop not sent');
  } finally { globalThis.fetch = oldFetch; }
});

// delta.content is the text authority: misaligned logprobs must never drop
// text; aligned logprobs tile the delta exactly for per-token probs.
trial('openaiChatStream: delta/logprobs alignment', async () => {
  const sse = [
    // misaligned: delta "*He" (detokenizer merge) but logprobs cover only "He"
    'data: {"choices":[{"delta":{"content":"*He"},"logprobs":{"content":[{"token":"He","logprob":-0.5,"top_logprobs":[]}]}}]}',
    // aligned: two logprob tokens tile the delta exactly
    'data: {"choices":[{"delta":{"content":"*She"},"logprobs":{"content":[{"token":"*","logprob":-0.1,"top_logprobs":[{"token":"*","logprob":-0.1}]},{"token":"She","logprob":-0.3,"top_logprobs":[]}]}}]}',
    'data: [DONE]', '',
  ].join('\n');
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  try {
    const chunks = [];
    for await (const c of fp.openaiChatStream({ endpoint: 'http://x/v1', model: 'm', messages: [], tokenProbs: true }))
      chunks.push(c);
    const text = chunks.map(c => c.content).join('');
    if (text !== '*He*She') throw new Error('text lost or duplicated: ' + JSON.stringify(text));
    if (chunks.length !== 3) throw new Error('chunk count ' + chunks.length + ': ' + JSON.stringify(chunks));
    if (chunks[0].content !== '*He' || chunks[0].logprob !== undefined)
      throw new Error('misaligned chunk should be one plain chunk: ' + JSON.stringify(chunks[0]));
    if (chunks[1].content !== '*' || chunks[1].logprob !== -0.1 || chunks[2].content !== 'She' || chunks[2].logprob !== -0.3)
      throw new Error('aligned chunk should yield per-token probs: ' + JSON.stringify(chunks.slice(1)));
  } finally { globalThis.fetch = oldFetch; }
});

// /tokenize shape tolerance: {tokens:[ids]}, count-only, and 404 → null.
trial('tokenize: ids / count-only / unavailable', async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ count: 7, tokens: [1, 2, 3, 4, 5, 6, 7] }), { status: 200 });
    const r = await fp.tokenize({ endpoint: 'http://a', model: 'm', prompt: 'one' });
    if (r?.count !== 7 || r.ids?.length !== 7) throw new Error('ids shape: ' + JSON.stringify(r));
    globalThis.fetch = async () => new Response(JSON.stringify({ count: 3 }), { status: 200 });
    const r2 = await fp.tokenize({ endpoint: 'http://b', model: 'm', prompt: 'two' });
    if (r2?.count !== 3 || r2.ids !== null) throw new Error('count-only shape: ' + JSON.stringify(r2));
    globalThis.fetch = async () => new Response('nope', { status: 404 });
    const r3 = await fp.tokenize({ endpoint: 'http://c', model: 'm', prompt: 'three' });
    if (r3 !== null) throw new Error('404 should degrade to null');
    if (await fp.getTokenCount({ endpoint: 'http://a', model: 'm', text: 'one' }) !== 7)
      throw new Error('getTokenCount should hit the cache');
  } finally { globalThis.fetch = oldFetch; }
});

// embed: batch parse (index-sorted), cache, and error propagation.
trial('embed: response parsing, cache, errors', async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (url, opts) => {
      calls++;
      const body = JSON.parse(opts.body);
      if (body.model === 'bad') return new Response(JSON.stringify({ error: { message: 'no such model' } }), { status: 400 });
      return new Response(JSON.stringify({ data: body.input.map((_, i) => ({ index: i, embedding: [i, 0, 1] })).reverse() }), { status: 200 });
    };
    const vecs = await fp.embed({ endpoint: 'http://e', model: 'emb', inputs: ['a', 'b'] });
    if (vecs.length !== 2 || vecs[0][0] !== 0 || vecs[1][0] !== 1) throw new Error('index sort/parse: ' + JSON.stringify(vecs));
    const before = calls;
    await fp.embedCached({ endpoint: 'http://e', model: 'emb', text: 'piece text' });
    await fp.embedCached({ endpoint: 'http://e', model: 'emb', text: 'piece text' });
    if (calls !== before + 1) throw new Error('embedCached did not cache');
    let threw = false;
    try { await fp.embed({ endpoint: 'http://e', model: 'bad', inputs: ['x'] }); }
    catch (e) { threw = /no such model/.test(e.message); }
    if (!threw) throw new Error('HTTP/API error not propagated');
    // cosine sanity: identical → 1, orthogonal → 0
    if (Math.abs(fp.cosine([1, 2, 3], [1, 2, 3]) - 1) > 1e-9) throw new Error('cosine identity');
    if (fp.cosine([1, 0], [0, 1]) !== 0) throw new Error('cosine orthogonal');
    if (!(fp.SEMANTIC_THRESHOLD > 0 && fp.SEMANTIC_THRESHOLD < 1)) throw new Error('threshold sane');
  } finally { globalThis.fetch = oldFetch; }
});

// authHeaders: direct endpoint → Authorization; same-origin /proxy/ → X-Real-Authorization.
trial('authHeaders: proxy vs direct credential mapping', async () => {
  const seen = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    seen.push({ url, headers: opts.headers });
    return new Response('data: {"choices":[{"delta":{"content":"x"}}]}\ndata: [DONE]\n', { status: 200 });
  };
  try {
    for await (const _ of fp.openaiChatStream({ endpoint: 'http://llm.local/v1', apiKey: 'k1', model: 'm', messages: [] })) {}
    for await (const _ of fp.openaiChatStream({ endpoint: '/proxy/http://llm.local', apiKey: 'k1', model: 'm', messages: [] })) {}
    const [direct, proxied] = seen;
    if (direct.headers.Authorization !== 'Bearer k1') throw new Error('direct endpoint should send Authorization');
    if ('X-Real-Authorization' in direct.headers) throw new Error('direct endpoint should not send X-Real-Authorization');
    if (proxied.headers['X-Real-Authorization'] !== 'Bearer k1') throw new Error('proxy endpoint should send X-Real-Authorization');
    if ('Authorization' in proxied.headers) throw new Error('proxy endpoint must not clobber Authorization (Basic lives there)');
  } finally { globalThis.fetch = oldFetch; }
});

// effectiveEndpoint: /proxy/ rewrite only when toggle on + server storage active.
trial('effectiveEndpoint rewriting', () => {
  const s = (over) => ({ endpoint: 'http://llm.local:8080', ...over });
  if (fp.effectiveEndpoint(s({}), true) !== '/proxy/http://llm.local:8080') throw new Error('toggle on + server should rewrite');
  if (fp.effectiveEndpoint(s({ routeViaServer: false }), true) !== 'http://llm.local:8080') throw new Error('toggle off → raw');
  if (fp.effectiveEndpoint(s({}), false) !== 'http://llm.local:8080') throw new Error('server inactive → raw despite toggle');
  if (fp.effectiveEndpoint(s({ endpoint: '/proxy/http://x' }), true) !== '/proxy/http://x') throw new Error('already /proxy/ unchanged (no double-proxy)');
  if (fp.effectiveEndpoint(s({ endpoint: '' }), true) !== '') throw new Error('empty unchanged');
});

// delta.content is the text authority: misaligned logprobs must not lose text.
trial('openaiChatStream: misaligned vs aligned delta/logprobs', async () => {
  const sse = [
    // misaligned: delta has "*He" but logprobs only cover "He" → one plain chunk, text intact
    'data: {"choices":[{"delta":{"content":"*He"},"logprobs":{"content":[{"token":"He","logprob":-0.5,"top_logprobs":[]}]}}]}',
    // aligned: delta "*He" tiled exactly by lp entries ["*","He"] → two per-token chunks
    'data: {"choices":[{"delta":{"content":"*He"},"logprobs":{"content":[{"token":"*","logprob":-0.1,"top_logprobs":[{"token":"*","logprob":-0.1}]},{"token":"He","logprob":-0.7,"top_logprobs":[]}]}}]}',
    'data: [DONE]', '',
  ].join('\n');
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(sse, { status: 200 });
  try {
    const chunks = [];
    for await (const c of fp.openaiChatStream({ endpoint: 'http://x/v1', model: 'm', messages: [], tokenProbs: true })) chunks.push(c);
    const text = chunks.map(c => c.content).join('');
    if (text !== '*He*He') throw new Error('text lost or reordered: ' + JSON.stringify(text));
    if (chunks.length !== 3) throw new Error('expected 1 plain + 2 token chunks, got ' + chunks.length);
    if (chunks[0].content !== '*He' || chunks[0].logprob !== undefined) throw new Error('misaligned chunk should be a single plain chunk: ' + JSON.stringify(chunks[0]));
    if (chunks[1].content !== '*' || chunks[1].logprob !== -0.1) throw new Error('aligned token 1: ' + JSON.stringify(chunks[1]));
    if (chunks[2].content !== 'He' || chunks[2].logprob !== -0.7) throw new Error('aligned token 2: ' + JSON.stringify(chunks[2]));
  } finally { globalThis.fetch = oldFetch; }
});

for (const [name, fn] of trials) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.error(`THROW ${name}: ${e.message}`); }
}
console.log(failures ? `\n${failures} trial(s) THREW` : '\nNo throws reproduced');
process.exit(failures ? 1 : 0);
