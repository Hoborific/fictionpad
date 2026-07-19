// FictionPad — pure-core unit tests.
// Extracts the section between `// === PURE CORE START ===` and
// `// === PURE CORE END ===` from fictionpad.html, imports it as an ES module
// via a data: URL, and runs assertions against it.
//
// Run: node tests/assembler.test.mjs

import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../fictionpad.html', import.meta.url), 'utf8');
const match = html.match(/\/\/ === PURE CORE START ===([\s\S]*?)\/\/ === PURE CORE END ===/);
if (!match) throw new Error('PURE CORE markers not found in fictionpad.html');

const src = match[1] + `
export { TOKEN_CHARS, DEFAULT_SEARCH_DEPTH, LINK_BOOST, MEMORY_CAP, MEMORY_EVERY,
  LAYER_CAPS, LENGTH_PRESETS, estimateTokens, uid, deepClone, subUser,
  activeText, getActivePath, appendMessage, applyUsedSwipes, deleteSubtree, rewindChat, branchChat,
  keyMatches, scanLore, selectLore, addMemory, assemblePrompt };`;
const core = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(src));

const {
  MEMORY_CAP, LINK_BOOST, estimateTokens, subUser,
  activeText, getActivePath, appendMessage, applyUsedSwipes, deleteSubtree, rewindChat, branchChat,
  keyMatches, scanLore, selectLore, addMemory, assemblePrompt,
} = core;

// ---- tiny test runner ----
let failures = 0;
function ok(cond, name) {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}`); }
}
function section(name) { console.log(`\n# ${name}`); }

// ---- fixtures ----
const node = (id, parentId, role, text, createdAt = 0) => ({
  id, parentId, role, activeSwipe: 0, edited: false,
  swipes: [{ text, createdAt, modelId: null }],
});
const lore = (over) => ({
  id: 'L', type: 'lore', title: 'L', content: 'lore content', keys: [],
  pinned: false, weight: 0, links: [], enabled: true, searchDepth: null, ...over,
});
const baseScenario = {
  id: 'S', name: 'Test', description: '', tags: [],
  backstory: 'The city of Veyra floats above the clouds. {{user}} has just arrived.',
  greeting: 'Welcome to Veyra, {{user}}.',
  scenarioInstructions: 'Write in second person.',
  lorePieces: [],
};
const persona = { id: 'P', name: 'Ari', description: 'a sky-smuggler with a debt' };
const baseChat = {
  id: 'C', scenarioId: 'S', personaId: 'P', customInstructions: '',
  rootMessageId: 'root', activeLeafId: 'root',
  messages: { root: node('root', null, 'assistant', 'Welcome to Veyra, {{user}}.', 1) },
  memoryStore: { memories: [], cursor: 0 },
};
const settings = { contextLength: 8192, maxTokens: 400, responseLength: 'medium' };

// ---- {{user}} substitution ----
section('{{user}} macro');
ok(subUser('Hi {{user}}, hello {{USER}}!', 'Ari') === 'Hi Ari, hello Ari!', 'case-insensitive substitution');
ok(subUser('no macro', 'Ari') === 'no macro', 'no-op without macro');
{
  const { messages } = assemblePrompt({ scenario: baseScenario, persona, chat: baseChat, settings, platformPrompt: '' });
  ok(messages[0].content.includes('Ari has just arrived') && !messages[0].content.includes('{{user}}'),
    'assembler substitutes {{user}} in backstory');
  ok(messages.some(m => m.role === 'assistant' && m.content === 'Welcome to Veyra, Ari.'),
    'assembler substitutes {{user}} in greeting');
}

// ---- message tree ----
section('message tree');
{
  let chat = baseChat;
  let r = appendMessage(chat, 'root', 'user', 'hello', null); chat = r.chat;
  const uid1 = r.id;
  r = appendMessage(chat, uid1, 'assistant', 'hi there', null); chat = r.chat;
  const path = getActivePath(chat.messages, chat.activeLeafId);
  ok(path.length === 3 && path[0].id === 'root' && path[2].role === 'assistant', 'active path walks root→leaf');
  const gone = deleteSubtree(chat.messages, uid1);
  ok(!gone[uid1] && !gone[r.id] && gone.root, 'deleteSubtree removes node + descendants');
  const b = branchChat(chat, uid1);
  ok(b.id !== chat.id && b.activeLeafId === uid1 && b.messages !== chat.messages,
    'branch forks tree with new id and new leaf');
  b.memoryStore.memories.push({ id: 'x', text: 't', pinned: false, createdAt: 1 });
  ok(chat.memoryStore.memories.length === 0, 'branch deep-copies memoryStore');
}

// ---- lore engine ----
section('lore engine');
{
  const pieces = [
    lore({ id: 'pin', pinned: true, title: 'Pinned' }),
    lore({ id: 'hit', keys: ['veyra'], title: 'Hit' }),
    lore({ id: 'miss', keys: ['dragon'], title: 'Miss' }),
    lore({ id: 'bad', keys: ['([invalid'], title: 'BadRegex' }),
    lore({ id: 'off', keys: ['veyra'], enabled: false, title: 'Off' }),
  ];
  const active = scanLore(pieces, 'welcome to Veyra, traveler'); // case-insensitive
  ok(active.has('pin') && active.get('pin').reason === 'pinned', 'pinned always active');
  ok(active.has('hit') && active.get('hit').reason === 'triggered', 'keyword trigger fires (case-insensitive)');
  ok(!active.has('miss'), 'non-matching key does not trigger');
  ok(!active.has('bad'), 'invalid regex safely ignored');
  ok(!active.has('off'), 'disabled piece never active');
  ok(keyMatches('veyra', '') === false, 'empty scan text never matches');

  // weight ordering under budget pressure: budget fits exactly one piece
  const sel = selectLore([
    lore({ id: 'low', pinned: true, weight: 1, content: 'x'.repeat(30) }),
    lore({ id: 'high', keys: ['a'], weight: 9, content: 'x'.repeat(30) }),
  ], 'a', estimateTokens('x'.repeat(33)));
  ok(sel.length === 1 && sel[0].id === 'high', 'higher weight wins under budget pressure');

  // link boost: T (w5, triggered, links L) boosts L (w4) past U (w7, triggered)? no —
  // eff: U=7, L=4+2=6, T=5 → with budget for 2: U + L (link-boosted), T dropped
  const boosted = selectLore([
    lore({ id: 'T', keys: ['go'], weight: 5, links: ['L'], content: 't'.repeat(30) }),
    lore({ id: 'L', weight: 4, content: 'l'.repeat(30) }),
    lore({ id: 'U', keys: ['go'], weight: 7, content: 'u'.repeat(30) }),
  ], 'go', estimateTokens('x'.repeat(66))); // budget fits exactly 2 pieces
  const ids = boosted.map(s => s.id);
  ok(ids.includes('U') && ids.includes('L') && !ids.includes('T'),
    'link boost raises effective weight for budget contention');
  ok(boosted.find(s => s.id === 'L')?.reason === 'link-boosted', 'link-boosted reason recorded');

  // no boost when the linker is inactive
  const noBoost = scanLore([
    lore({ id: 'T', keys: ['zzz-no-match'], weight: 5, links: ['L'] }),
    lore({ id: 'L', weight: 4 }),
  ], 'some text');
  ok(!noBoost.has('L'), 'linked piece not activated when linker is inactive');

  // searchDepth: key outside the scan window must not trigger
  const deep = scanLore([lore({ id: 'D', keys: ['ancient'], searchDepth: 1 })],
    'ancient ' + 'y'.repeat(100)); // 1 est. token ≈ 3 chars of scan window
  ok(!deep.has('D'), 'per-piece searchDepth limits the scan window');
}

// ---- memory store ----
section('memory store');
{
  let store = { memories: [], cursor: 0 };
  for (let i = 0; i < MEMORY_CAP; i++) store = addMemory(store, `m${i}`, i);
  ok(store.memories.length === MEMORY_CAP, 'store fills to cap');
  // pin one in the middle, then add one more → oldest unpinned evicted, pinned survives
  store.memories = store.memories.map(m => m.text === 'm50' ? { ...m, pinned: true } : m);
  store = addMemory(store, 'new', 9999);
  ok(store.memories.length === MEMORY_CAP, 'cap enforced after eviction');
  ok(!store.memories.some(m => m.text === 'm0'), 'oldest unpinned evicted first');
  ok(store.memories.some(m => m.text === 'm50' && m.pinned), 'pinned memory survives eviction');
  ok(store.memories.some(m => m.text === 'new'), 'new memory appended');
  // all pinned → the incoming (unpinned) memory is the only eviction candidate
  let allPinned = { memories: store.memories.map(m => ({ ...m, pinned: true })) };
  allPinned = addMemory(allPinned, 'overflow', 10000);
  ok(allPinned.memories.length === MEMORY_CAP, 'all-pinned full store stays at cap');
  ok(!allPinned.memories.some(m => m.text === 'overflow') && allPinned.memories.every(m => m.pinned),
    'pinned memories never evicted (incoming unpinned memory is dropped instead)');
}

// ---- rewind rolls memory back ----
section('rewind');
{
  let chat = baseChat;
  let r = appendMessage(chat, 'root', 'user', 'first', null); chat = r.chat; // createdAt = now
  const store = addMemory(chat.memoryStore, 'recent event', Date.now() + 100000);
  chat = { ...chat, memoryStore: store };
  const rewound = rewindChat(chat, 'root');
  ok(rewound.activeLeafId === 'root', 'rewind sets active leaf');
  ok(rewound.memoryStore.memories.length === 0, 'rewind rolls back memories created after the target node');
  ok(rewound.memoryStore.cursor === 1, 'rewind resets the summary cursor to path length');
}

// ---- assembler: budgeting + manifest ----
section('assembler budgeting & manifest');
{
  const scenario = {
    ...baseScenario,
    lorePieces: [
      lore({ id: 'pin1', title: 'Always', pinned: true, content: 'Pinned fact.' }),
      lore({ id: 'tri1', title: 'Clouds', keys: ['cloud'], content: 'Cloud lore.' }),
      lore({ id: 'no1', title: 'Nope', keys: ['zzz'], content: 'Should not appear.' }),
    ],
  };
  let chat = baseChat;
  const msgs = [];
  for (let i = 0; i < 40; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    const r = appendMessage(chat, chat.activeLeafId, role, `message ${i} about clouds ` + 'lorem ipsum '.repeat(20));
    chat = r.chat; msgs.push(r.id);
  }
  chat = {
    ...chat,
    memoryStore: { memories: [
      { id: 'memA', text: 'Ari owes the harbormaster money.', pinned: true, createdAt: 1 },
      { id: 'memB', text: 'The crew mutinied last week.', pinned: false, createdAt: 2 },
    ], cursor: 0 },
  };
  const { messages, manifest } = assemblePrompt({
    scenario, persona, chat,
    settings: { contextLength: 2048, maxTokens: 400, responseLength: 'medium' },
    platformPrompt: 'Platform prompt here.',
  });

  const sys = messages[0];
  ok(sys.role === 'system' && sys.content.includes('Platform prompt here.'), 'system[0] starts with platform prompt');
  ok(sys.content.includes('Write in second person.'), 'system[0] has scenario instructions');
  ok(sys.content.includes('Ari is a sky-smuggler with a debt'), 'system[0] has persona block');

  const loreMsg = messages.find(m => m.role === 'system' && m.content.startsWith('[World Info]'));
  ok(loreMsg && loreMsg.content.includes('Pinned fact.') && loreMsg.content.includes('Cloud lore.')
    && !loreMsg.content.includes('Should not appear.'), 'lore block has pinned + triggered, not non-triggered');

  const memMsg = messages.find(m => m.role === 'system' && m.content.startsWith('[Memories]'));
  ok(memMsg && memMsg.content.includes('harbormaster') && memMsg.content.includes('mutinied'), 'memory block injected');

  ok(messages[3]?.role === 'assistant' && messages[3].content.startsWith('Welcome to Veyra'),
    'greeting is the first assistant message');
  ok(manifest.layers.greeting && manifest.layers.greeting.tokens > 0,
    'greeting tokens counted as their own layer');
  const layerSum = ['static', 'lore', 'memory', 'greeting', 'history']
    .reduce((t, k) => t + (manifest.layers[k]?.tokens ?? 0), 0);
  ok(Math.abs(manifest.totalTokens - layerSum) <= 10,
    'layer token counts sum to totalTokens (±estimation slack)');

  // history window: oldest dropped first, newest always kept
  ok(manifest.layers.history.dropped > 0, 'history trimmed under budget pressure');
  const lastHist = messages[messages.length - 1];
  ok(lastHist.content.includes('message 39'), 'newest history message always kept');
  ok(!messages.some(m => m.content.includes('message 0 about')), 'oldest history dropped first');

  // manifest correctness
  const loreIds = Object.fromEntries(manifest.layers.lore.pieces.map(p => [p.id, p.reason]));
  ok(loreIds.pin1 === 'pinned' && loreIds.tri1 === 'triggered' && loreIds.no1 === undefined,
    'manifest records injected lore ids + reasons');
  const memIds = manifest.layers.memory.memories.map(m => m.id).sort();
  ok(memIds.join(',') === 'memA,memB', 'manifest records injected memory ids');
  ok(manifest.layers.history.kept + manifest.layers.history.dropped === 40,
    'manifest history kept+dropped accounts for all messages');
  ok(manifest.budget === 2048 - 400, 'manifest budget = contextLength − reserve');
  ok(manifest.totalTokens <= manifest.budget + 10, 'total estimate stays within budget (±estimation slack)');
  ok(manifest.layers.static.tokens <= manifest.layers.static.cap, 'static layer within its cap');

  // per-chat custom instructions land in the system layer
  const withCustom = assemblePrompt({
    scenario, persona, chat: { ...chat, customInstructions: 'Avoid purple prose.' },
    settings: { contextLength: 8192, maxTokens: 400 }, platformPrompt: '',
  });
  ok(withCustom.messages[0].content.includes('Avoid purple prose.'), 'per-chat custom instructions appended to system layer');
  ok(withCustom.messages[0].content.includes('moderate length'), 'response-length directive appended to system layer');
}

// ---- manifest observability fields (preview / content / inactive) ----
section('manifest observability fields');
{
  const scenario = {
    ...baseScenario,
    lorePieces: [
      lore({ id: 'sel1', title: 'Selected', keys: ['cloud'], weight: 2, content: 'Line one.\n\nLine two. ' + 'x'.repeat(200) }),
      lore({ id: 'over1', title: 'OverBudget', keys: ['cloud'], weight: 1, content: 'y'.repeat(200) }),
      lore({ id: 'notr1', title: 'NotTriggered', keys: ['zzz-nope'], content: 'nope' }),
    ],
  };
  let chat = baseChat;
  const r = appendMessage(chat, 'root', 'user', 'I look up at the clouds.');
  chat = r.chat;
  const { manifest } = assemblePrompt({
    scenario, persona, chat,
    settings: { contextLength: 1000, maxTokens: 400, responseLength: 'medium' },
    platformPrompt: '',
  });
  const pieces = Object.fromEntries(manifest.layers.lore.pieces.map(p => [p.id, p]));
  ok(pieces.sel1, 'triggered higher-weight piece selected');
  ok(typeof pieces.sel1.content === 'string' && pieces.sel1.content.includes('\n'), 'manifest lore piece carries full content');
  ok(pieces.sel1.preview.length <= 300 && !pieces.sel1.preview.includes('\n'), 'preview is ≤300 chars, single line');
  ok(pieces.sel1.preview.startsWith('Line one. Line two.'), 'preview is whitespace-collapsed');
  const inactive = Object.fromEntries(manifest.layers.lore.inactive.map(p => [p.id, p]));
  ok(inactive.over1?.reason === 'over-budget', 'activated-but-dropped piece recorded as over-budget');
  ok(inactive.notr1?.reason === 'not-triggered', 'non-activated piece recorded as not-triggered');
  ok(manifest.warnings.some(w => /didn't fit the lore budget/.test(w)), 'over-budget warning recorded');
  const withMem = assemblePrompt({
    scenario, persona,
    chat: { ...chat, memoryStore: { memories: [{ id: 'm1', text: 'A thing happened.\nDetails.', pinned: false, createdAt: 1 }], cursor: 0 } },
    settings: { contextLength: 1000, maxTokens: 400 }, platformPrompt: '',
  });
  const mem = withMem.manifest.layers.memory.memories[0];
  ok(mem?.text?.includes('\n') && mem?.preview === 'A thing happened. Details.',
    'manifest memory carries full text + collapsed preview');
}

// ---- semantic (preActivated) lore activation ----
section('semantic (preActivated) lore');
{
  const pieces = [
    lore({ id: 'sem1', title: 'Semantic', keys: ['zzz-nope'], weight: 5, content: 'semantic content' }),
    lore({ id: 'kw1', title: 'Keyword', keys: ['cloud'], weight: 1, content: 'keyword content' }),
  ];
  // omitting the arg keeps old behavior: sem1 inactive, kw1 triggered
  const plain = scanLore(pieces, 'clouds everywhere');
  ok(!plain.has('sem1') && plain.get('kw1')?.reason === 'triggered', 'no preActivated → keyword-only behavior');
  // preActivated activates with reason 'semantic' despite no keyword match
  const sem = scanLore(pieces, 'clouds everywhere', new Set(['sem1']));
  ok(sem.get('sem1')?.reason === 'semantic', 'preActivated id activates with reason semantic');
  // semantic pieces compete on weight/budget like triggered ones
  const sel = selectLore(pieces, 'clouds everywhere', estimateTokens('x'.repeat(33)), new Set(['sem1']));
  ok(sel.length === 1 && sel[0].id === 'sem1' && sel[0].reason === 'semantic',
    'semantic piece wins budget contention on weight');
  const selKw = selectLore(pieces, 'clouds everywhere', estimateTokens('x'.repeat(33)));
  ok(selKw.length === 1 && selKw[0].id === 'kw1', 'without preActivated the keyword piece wins instead');
  // semantic pieces boost their links like any active piece
  const linked = scanLore([
    lore({ id: 'sem2', keys: [], weight: 1, links: ['tgt'], content: 'x' }),
    lore({ id: 'tgt', keys: [], weight: 0, content: 'y' }),
  ], 'no keywords here', new Set(['sem2']));
  ok(linked.get('tgt')?.reason === 'link-boosted' && linked.get('tgt')?.boost === LINK_BOOST,
    'semantic piece link-boosts its links');
  // assemblePrompt: manifest carries reason 'semantic'; smart piece below
  // threshold (not in preActivated) lands in inactive as 'not-triggered'
  const scenario = {
    ...baseScenario,
    lorePieces: [
      lore({ id: 's1', title: 'Sem', keys: [], weight: 0, content: 'semantic lore content' }),
      lore({ id: 's2', title: 'Below', keys: [], weight: 0, content: 'below threshold' }),
    ],
  };
  const { manifest } = assemblePrompt({
    scenario, persona, chat: baseChat,
    settings: { contextLength: 8192, maxTokens: 400 }, platformPrompt: '',
    preActivated: new Set(['s1']),
  });
  ok(manifest.layers.lore.pieces[0]?.reason === 'semantic', 'manifest lists semantic piece with its reason');
  const inact = Object.fromEntries(manifest.layers.lore.inactive.map(p => [p.id, p.reason]));
  ok(inact.s2 === 'not-triggered', 'below-threshold smart piece is not-triggered in inactive list');
}

// ---- usedSwipe semantics ----
section('usedSwipe semantics');
{
  // root greeting gains a second swipe; browse to swipe 1, then append a child
  let chat = baseChat;
  const rootBrowsed = {
    ...chat.messages.root,
    swipes: [...chat.messages.root.swipes, { text: 'alt greeting', createdAt: 2, modelId: null }],
    activeSwipe: 1,
  };
  chat = { ...chat, messages: { ...chat.messages, root: rootBrowsed } };
  const r1 = appendMessage(chat, 'root', 'user', 'hi');
  chat = r1.chat;
  ok(chat.messages.root.usedSwipe === 1, 'appending a child records parent activeSwipe as usedSwipe');
  ok(chat.messages.root.activeSwipe === 1, 'parent swipe browsing is not disturbed by recording');
  // browse back to swipe 0, append the next child → usedSwipe updates
  chat = { ...chat, messages: { ...chat.messages, root: { ...chat.messages.root, activeSwipe: 0 } } };
  const r2 = appendMessage(chat, r1.id, 'assistant', 'hello');
  chat = r2.chat;
  ok(chat.messages[r1.id].usedSwipe === 0, 'next child updates usedSwipe to the then-active swipe');
  // applyUsedSwipes resets activeSwipe → usedSwipe, leaves others alone
  const browsed = { ...chat, messages: { ...chat.messages, root: { ...chat.messages.root, activeSwipe: 0 } } };
  const applied = applyUsedSwipes(browsed);
  ok(applied.messages.root.activeSwipe === 1, 'applyUsedSwipes resets activeSwipe to usedSwipe');
  ok(applied.messages[r2.id].activeSwipe === 0 && applied.messages[r2.id].usedSwipe === undefined,
    'nodes without usedSwipe are untouched');
  ok(applyUsedSwipes(applied) === applied, 'applyUsedSwipes is a no-op (same object) when nothing to reset');
  // out-of-range usedSwipe is ignored safely
  const corrupt = { ...chat, messages: { ...chat.messages, root: { ...chat.messages.root, usedSwipe: 99, activeSwipe: 0 } } };
  ok(applyUsedSwipes(corrupt).messages.root.activeSwipe === 0, 'out-of-range usedSwipe ignored');
}

console.log(failures === 0 ? '\nAll tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
