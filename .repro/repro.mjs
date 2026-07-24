// General SSR/streaming regression harness for fictionpad.html.
// Extracts the app's module script, neutralizes the browser boot line, exports
// the internals, and imports them in Node. Trials cover: Context Inspector
// preview + SSR render (incl. hostile data shapes), message/prose markdown
// rendering (dialogue pairing, streaming auto-close), settings/sidebar/editor
// SSR smoke, ProbsView, the openaiChatStream normalizer (content/lp split,
// logit_bias, choices-less chunks), alignTokensToSpans / alignStrippedToolSpans
// tiling, tokenize/embed parsing, and proxy auth-header mapping. Any throw
// fails the trial; run `node .repro/repro.mjs` (deps: npm install in .repro/).
import { readFileSync, writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';

let src = readFileSync(new URL('../fictionpad.html', import.meta.url), 'utf8');
src = src.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
// Neutralize the browser boot line; export what we need instead.
src = src.replace(/createRoot\(document\.getElementById\('root'\)\)\.render[\s\S]*$/, `
export { ContextInspector, MessageItem, Markdown, assemblePrompt, ProbsView,
  openaiChatStream, alignTokensToSpans, alignStrippedToolSpans, stripToolBlocksMapped, tokenize, getTokenCount, embed, embedCached, cosine, SEMANTIC_THRESHOLD,
  effectiveEndpoint, html, SettingsModal, DEFAULT_SETTINGS,
  Sidebar, CharacterEditor, ScenarioEditor, NewChatModal };`);
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

// Settings modal smoke: tabbed categories render with realistic defaults.
trial('settings modal renders tab bar + appearance tab (SSR smoke)', () => {
  const out = renderToStaticMarkup(html`
    <${fp.SettingsModal} settings=${fp.DEFAULT_SETTINGS} onSave=${() => {}} onClose=${() => {}}
      theme="ctp-mocha" onThemeChange=${() => {}} accent="mauve" onAccentChange=${() => {}}
      onOpenLogitBias=${() => {}} storageKind="local"
      onUpload=${async () => 0} onDownload=${async () => 0} />`);
  for (const label of ['Appearance', 'Connection', 'Models', 'Generation', 'Features', 'Prompts'])
    if (!out.includes(label)) throw new Error(`missing settings tab: ${label}`);
});

// Smoke: the sidebar's Characters section, and collapsed sections pinning
// the open chat's related entries (its scenario, linked characters, the chat).
trial('sidebar renders characters + collapsed sections pin open-chat entries (SSR smoke)', () => {
  const noop = () => {};
  const characters = { CH1: { id: 'CH1', name: 'Mira', content: 'x', keys: [], enabled: true } };
  const scenarios = { S: { id: 'S', name: 'Veyra', characterIds: ['CH1'], lorePieces: [] } };
  const chats = { C: { id: 'C', scenarioId: 'S', name: 'Veyra — 01/01/2026', createdAt: 1 } };
  const out = renderToStaticMarkup(html`
    <${fp.Sidebar} scenarios=${scenarios} chats=${chats} characters=${characters}
      selectedScenarioId=${null} selectedCharacterId=${null} selectedChatId=${'C'}
      onSelectScenario=${noop} onSelectCharacter=${noop} onSelectChat=${noop}
      onNewScenario=${noop} onEditScenario=${noop} onDeleteScenario=${noop} onNewChat=${noop}
      onNewCharacter=${noop} onEditCharacter=${noop} onDeleteCharacter=${noop} onNewCharacterChat=${noop}
      onExportScenario=${noop} onExportCharacter=${noop} onImport=${noop}
      onOpenPersonas=${noop} onOpenSettings=${noop} collapsed=${false} onToggleCollapse=${noop}
      onDeleteChat=${noop} sideCollapsed=${{ scenarios: true, characters: true, chats: true }}
      onToggleSection=${noop} storageKind="local" saveRetrying=${false}
      width=${300} onDragStart=${noop} onResetWidth=${noop} onChatAction=${noop} onChatContextMenu=${noop} />`);
  if (!out.includes('Characters')) throw new Error('characters section missing: ' + out);
  // All three sections collapsed → only the open chat's scenario, its linked
  // character, and the chat itself stay visible.
  if (!out.includes('Veyra')) throw new Error('pinned scenario missing: ' + out);
  if (!out.includes('Mira')) throw new Error('pinned linked character missing: ' + out);
});

// Smoke: character editor, scenario-editor link section, and the
// direct-character new-chat modal.
trial('character editor + scenario editor + character new-chat modal render (SSR smoke)', () => {
  const noop = () => {};
  const characters = { CH1: { id: 'CH1', name: 'Mira', content: 'card', keys: [], enabled: true, greeting: 'Hi.' } };
  const scenarios = { S: { id: 'S', name: 'Veyra', characterIds: ['CH1'], lorePieces: [] } };
  const mgr = renderToStaticMarkup(html`
    <${fp.CharacterEditor} character=${characters.CH1} scenarios=${scenarios}
      onUpsert=${noop} onClose=${noop} />`);
  if (!mgr.includes('Linked into 1 scenario')) throw new Error('link count missing: ' + mgr);
  const ed = renderToStaticMarkup(html`
    <${fp.ScenarioEditor} scenario=${scenarios.S} characters=${characters} onSave=${noop} onClose=${noop} />`);
  if (!ed.includes('Linked characters')) throw new Error('link section missing: ' + ed);
  const nc = renderToStaticMarkup(html`
    <${fp.NewChatModal} scenario=${null} character=${characters.CH1} personas=${{}}
      onCreate=${noop} onClose=${noop} />`);
  if (!nc.includes('Direct chat with Mira')) throw new Error('character new-chat hint missing: ' + nc);
});

// Regression: `Mia:\n*actions here*` — the prefix strip must not cross the
// newline and eat the action's opening star (leaves `actions here*` unpaired).
trial('speaker prefix strip keeps action stars across a newline', () => {
  const out = renderToStaticMarkup(html`
    <${MessageItem} node=${node('x1', null, 'assistant', 'Mia:\n*actions here*')}
      isRoot=${false} personaName="Ari" characterNames=${['Mia']}
      streaming=${false} generating=${false}
      onEdit=${() => {}} onRegenerate=${() => {}} onSwipe=${() => {}}
      onBranch=${() => {}} onRewind=${() => {}} onDelete=${() => {}} onReply=${() => {}} />`);
  if (!out.includes('<em>actions here</em>')) throw new Error('action em eaten by prefix strip: ' + out);
  if (out.includes('Mia:')) throw new Error('speaker prefix not stripped: ' + out);
});

// Multi-speaker swipe: the header names everyone who spoke, in order.
trial('multi-speaker header lists all speakers in order', () => {
  const out = renderToStaticMarkup(html`
    <${MessageItem} node=${node('x2', null, 'assistant', 'Mia: "Hi."\n\nNarrator: *Narration happens.*\n\nSamantha: "Hey."')}
      isRoot=${false} personaName="Ari" characterNames=${['Mia', 'Samantha']}
      streaming=${false} generating=${false}
      onEdit=${() => {}} onRegenerate=${() => {}} onSwipe=${() => {}}
      onBranch=${() => {}} onRewind=${() => {}} onDelete=${() => {}} onReply=${() => {}} />`);
  const meta = out.match(/<div class="meta[^"]*"[\s\S]*?<\/div>/)?.[0] ?? '';
  const mi = meta.indexOf('>Mia<'), ni = meta.indexOf('>Narrator<'), si = meta.indexOf('>Samantha<');
  if (mi < 0 || ni < 0 || si < 0) throw new Error('header missing a speaker: ' + meta);
  if (!(mi < ni && ni < si)) throw new Error('speakers out of order: ' + meta);
});

// RP prose formatting: quote pairing must survive inch marks, contractions,
// unterminated quotes, and emphasis inside speech (regression: the old
// naive /"[^"\n]+"/ regex paired a 5ft8" inch mark with the next real quote
// and mangled the HTML around it).
const proseHtml = (text) => renderToStaticMarkup(html`<${Markdown} text=${text} prose=${true} />`);

trial('prose: inch mark inside action does not eat dialogue', () => {
  const out = proseHtml('*she is 5ft8" and smirks* "Hello there."');
  if (!out.includes('<em>she is 5ft8&quot; and smirks</em>'))
    throw new Error('action em broken: ' + out);
  if (!out.includes('<span class="dialogue">&quot;Hello there.&quot;</span>'))
    throw new Error('dialogue not wrapped: ' + out);
});

trial('prose: emphasis inside speech stays nested in the dialogue span', () => {
  const out = proseHtml('"I *am* listening."');
  if (!out.includes('<span class="dialogue">&quot;I <em>am</em> listening.&quot;</span>'))
    throw new Error('em inside dialogue broken: ' + out);
});

trial('prose: unterminated quote is left raw', () => {
  const out = proseHtml('She says "hi and walks off');
  if (out.includes('class="dialogue"')) throw new Error('unterminated quote wrapped: ' + out);
});

trial('prose: two quotes on one line each get their own span', () => {
  const out = proseHtml('"hi" she said, "bye"');
  if ((out.match(/class="dialogue"/g) ?? []).length !== 2)
    throw new Error('expected 2 dialogue spans: ' + out);
});

trial('prose: curly quotes wrap; apostrophes do not interfere', () => {
  const out = proseHtml('“I don’t know,” she said.');
  if (!out.includes('<span class="dialogue">“I don’t know,”</span>'))
    throw new Error('curly dialogue broken: ' + out);
});

// Streaming auto-close: unterminated emphasis/dialogue format predictively
// while streaming; the final (non-streaming) render shows the raw text.
trial('streaming prose: unterminated emphasis + dialogue auto-close', () => {
  const em = renderToStaticMarkup(html`<${Markdown} text="*she waves" prose=${true} streaming=${true} />`);
  if (!em.includes('<em>she waves</em>')) throw new Error('em not auto-closed: ' + em);
  const bold = renderToStaticMarkup(html`<${Markdown} text="**bold words" prose=${true} streaming=${true} />`);
  if (!bold.includes('<strong>bold words</strong>')) throw new Error('bold not auto-closed: ' + bold);
  const dl = renderToStaticMarkup(html`<${Markdown} text='He says "hello the' prose=${true} streaming=${true} />`);
  if (!dl.includes('class="dialogue"')) throw new Error('dialogue not auto-closed: ' + dl);
});

trial('prose auto-close edge cases (lone star, final render raw)', () => {
  const bare = renderToStaticMarkup(html`<${Markdown} text="*" prose=${true} streaming=${true} />`);
  if (bare.includes('<em>')) throw new Error('lone star should stay literal: ' + bare);
  const final = renderToStaticMarkup(html`<${Markdown} text="*she waves" prose=${true} streaming=${false} />`);
  if (final.includes('<em>')) throw new Error('final render must show the raw unclosed star: ' + final);
  const rawQ = renderToStaticMarkup(html`<${Markdown} text='He says "hello' prose=${true} streaming=${false} />`);
  if (rawQ.includes('class="dialogue"')) throw new Error('final render must leave unterminated quote raw: ' + rawQ);
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
// The parser yields independent streams: {content} text chunks and {lp}
// tape records — stop/EOS filtering applies to both.
trial('openaiChatStream: content/lp split + request body', async () => {
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
    const text = chunks.filter(c => c.content != null).map(c => c.content).join('');
    if (text !== 'Hello!') throw new Error('stop token leaked into text: ' + JSON.stringify(text));
    const tape = chunks.filter(c => c.lp).flatMap(c => c.lp);
    if (tape.length !== 3) throw new Error('tape length ' + tape.length + ': ' + JSON.stringify(tape));
    if (tape[0].token !== 'Hel' || tape[0].logprob !== -0.2 || tape[0].top.length !== 2)
      throw new Error('bad tape entry: ' + JSON.stringify(tape[0]));
    if (tape[1].token !== 'lo' || tape[1].logprob !== -3.0) throw new Error('delta-nested fallback broken: ' + JSON.stringify(tape[1]));
    if (tape[2].token !== '!' || tape[2].logprob !== -0.9) throw new Error('choice-level logprobs broken: ' + JSON.stringify(tape[2]));
    if (tape.some(t => t.token === '<turn|>')) throw new Error('EOS/stop token leaked into tape');
    if (sentBody.logprobs !== true || sentBody.top_logprobs !== 10) throw new Error('logprobs not requested');
    if (sentBody.logit_bias?.['123'] !== -5) throw new Error('logit_bias not sent');
    if (!Array.isArray(sentBody.stop) || sentBody.stop[0] !== '<turn|>') throw new Error('stop not sent');
  } finally { globalThis.fetch = oldFetch; }
});

// Reasoning channel: delta.reasoning_content (vLLM/DeepSeek) and
// delta.reasoning (OpenRouter) yield { think } records, kept out of content.
trial('openaiChatStream: reasoning_content captured as { think }', async () => {
  const sse = [
    'data: {"choices":[{"delta":{"reasoning_content":"Let me "}}]}',
    'data: {"choices":[{"delta":{"reasoning":"think"}}]}',
    'data: {"choices":[{"delta":{"content":"Answer."}}]}',
    'data: {"choices":[{"finish_reason":"stop","delta":{}}]}',
    'data: [DONE]', '',
  ].join('\n');
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  try {
    const chunks = [];
    for await (const c of fp.openaiChatStream({ endpoint: 'http://x/v1', model: 'm', messages: [] })) chunks.push(c);
    const think = chunks.filter(c => c.think != null).map(c => c.think).join('');
    if (think !== 'Let me think') throw new Error('reasoning lost or reordered: ' + JSON.stringify(think));
    const text = chunks.filter(c => c.content != null).map(c => c.content).join('');
    if (text !== 'Answer.') throw new Error('reasoning leaked into content: ' + JSON.stringify(text));
    if (!chunks.some(c => c.done)) throw new Error('done chunk missing');
  } finally { globalThis.fetch = oldFetch; }
});

// Content and lp streams are independent: deltas may be arbitrary byte
// windows with logprob entries attached off by one (observed through a
// re-chunking middleware). Text must pass through untouched; the tape is
// aligned ONCE, globally, by alignTokensToSpans.
trial('openaiChatStream + alignTokensToSpans: off-by-one middleware shape', async () => {
  const sse = [
    // deltas are byte windows; each chunk's lp token belongs to the NEXT
    // window (globally: tape = text minus the leading "*W")
    'data: {"choices":[{"delta":{"content":"*Wipin"},"logprobs":{"content":[{"token":"iping","logprob":-0.5,"top_logprobs":[{"token":"iping","logprob":-0.5}]}]}}]}',
    'data: {"choices":[{"delta":{"content":"g down"},"logprobs":{"content":[{"token":" down","logprob":-0.3,"top_logprobs":[]}]}}]}',
    'data: [DONE]', '',
  ].join('\n');
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  try {
    let text = '';
    const tape = [];
    for await (const c of fp.openaiChatStream({ endpoint: 'http://x/v1', model: 'm', messages: [], tokenProbs: true })) {
      if (c.lp) { tape.push(...c.lp); continue; }
      text += c.content;
    }
    if (text !== '*Wiping down') throw new Error('text lost or reordered: ' + JSON.stringify(text));
    const spans = fp.alignTokensToSpans(text, tape);
    if (spans.map(s => s.text).join('') !== text) throw new Error('spans do not cover text: ' + JSON.stringify(spans));
    if (spans.length !== 3) throw new Error('span count ' + spans.length + ': ' + JSON.stringify(spans));
    if (spans[0].text !== '*W' || spans[0].logprob !== null)
      throw new Error('leading offset span should be plain: ' + JSON.stringify(spans[0]));
    if (spans[1].text !== 'iping' || spans[1].logprob !== -0.5 || spans[1].top.length !== 1)
      throw new Error('token lost its probs: ' + JSON.stringify(spans[1]));
    if (spans[2].text !== ' down' || spans[2].logprob !== -0.3)
      throw new Error('token lost its probs: ' + JSON.stringify(spans[2]));
  } finally { globalThis.fetch = oldFetch; }
});

// Chunks with no choices (trailing usage-only chunk, middleware keep-alives)
// must be skipped, not crash on choice.finish_reason.
trial('openaiChatStream: choices-less chunks are skipped', async () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"Hi"}}]}',
    'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":1}}',
    'data: {"id":"x","object":"chat.completion.chunk"}',
    'data: {"choices":[{"delta":{"content":"!"},"finish_reason":null}]}',
    'data: {"choices":[{"finish_reason":"stop","delta":{}}]}',
    'data: [DONE]', '',
  ].join('\n');
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  try {
    const chunks = [];
    for await (const c of fp.openaiChatStream({ endpoint: 'http://x/v1', model: 'm', messages: [] }))
      chunks.push(c);
    const text = chunks.map(c => c.content).join('');
    if (text !== 'Hi!') throw new Error('bad text around choices-less chunks: ' + JSON.stringify(text));
  } finally { globalThis.fetch = oldFetch; }
});

// alignTokensToSpans: exact tiling, suffix/prefix anchoring (off-by-one and
// partial tapes), greedy fallback with gaps, and degenerate inputs.
trial('alignTokensToSpans: exact / suffix / prefix / greedy / degenerate', () => {
  const A = fp.alignTokensToSpans;
  const cover = (spans, text) => spans.map(s => s.text).join('') === text;

  // exact: healthy per-token stream
  let spans = A('Hello!', [
    { token: 'Hel', logprob: -0.2, top: [{ token: 'Hel', logprob: -0.2 }] },
    { token: 'lo', logprob: -3.0, top: [] },
    { token: '!', logprob: -0.9, top: [] },
  ]);
  if (spans.length !== 3 || !cover(spans, 'Hello!') || spans.some(s => s.logprob == null))
    throw new Error('exact: ' + JSON.stringify(spans));

  // suffix: tape = text minus a leading span (the off-by-one middleware case);
  // the trailing "a" must win over the identical leading text
  spans = A('a banana is a', [{ token: 'a', logprob: -0.7, top: [] }]);
  if (spans.length !== 2 || !cover(spans, 'a banana is a')
    || spans[0].text !== 'a banana is ' || spans[0].logprob !== null
    || spans[1].text !== 'a' || spans[1].logprob !== -0.7)
    throw new Error('suffix: ' + JSON.stringify(spans));

  // prefix: tape covers the head only
  spans = A('Hi there friend', [
    { token: 'Hi', logprob: -0.2, top: [] },
    { token: ' there', logprob: -0.4, top: [] },
  ]);
  if (spans.length !== 3 || !cover(spans, 'Hi there friend')
    || spans[2].text !== ' friend' || spans[2].logprob !== null)
    throw new Error('prefix: ' + JSON.stringify(spans));

  // greedy: tape tiles with a gap; unmatchable tape is dropped, text kept
  spans = A('Hi thereok', [
    { token: 'Hi', logprob: -0.1, top: [] },
    { token: 'there', logprob: -0.6, top: [] },
    { token: 'zzz', logprob: -9, top: [] },
  ]);
  if (!cover(spans, 'Hi thereok')
    || spans[0].text !== 'Hi' || spans[0].logprob !== -0.1
    || spans[1].text !== ' ' || spans[1].logprob !== null
    || spans[2].text !== 'there' || spans[2].logprob !== -0.6
    || spans[3].text !== 'ok' || spans[3].logprob !== null)
    throw new Error('greedy: ' + JSON.stringify(spans));

  // degenerate: no tape → one plain span; no text → nothing
  spans = A('plain message', []);
  if (spans.length !== 1 || spans[0].text !== 'plain message' || spans[0].logprob !== null)
    throw new Error('no-tape: ' + JSON.stringify(spans));
  if (A('', [{ token: 'x', logprob: -1, top: [] }]).length !== 0) throw new Error('empty text should yield no spans');

  // distant-token trap: with lp entries missing at the start AND mid-stream,
  // the tape's later " I" token must not be yanked forward to match the "I"
  // at position 1 — the skip cost keeps alignment (plain "*I" and " the" gaps)
  spans = A('*I lean back against the wall I said', [
    { token: ' lean', logprob: -0.1, top: [] },
    { token: ' back', logprob: -0.2, top: [] },
    { token: ' against', logprob: -0.3, top: [] },
    { token: ' wall', logprob: -0.5, top: [] },
    { token: ' I', logprob: -0.6, top: [] },
    { token: ' said', logprob: -0.7, top: [] },
  ]);
  if (!cover(spans, '*I lean back against the wall I said'))
    throw new Error('distant-token: coverage ' + JSON.stringify(spans));
  if (spans[0].text !== '*I' || spans[0].logprob !== null || spans[4].text !== ' the' || spans[4].logprob !== null)
    throw new Error('distant-token: gaps wrong: ' + JSON.stringify(spans));
  const annotated = spans.filter(s => s.logprob != null);
  if (annotated.length !== 6 || annotated.some((s, i) => s.text !== [' lean',' back',' against',' wall',' I',' said'][i]))
    throw new Error('distant-token: tokens misattributed: ' + JSON.stringify(spans));
});

// alignStrippedToolSpans: tape covers the RAW reply (tool blocks included);
// spans must project onto the stripped text, protocol tokens vanish, prose
// keeps its probs.
trial('alignStrippedToolSpans: probs survive tool-block stripping', () => {
  const raw = 'Hi ```tool\n{"tool":"add_lore","args":{"title":"X","content":"Y"}}\n``` there';
  const { text: stripped, map } = fp.stripToolBlocksMapped(raw);
  if (stripped !== 'Hi  there') throw new Error('strip: ' + JSON.stringify(stripped));
  const tape = [
    { token: 'Hi ', logprob: -0.1, top: [{ token: 'Hi', logprob: -0.1 }] },
    { token: '```tool\n{"tool":"add_lore","args":{"title":"X","content":"Y"}}\n```', logprob: -1.0, top: [] },
    { token: ' there', logprob: -0.4, top: [{ token: ' there', logprob: -0.4 }] },
  ];
  const spans = fp.alignStrippedToolSpans(raw, tape, map, 0, stripped);
  if (!spans) throw new Error('projection returned null');
  if (spans.map(s => s.text).join('') !== stripped) throw new Error('coverage: ' + JSON.stringify(spans));
  const annotated = spans.filter(s => s.logprob != null);
  if (annotated.length !== 2 || annotated[0].text !== 'Hi ' || annotated[1].text !== ' there')
    throw new Error('prose probs lost: ' + JSON.stringify(spans));

  // token straddling the strip boundary: prob survives on the kept fragment
  const raw2 = 'a ```tool\n{}\n```b';
  const m2 = fp.stripToolBlocksMapped(raw2);
  if (m2.text !== 'a b') throw new Error('strip2: ' + JSON.stringify(m2.text));
  const spans2 = fp.alignStrippedToolSpans(raw2, [
    { token: 'a ```tool\n{}\n```b', logprob: -0.3, top: [] },
  ], m2.map, 0, m2.text);
  if (!spans2 || spans2.map(s => s.text).join('') !== 'a b'
    || spans2[0].text !== 'a ' || spans2[0].logprob !== -0.3
    || spans2[1].text !== 'b' || spans2[1].logprob !== -0.3)
    throw new Error('straddle: ' + JSON.stringify(spans2));

  // map/stripped mismatch → null (caller falls back)
  if (fp.alignStrippedToolSpans(raw, tape, map, 0, 'something else') !== null)
    throw new Error('mismatch should return null');
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
for (const [name, fn] of trials) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.error(`THROW ${name}: ${e.message}`); }
}
console.log(failures ? `\n${failures} trial(s) THREW` : '\nNo throws reproduced');
process.exit(failures ? 1 : 0);
