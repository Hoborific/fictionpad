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
export { ContextInspector, MessageItem, Markdown, assemblePrompt, html };`);
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
function trial(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.error(`THROW ${name}: ${e.message}`); }
}

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

console.log(failures ? `\n${failures} trial(s) THREW` : '\nNo throws reproduced');
process.exit(failures ? 1 : 0);
