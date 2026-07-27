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
  activeText, getActivePath, appendMessage, applyUsedSwipes, pruneInterrupted, deleteSubtree, rewindChat, branchChat,
  keyMatches, scanLore, selectLore, mergedLorePieces, resolveCharacters, addMemory, assemblePrompt,
  parseToolCalls, stripToolBlocks, stripToolBlocksMapped, applyToolCalls, pruneToolPieces, TOOL_CALL_CAP, splitSpeakerSegments,
  dedupeSpeakerPrefixes,
  resolveLimits, autoReserve, DEFAULT_CONTEXT_LENGTH, DEFAULT_MAX_TOKENS,
  subVars, queueLorePiece, acceptQueuedLore, dismissQueuedLore, expandSamplerParams,
  normalizeScenario, normalizeCharacter, normalizeChat, normalizeLorePiece,
  parseCharacterCard, extractPngCardJson };`;
const core = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(src));

const {
  MEMORY_CAP, LINK_BOOST, LAYER_CAPS, estimateTokens, subUser,
  activeText, getActivePath, appendMessage, applyUsedSwipes, pruneInterrupted, deleteSubtree, rewindChat, branchChat,
  keyMatches, scanLore, selectLore, mergedLorePieces, resolveCharacters, addMemory, assemblePrompt,
  parseToolCalls, stripToolBlocks, stripToolBlocksMapped, applyToolCalls, pruneToolPieces, TOOL_CALL_CAP, splitSpeakerSegments,
  dedupeSpeakerPrefixes,
  resolveLimits, autoReserve,
  subVars, queueLorePiece, acceptQueuedLore, dismissQueuedLore, expandSamplerParams,
  normalizeScenario, normalizeCharacter, normalizeChat, normalizeLorePiece,
  parseCharacterCard, extractPngCardJson,
} = core;

// detectSpeaker lives in src/20-prose.js, outside the pure-core region —
// extract its (dependency-free) function source from fictionpad.html and
// eval it standalone.
const speakerMatch = html.match(/function detectSpeaker\([\s\S]*?\n\}/);
if (!speakerMatch) throw new Error('detectSpeaker not found in fictionpad.html');
const detectSpeaker = new Function(`${speakerMatch[0]}\nreturn detectSpeaker;`)();

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

  // key matching options: wholeWord, caseSensitive, min length
  ok(keyMatches('cat', 'the cathedral bells') === true, 'substring match by default');
  ok(keyMatches('cat', 'the cathedral bells', { wholeWord: true }) === false, 'wholeWord blocks substring hits');
  ok(keyMatches('cat', 'the cat sat', { wholeWord: true }) === true, 'wholeWord still matches whole words');
  ok(keyMatches('Veyra', 'welcome to veyra') === true, 'case-insensitive by default');
  ok(keyMatches('Veyra', 'welcome to veyra', { caseSensitive: true }) === false, 'caseSensitive requires exact case');
  ok(keyMatches('Veyra', 'welcome to Veyra', { caseSensitive: true }) === true, 'caseSensitive matches exact case');
  ok(keyMatches('a', 'a cat') === false, 'single-char key never fires (min length 2)');
  ok(keyMatches('\\d', '5') === true, 'two-char regex escape still fires');
  // piece-level options flow through scanLore
  const optScan = scanLore([lore({ id: 'ww', keys: ['cat'], wholeWord: true })], 'the cathedral bells');
  ok(!optScan.has('ww'), 'piece wholeWord flag respected by scanLore');

  // weight ordering under budget pressure: budget fits exactly one piece
  // (per-piece cost includes the rendered `[title]\n` header)
  const sel = selectLore([
    lore({ id: 'low', pinned: true, weight: 1, content: 'x'.repeat(30) }),
    lore({ id: 'high', keys: ['aa'], weight: 9, content: 'x'.repeat(30) }),
  ], 'aa', estimateTokens('x'.repeat(36)));
  ok(sel.length === 1 && sel[0].id === 'high', 'higher weight wins under budget pressure');

  // link boost: T (w5, triggered, links L) boosts L (w4) past U (w7, triggered)? no —
  // eff: U=7, L=4+2=6, T=5 → with budget for 2: U + L (link-boosted), T dropped
  const boosted = selectLore([
    lore({ id: 'T', keys: ['go'], weight: 5, links: ['L'], content: 't'.repeat(30) }),
    lore({ id: 'L', weight: 4, content: 'l'.repeat(30) }),
    lore({ id: 'U', keys: ['go'], weight: 7, content: 'u'.repeat(30) }),
  ], 'go', estimateTokens('x'.repeat(72))); // budget fits exactly 2 pieces
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

// ---- per-chat lore overlay ----
section('chat lore overlay');
{
  const scen = { ...baseScenario, lorePieces: [
    lore({ id: 'A', title: 'Alpha', keys: ['veyra'] }),
    lore({ id: 'B', title: 'Beta', keys: ['veyra'] }),
  ] };
  // no overlay → scenario list returned as-is
  ok(mergedLorePieces(scen, baseChat) === scen.lorePieces, 'no overlay returns scenario pieces unchanged');
  ok(mergedLorePieces(scen, null) === scen.lorePieces, 'null chat returns scenario pieces unchanged');
  // chat-only piece appends; override by id replaces; enabled:false override disables
  const chat = { ...baseChat, lorePieces: [
    lore({ id: 'B', title: 'BetaChat', content: 'chat version', keys: ['veyra'] }),
    lore({ id: 'C', title: 'Gamma', keys: ['veyra'] }),
    lore({ id: 'A', enabled: false }),
  ] };
  const merged = mergedLorePieces(scen, chat);
  ok(merged.length === 3, 'overlay: override + append keeps count');
  ok(merged.find(p => p.id === 'B')?.title === 'BetaChat', 'chat piece wins on id collision');
  ok(merged.find(p => p.id === 'C')?.title === 'Gamma', 'chat-only piece appended');
  ok(merged.find(p => p.id === 'A')?.enabled === false, 'chat can disable a scenario piece');
  // assembler uses the overlay: disabled A + overridden B + appended C
  const { manifest } = assemblePrompt({ scenario: scen, persona, chat, settings, platformPrompt: '' });
  const activeIds = manifest.layers.lore.pieces.map(p => p.id);
  ok(!activeIds.includes('A'), 'assembler: chat-disabled scenario piece not injected');
  ok(activeIds.includes('B') && activeIds.includes('C'), 'assembler: chat pieces injected when triggered');
  ok(manifest.layers.lore.pieces.find(p => p.id === 'B')?.content === 'chat version',
    'assembler: overridden content is the chat version');
  ok(manifest.layers.lore.pieces.every(p => p.origin === 'chat'), 'manifest marks chat origin');
  ok(manifest.layers.lore.inactive.every(p => p.origin === 'scenario' || p.origin === 'chat'),
    'manifest marks origin on inactive pieces too');
}

// ---- global characters ----
section('global characters');
{
  const chars = {
    CH1: { id: 'CH1', name: 'Mira', content: 'Mira is a tide-witch.', keys: [], pinned: true },
    CH2: { id: 'CH2', name: 'Dax', content: 'Dax is a dock brawler.', keys: ['brawler'], enabled: false },
  };
  // resolution: scenario links, chat links, union dedupe, dangling ids skipped
  const scenLink = { ...baseScenario, characterIds: ['CH1', 'GONE'] };
  ok(resolveCharacters(scenLink, null, chars).map(p => p.id).join() === 'CH1',
    'resolveCharacters: scenario link resolves, dangling id skipped');
  ok(resolveCharacters(null, { characterIds: ['CH2'] }, chars).map(p => p.id).join() === 'CH2',
    'resolveCharacters: chat link resolves without a scenario');
  ok(resolveCharacters(scenLink, { characterIds: ['CH1'] }, chars).length === 1,
    'resolveCharacters: scenario ∪ chat dedupes');
  const mira = resolveCharacters(scenLink, null, chars)[0];
  ok(mira.type === 'character' && mira.title === 'Mira' && mira.origin === 'character',
    'resolved piece is a character-type lore piece with character origin');
  ok(mira.keys.length === 1 && mira.keys[0] === 'Mira', 'empty keys default to [name]');
  ok(resolveCharacters(scenLink, null, null).length === 0
    && mergedLorePieces(scenLink, null, null) === scenLink.lorePieces,
    'no characters map → scenario pieces returned unchanged');
  // merge order: global pieces after scenario pieces; scenario wins on id; chat wins overall
  const scen = { ...baseScenario, characterIds: ['CH1', 'CH2'],
    lorePieces: [lore({ id: 'CH1', title: 'MiraLocal', content: 'scenario copy', keys: ['mira'] })] };
  const merged = mergedLorePieces(scen, baseChat, chars);
  ok(merged.length === 2 && merged.find(p => p.id === 'CH1')?.title === 'MiraLocal',
    'scenario piece wins over global character on id collision');
  ok(merged.some(p => p.id === 'CH2'), 'non-colliding global character appended');
  const chatOver = { ...baseChat, lorePieces: [lore({ id: 'CH1', title: 'MiraChat', content: 'chat copy', keys: ['mira'] })] };
  ok(mergedLorePieces(scen, chatOver, chars).find(p => p.id === 'CH1')?.title === 'MiraChat',
    'chat overlay beats both scenario and global');
  // assembler: pinned global character injected with 'character' origin; disabled one is not
  const { manifest } = assemblePrompt({ scenario: scenLink, persona, chat: baseChat, settings, platformPrompt: '', characters: chars });
  const injected = manifest.layers.lore.pieces;
  ok(injected.some(p => p.id === 'CH1' && p.origin === 'character'),
    'assembler: pinned global character injected with character origin');
  const scenBoth = { ...baseScenario, characterIds: ['CH1', 'CH2'] };
  const m2 = assemblePrompt({ scenario: scenBoth, persona, chat: baseChat, settings, platformPrompt: '', characters: chars }).manifest;
  ok(!m2.layers.lore.pieces.some(p => p.id === 'CH2'), 'assembler: disabled global character not injected');
  // keyword trigger via the default [name] key: mention the character in chat
  const chatMention = { ...baseChat, messages: { root: node('root', null, 'assistant', 'Welcome to Veyra.', 1),
    u1: node('u1', 'root', 'user', 'Have you seen Mira down by the docks?', 2) }, activeLeafId: 'u1' };
  const scenKw = { ...baseScenario, characterIds: ['CH2'] };
  const charsKw = { CH2: { id: 'CH2', name: 'Mira', content: 'Mira is a tide-witch.', keys: [], enabled: true } };
  const m3 = assemblePrompt({ scenario: scenKw, persona, chat: chatMention, settings, platformPrompt: '', characters: charsKw }).manifest;
  ok(m3.layers.lore.pieces.some(p => p.id === 'CH2' && p.reason === 'triggered'),
    'assembler: global character keyword-triggers on its name');
}

// ---- tool calls ----
section('tool calls');
{
  // parser
  ok(parseToolCalls('plain prose').text === 'plain prose'
    && parseToolCalls('plain prose').calls.length === 0, 'no blocks → text unchanged, no calls');
  {
    const t = 'She walks in.\n```tool\n{"tool":"register_character","args":{"name":"Vex","description":"wiry informant"}}\n```\n"Vex, at your service."';
    const p = parseToolCalls(t);
    ok(p.calls.length === 1 && p.calls[0].name === 'register_character' && p.calls[0].args.name === 'Vex',
      'complete block parsed (canonical "tool" field)');
    ok(!p.text.includes('```') && p.text.includes('She walks in.') && p.text.includes('at your service'),
      'block stripped from display text');
  }
  {
    const p = parseToolCalls('```tool\n{"name":"add_lore","args":{"title":"X","content":"Y"}}\n```');
    ok(p.calls.length === 1 && p.calls[0].name === 'add_lore', '"name" field accepted as alias');
  }
  {
    const p = parseToolCalls('```tool {"name":"add_lore","args":{"title":"X","content":"Y"}}``` done');
    ok(p.calls.length === 1 && p.calls[0].name === 'add_lore', 'single-line fence parsed');
  }
  {
    const p = parseToolCalls('a ```tool\n{"name":"add_lore",```\n b');
    ok(p.calls.length === 1 && p.calls[0].error === 'malformed JSON', 'malformed JSON reported, still stripped');
    ok(!p.text.includes('```'), 'malformed block removed from display');
  }
  {
    const p = parseToolCalls('story text ```tool\n{"name":"register_character","args":{"na');
    ok(p.calls.length === 0, 'unterminated fence is not a call');
    ok(p.text === 'story text', 'trailing unterminated fence hidden from display');
  }
  {
    const p = parseToolCalls('one ```tool\n{"name":"add_lore","args":{"title":"A","content":"a"}}\n``` two ```tool\n{"name":"add_lore","args":{"title":"B","content":"b"}}\n``` three');
    ok(p.calls.length === 2 && p.text === 'one  two  three', 'multiple blocks parsed and stripped');
  }
  // streaming strip
  ok(stripToolBlocks('abc ```tool\n{...partial') === 'abc ', 'streaming: unterminated fence hidden');
  ok(stripToolBlocks('a ```tool\n{"name":"x"}\n``` b') === 'a  b', 'streaming: complete block hidden');
  ok(stripToolBlocks('plain') === 'plain', 'streaming: plain text untouched');

  // stripToolBlocksMapped: display text must equal parseToolCalls' exactly,
  // and the map must project every stripped char back to its raw position.
  {
    const fixtures = [
      'plain prose, no blocks',
      'Hi ```tool\n{"tool":"add_lore","args":{"title":"X","content":"Y"}}\n``` there',
      'a ```tool\n{"tool":"x"}\n```\n\n\n\nb',
      'story text ```tool\n{"tool":"register_character","args":{"na',
      'one ```tool\n{"tool":"a"}\n``` two ```tool\n{"tool":"b"}\n``` three ```tool\n{"unterminated"',
      'a ```tool\n{"tool":"x","args":{"content":"a literal ```tool inside"}}\n``` b',
      '\n\n  ```tool\n{"tool":"x"}\n```\n\n',
    ];
    for (const f of fixtures) {
      const { text, map } = stripToolBlocksMapped(f);
      ok(text === parseToolCalls(f).text, `mapped strip matches parseToolCalls: ${JSON.stringify(f.slice(0, 40))}`);
      ok(map.length === text.length && [...text].every((ch, i) => f[map[i]] === ch),
        `map projects stripped→raw: ${JSON.stringify(f.slice(0, 40))}`);
    }
  }

  // executor
  {
    const r = applyToolCalls(baseChat, [{ name: 'register_character', args: { name: 'Vex', description: 'wiry informant' } }]);
    const piece = r.chat.lorePieces?.[0];
    ok(r.results[0].ok && piece?.type === 'character' && piece.title === 'Vex'
      && piece.keys.includes('Vex') && piece.enabled === true, 'register_character creates character piece');
    // update path: same name again → content updated, no duplicate
    const r2 = applyToolCalls(r.chat, [{ name: 'register_character', args: { name: 'vex', description: 'updated desc' } }]);
    ok(r2.chat.lorePieces.length === 1 && r2.chat.lorePieces[0].content === 'updated desc'
      && r2.results[0].note.startsWith('updated'), 'register_character dedupes by name (case-insensitive)');
  }
  {
    const r = applyToolCalls(baseChat, [{ name: 'add_lore', args: { title: 'The Tower', content: 'tall', keys: ['tower', 'x', 'ab', 'cd', 'ef', 'gh'] } }]);
    const piece = r.chat.lorePieces?.[0];
    ok(piece?.type === 'lore' && piece.keys.length === 5 && !piece.keys.includes('x'),
      'add_lore creates piece; keys filtered to min length 2, capped at 5');
  }
  {
    const r = applyToolCalls(baseChat, [{ name: 'nope', args: {} }]);
    ok(!r.results[0].ok && r.results[0].note.includes('unknown tool') && r.chat === baseChat,
      'unknown tool: note, chat unchanged');
    const r2 = applyToolCalls(baseChat, [{ name: 'register_character', args: { name: '', description: 'd' } }]);
    ok(!r2.results[0].ok && r2.chat === baseChat, 'missing required arg rejected');
    const r3 = applyToolCalls(baseChat, [{ name: '', args: {}, error: 'malformed JSON', raw: '{bad' }]);
    ok(!r3.results[0].ok && r3.results[0].note.includes('malformed JSON'), 'malformed call reported');
  }
  {
    const many = Array.from({ length: TOOL_CALL_CAP + 2 }, (_, i) =>
      ({ name: 'add_lore', args: { title: `L${i}`, content: 'c' } }));
    const r = applyToolCalls(baseChat, many);
    ok(r.chat.lorePieces.length === TOOL_CALL_CAP, 'call cap limits applied calls');
    ok(r.results.filter(x => x.note === 'call cap reached').length === 2, 'excess calls noted as capped');
  }
  // end-to-end: parse a reply, execute, piece lands in chat lore
  {
    const reply = 'A stranger approaches.\n```tool\n{"name":"register_character","args":{"name":"Mira","description":"scarred cartographer"}}\n```\n"Mira," she says.';
    const parsed = parseToolCalls(reply);
    const applied = applyToolCalls(baseChat, parsed.calls);
    ok(applied.chat.lorePieces?.[0]?.title === 'Mira', 'parse → execute end-to-end');
  }
  // provenance + prune + rewind rollback
  {
    const r = applyToolCalls(baseChat, [{ name: 'register_character', args: { name: 'Vex', description: 'd' } }],
      { nodeId: 'N1', now: 1000 });
    const piece = r.chat.lorePieces[0];
    ok(piece.createdBy === 'N1' && piece.createdAt === 1000, 'new tool pieces tagged with provenance');
    // update path preserves original provenance
    const r2 = applyToolCalls(r.chat, [{ name: 'register_character', args: { name: 'Vex', description: 'd2' } }],
      { nodeId: 'N2', now: 2000 });
    ok(r2.chat.lorePieces[0].createdBy === 'N1' && r2.chat.lorePieces[0].createdAt === 1000
      && r2.chat.lorePieces[0].content === 'd2', 'update keeps original provenance');
    // prune removes only that node's pieces
    const withManual = { ...r2.chat, lorePieces: [...r2.chat.lorePieces, lore({ id: 'M', title: 'Manual' })] };
    const pruned = pruneToolPieces(withManual, 'N1');
    ok(pruned.lorePieces.length === 1 && pruned.lorePieces[0].id === 'M', 'pruneToolPieces removes only createdBy-match');
    ok(pruneToolPieces(withManual, 'NOPE') === withManual, 'pruneToolPieces no-op when nothing matches');
    // rewind rolls tool lore back by createdAt; manual pieces survive
    let chat = baseChat;
    let r3 = appendMessage(chat, 'root', 'user', 'hi', null); chat = r3.chat; // createdAt: now
    const before = Date.now();
    const future = { ...chat, lorePieces: [
      lore({ id: 'M', title: 'Manual' }),                       // hand-authored: no createdAt
      { ...lore({ id: 'T', title: 'Tool' }), createdAt: before + 60000, createdBy: 'x' },
    ] };
    const rewound = rewindChat(future, 'root'); // cutoff = root swipe createdAt (1)
    ok(rewound.lorePieces.length === 1 && rewound.lorePieces[0].id === 'M',
      'rewind rolls back tool lore, keeps hand-authored pieces');
  }
}

// ---- multi-speaker segments ----
section('speaker segments');
{
  const names = ['Vex', 'Mira'];
  const seg = splitSpeakerSegments('plain narration, no prefixes', names);
  ok(seg.length === 1 && seg[0].speaker === null && seg[0].text === 'plain narration, no prefixes',
    'no prefixes → single narration segment');
  ok(splitSpeakerSegments('Vex: hi', null)[0].speaker === null, 'no names → narration');
  {
    const s = splitSpeakerSegments('Vex: hello there\nsecond line', names);
    ok(s.length === 1 && s[0].speaker === 'Vex' && s[0].text === 'hello there\nsecond line',
      'leading prefix: single character segment, prefix stripped');
  }
  {
    const s = splitSpeakerSegments('The door opens.\nVex: hi there\n**Mira:** *nods*\nNarrator: Silence falls.', names);
    ok(s.length === 4
      && s[0].speaker === null && s[0].text === 'The door opens.'
      && s[1].speaker === 'Vex' && s[1].text === 'hi there'
      && s[2].speaker === 'Mira' && s[2].text === '*nods*'
      && s[3].speaker === null && s[3].text === 'Silence falls.',
      'narration + two speakers + Narrator: resume splits in order');
  }
  {
    const s = splitSpeakerSegments('Vex: hi\nunmarked lines stay with Vex', names);
    ok(s.length === 1 && s[0].speaker === 'Vex' && s[0].text.includes('unmarked'),
      'unprefixed line continues the current segment (no Narrator: marker)');
  }
  {
    const s = splitSpeakerSegments('*Vex*: whispered words', names);
    ok(s.length === 1 && s[0].speaker === 'Vex' && s[0].text === 'whispered words', 'italic prefix splits');
  }
  {
    const s = splitSpeakerSegments('vex: lowercase still me', names);
    ok(s.length === 1 && s[0].speaker === 'Vex', 'case-insensitive name match');
  }
  {
    const s = splitSpeakerSegments('Stranger: not a known character', names);
    ok(s.length === 1 && s[0].speaker === null && s[0].text === 'Stranger: not a known character',
      'unknown name never splits');
  }
  {
    const s = splitSpeakerSegments('It was Vex: the informant.', names);
    ok(s.length === 1 && s[0].speaker === null, 'mid-sentence colon with non-name candidate does not split');
  }
  {
    const s = splitSpeakerSegments('Vex:\nMira: hi', names);
    ok(s.length === 1 && s[0].speaker === 'Mira', 'empty speaker part dropped');
  }
  {
    // Regression: the old `:\s*\*{0,2}\s*` tail ate an action's opening star.
    const s = splitSpeakerSegments('Mira: *nods*', names);
    ok(s.length === 1 && s[0].speaker === 'Mira' && s[0].text === '*nods*',
      'action star on the same line survives the prefix strip');
  }
  {
    const s = splitSpeakerSegments('Vex:\n*she waves*', names);
    ok(s.length === 1 && s[0].speaker === 'Vex' && s[0].text === '*she waves*',
      'action star on the next line survives the prefix strip');
  }
  {
    const s = splitSpeakerSegments('**Mira:** *nods*', names);
    ok(s.length === 1 && s[0].speaker === 'Mira' && s[0].text === '*nods*',
      'bold prefix closing stars still stripped');
  }
  // Duplicate-prefix tolerance (weak models repeat the current speaker).
  {
    const s = splitSpeakerSegments('Vex: first\nVex: second', names);
    ok(s.length === 1 && s[0].speaker === 'Vex' && s[0].text === 'first\nsecond',
      'duplicate prefix for the current speaker merges, stripped');
  }
  {
    const s = splitSpeakerSegments('Vex: hi\nNarrator: falls silent.\nNarrator: crickets.', names);
    ok(s.length === 2 && s[0].speaker === 'Vex'
      && s[1].speaker === null && s[1].text === 'falls silent.\ncrickets.',
      'repeated Narrator: parts merge into one narration segment');
  }
  {
    const s = splitSpeakerSegments('Narrator: opens.\nNarrator: continues.', names);
    ok(s.length === 1 && s[0].speaker === null && s[0].text === 'opens.\ncontinues.',
      'leading Narrator: + repeat → single narration segment');
  }
  {
    // The observed failure mode: mid-paragraph repeats inside one part.
    const s = splitSpeakerSegments('Vex: "hi" *waves* Vex: "again" *beams* Vex: "more"', names);
    ok(s.length === 1 && s[0].speaker === 'Vex' && s[0].text === '"hi" *waves* "again" *beams* "more"',
      'mid-line duplicate prefixes stripped inside the part');
  }
  {
    const s = splitSpeakerSegments('Vex: she said Mira: was late', names);
    ok(s.length === 1 && s[0].speaker === 'Vex' && s[0].text === 'she said Mira: was late',
      'mid-line prefix of another character stays literal');
  }
  {
    // Dedupe must not eat the legitimate kept prefix on the same line.
    const s = splitSpeakerSegments('Mira: Vex: hi', names);
    ok(s.length === 1 && s[0].speaker === 'Mira' && s[0].text === 'Vex: hi',
      'kept prefix survives when another name follows mid-line');
  }
  {
    const s = splitSpeakerSegments('Vex: hi\nplain line with vex: lowercase mid-line dup', names);
    ok(s.length === 1 && s[0].text === 'hi\nplain line with lowercase mid-line dup',
      'mid-line dedupe is case-insensitive');
  }
  // Fed-back history shows the clean form: the model doesn't learn the repeat
  // habit from its own raw output. User text stays verbatim.
  {
    const scen = { ...baseScenario, lorePieces: [lore({ id: 'LV', type: 'character', title: 'Vex', pinned: true })] };
    const chat = {
      ...baseChat,
      activeLeafId: 'a1',
      messages: {
        root: node('root', null, 'assistant', 'Welcome.', 1),
        u1: node('u1', 'root', 'user', 'Vex: I say Vex: things twice', 2),
        a1: node('a1', 'u1', 'assistant', 'Vex: "hi" *waves* Vex: "again"\nNarrator: hush.\nNarrator: more hush.', 3),
      },
    };
    const { messages } = assemblePrompt({ scenario: scen, persona, chat, settings, platformPrompt: '' });
    const fed = messages.find(m => m.role === 'assistant' && m.content.includes('"hi"'));
    ok(fed && fed.content === 'Vex: "hi" *waves* "again"\nNarrator: hush.\nmore hush.',
      'assembler strips duplicate speaker prefixes from fed-back history');
    const user = messages.find(m => m.role === 'user' && m.content.includes('twice'));
    ok(user && user.content === 'Vex: I say Vex: things twice', 'user messages stay verbatim');
  }
}

// ---- story variables + author's note + lore queue ----
section('vars, notes, queue');
{
  ok(subVars('HP: {{var:hp}}/{{var:max hp}}', { hp: '7', 'max hp': '12' }) === 'HP: 7/12', 'subVars substitutes');
  ok(subVars('x{{var:nope}}y', {}) === 'xy', 'unknown var → empty');
  {
    const chat = { ...baseChat, vars: { city: 'Veyra' }, authorsNote: 'Keep it grounded.' };
    const scen = { ...baseScenario, backstory: 'Welcome to {{var:city}}.' };
    const { messages } = assemblePrompt({ scenario: scen, persona, chat, settings, platformPrompt: '' });
    ok(messages[0].content.includes('Welcome to Veyra.'), '{{var}} substituted in backstory');
    ok(messages[0].content.includes("Author's note: Keep it grounded."), "author's note injected into static layer");
  }
  // queue helpers
  {
    const q1 = queueLorePiece(baseChat, { title: 'Old Mill', content: 'abandoned', keys: ['mill'], source: 'extract' });
    ok(q1.loreQueue.length === 1 && q1.loreQueue[0].source === 'extract', 'queueLorePiece appends');
    const qid = q1.loreQueue[0].id;
    const acc = acceptQueuedLore(q1, qid);
    ok(acc.loreQueue.length === 0 && acc.lorePieces.length === 1 && acc.lorePieces[0].title === 'Old Mill'
      && acc.lorePieces[0].createdBy === undefined && acc.lorePieces[0].enabled === true,
      'accept moves to lorePieces as user-owned (provenance stripped)');
    const q2 = queueLorePiece(baseChat, { title: 'X', content: 'y' });
    const dis = dismissQueuedLore(q2, q2.loreQueue[0].id);
    ok(dis.loreQueue.length === 0, 'dismiss discards');
  }
  // add_lore queue routing
  {
    const r = applyToolCalls(baseChat, [{ name: 'add_lore', args: { title: 'Tower', content: 'tall' } }], { queueLore: true });
    ok(r.chat.loreQueue?.[0]?.title === 'Tower' && !r.chat.lorePieces, 'queueLore routes new titles to the queue');
    ok(r.results[0].note.includes('queued'), 'queue routing noted');
    // existing title still updates directly (already-admitted lore)
    const withPiece = { ...baseChat, lorePieces: [lore({ id: 'T', title: 'Tower', keys: ['tower'] })] };
    const r2 = applyToolCalls(withPiece, [{ name: 'add_lore', args: { title: 'tower', content: 'taller' } }], { queueLore: true });
    ok(r2.chat.lorePieces[0].content === 'taller' && !r2.chat.loreQueue, 'queueLore: existing titles update directly');
  }
  // rewind resets the extraction cursor alongside memory
  {
    const chat = { ...baseChat, emergentCursor: 99 };
    const rw = rewindChat(chat, 'root');
    ok(rw.emergentCursor === rw.memoryStore.cursor, 'rewind rolls back emergentCursor');
  }
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

  // user-editable length directive overrides the preset default; '' = none
  const withDirective = assemblePrompt({
    scenario, persona, chat,
    settings: { contextLength: 8192, maxTokens: 400, lengthDirective: 'Answer in exactly two sentences.' },
    platformPrompt: '',
  });
  ok(withDirective.messages[0].content.includes('exactly two sentences'), 'custom length directive used');
  ok(!withDirective.messages[0].content.includes('moderate length'), 'preset directive replaced by custom one');
  const noDirective = assemblePrompt({
    scenario, persona, chat,
    settings: { contextLength: 8192, maxTokens: 400, lengthDirective: '' },
    platformPrompt: '',
  });
  ok(!noDirective.messages[0].content.includes('moderate length'), 'blank length directive injects nothing');

  // user-overridable layer budget fractions change the caps; defaults unchanged
  const b = 8192 - 400;
  const withCaps = assemblePrompt({
    scenario, persona, chat,
    settings: { contextLength: 8192, maxTokens: 400, layerCaps: { static: 0.10, lore: 0.50, memory: 0.05 } },
    platformPrompt: '',
  });
  ok(withCaps.manifest.layers.static.cap === Math.floor(b * 0.10), 'custom static layer cap honored');
  ok(withCaps.manifest.layers.lore.cap === Math.floor(b * 0.50), 'custom lore layer cap honored');
  ok(withCaps.manifest.layers.memory.cap === Math.floor(b * 0.05), 'custom memory layer cap honored');
  const defaultCaps = assemblePrompt({
    scenario, persona, chat, settings: { contextLength: 8192, maxTokens: 400 }, platformPrompt: '',
  });
  ok(defaultCaps.manifest.layers.lore.cap === Math.floor(b * LAYER_CAPS.lore), 'default caps unchanged without override');

  // estimate/scan knobs: settings.tokenChars flows into every layer estimate
  const coarse = assemblePrompt({ scenario, persona, chat, settings: { contextLength: 8192, maxTokens: 400 }, platformPrompt: '' });
  const fine = assemblePrompt({
    scenario, persona, chat,
    settings: { contextLength: 8192, maxTokens: 400, tokenChars: 2 }, platformPrompt: '',
  });
  ok(fine.manifest.totalTokens > coarse.manifest.totalTokens, 'smaller chars/token inflates all layer estimates');
}

// ---- estimateTokens / scanLore option plumbing ----
section('estimate + scan knobs');
{
  ok(estimateTokens('abcd', 2) === 2, 'estimateTokens honors custom chars/token');
  ok(estimateTokens('abcd', 0) === estimateTokens('abcd'), 'invalid chars/token falls back to the default');

  const linked = [
    lore({ id: 'a', keys: ['xy'], links: ['b'] }),
    lore({ id: 'b', keys: [] }),
  ];
  ok(scanLore(linked, 'xy marks it', null, { linkBoost: 5 }).get('b').boost === 5, 'custom link boost honored');
  ok(scanLore(linked, 'xy marks it').get('b').boost === LINK_BOOST, 'default link boost unchanged');

  const farKey = [lore({ id: 'k', keys: ['needle'] })];
  const hay = 'needle' + ' y'.repeat(50);
  ok(scanLore(farKey, hay).has('k'), 'default search depth finds a distant key');
  ok(!scanLore(farKey, hay, null, { searchDepth: 10, chars: 1 }).has('k'), 'custom search depth narrows the scan window');
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

// ---- /pov reframe ----
section('/pov reframe');
{
  const scenario = {
    ...baseScenario,
    lorePieces: [
      lore({ id: 'c1', title: 'Veyra', type: 'character', keys: [], weight: 0, content: 'Veyra is a scout.' }),
    ],
  };
  // pov forces the character piece in with reason 'pov' (no keyword match needed)
  const { messages, manifest } = assemblePrompt({
    scenario, persona, chat: baseChat,
    settings: { contextLength: 8192, maxTokens: 400 }, platformPrompt: '',
    pov: { name: 'Veyra', pieceId: 'c1' },
  });
  ok(manifest.layers.lore.pieces[0]?.reason === 'pov', 'pov piece injected with reason pov');
  ok(messages[0].content.includes("from Veyra's perspective") && messages[0].content.includes('"Veyra:"'),
    'pov directive appended to the static layer');
  // pov without a matching piece still emits the directive
  const noPiece = assemblePrompt({
    scenario: baseScenario, persona, chat: baseChat,
    settings: { contextLength: 8192, maxTokens: 400 }, platformPrompt: '',
    pov: { name: 'Nobody', pieceId: null },
  });
  ok(noPiece.messages[0].content.includes("from Nobody's perspective"), 'piece-less pov still reframes');
  ok(noPiece.manifest.layers.lore.pieces.length === 0, 'piece-less pov injects no lore');
  // Map-based preActivated carries custom reasons; semantic Set still works alongside
  const scan = scanLore(scenario.lorePieces, 'nothing', new Map([['c1', 'pov']]));
  ok(scan.get('c1')?.reason === 'pov', 'Map preActivated activates with its custom reason');
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

// ---- pruneInterrupted (reload debris) ----
section('pruneInterrupted');
{
  // chat: root → user u1 → assistant a1 (2 swipes, second empty) → user u2 → assistant a2 (empty placeholder)
  let chat = baseChat;
  chat = appendMessage(chat, 'root', 'user', 'hi').chat;
  const u1 = chat.activeLeafId;
  chat = appendMessage(chat, u1, 'assistant', 'hello').chat;
  const a1 = chat.activeLeafId;
  // a1 gains an empty second swipe (interrupted regenerate)
  const a1node = chat.messages[a1];
  chat = { ...chat, messages: { ...chat.messages, [a1]: { ...a1node,
    swipes: [...a1node.swipes, { text: '', createdAt: 9, modelId: null }], activeSwipe: 1, usedSwipe: 0 } } };
  chat = appendMessage(chat, a1, 'user', 'again').chat;
  const u2 = chat.activeLeafId;
  chat = appendMessage(chat, u2, 'assistant', '').chat; // placeholder, never filled
  const a2 = chat.activeLeafId;

  const pruned = pruneInterrupted(chat);
  ok(pruned.messages[a1].swipes.length === 1, 'empty swipe removed from a1');
  ok(pruned.messages[a1].activeSwipe === 0, 'activeSwipe clamped after prune');
  ok(pruned.messages[a1].usedSwipe === 0, 'usedSwipe remapped after prune');
  ok(!pruned.messages[a2], 'all-empty placeholder node dropped');
  ok(pruned.activeLeafId === u2, 'leaf walked up to the dropped node\'s parent');
  ok(pruned.messages.root.swipes.length === 1 && pruned.messages.root.swipes[0].text !== '',
    'root greeting untouched');
  ok(pruneInterrupted(pruned) === pruned, 'prune is a no-op (same object) when clean');
  ok(pruneInterrupted(baseChat) === baseChat, 'clean chat passes through unchanged');
}

// ---- macro substitution edge cases ----
section('macro edge cases');
{
  ok(subUser('Hi {{user}}!', 'A$&B') === 'Hi A$&B!', 'persona name with $& substitutes literally');
  ok(subUser('{{user}} x {{user}}', '$$') === '$$ x $$', 'persona name with $$ substitutes literally');
  ok(subVars('{{var:Score}}', { score: '5' }) === '5', 'var lookup is case-insensitive');
  ok(subVars('{{var:hp}}', { HP: '1', hp: '2' }) === '2', 'exact-case key wins on collision');
  ok(subVars('{{var:Missing}}', { score: '5' }) === '', 'unknown var still substitutes empty');
}

// ---- sampler param expansion (dotted custom-sampler keys) ----
section('sampler param expansion');
{
  const flat = expandSamplerParams({ temperature: 0.8, top_p: 0.95 });
  ok(flat.temperature === 0.8 && flat.top_p === 0.95, 'flat keys pass through');
  ok(expandSamplerParams({ 'chat_template_kwargs.enable_thinking': true })
    .chat_template_kwargs?.enable_thinking === true, 'dotted key nests');
  const merged = expandSamplerParams({ 'a.b': 1, 'a.c': 2, temperature: 0.7 });
  ok(merged.a?.b === 1 && merged.a?.c === 2 && merged.temperature === 0.7, 'siblings deep-merge');
  const skipped = expandSamplerParams({ a: null, b: undefined, c: 1 });
  ok(!('a' in skipped) && !('b' in skipped) && skipped.c === 1, 'null/undefined dropped');
  ok(expandSamplerParams({ 'a.b': 1, a: 5 }).a === 5, 'flat/dotted collision last-write-wins');
  ok(expandSamplerParams(null) && Object.keys(expandSamplerParams(null)).length === 0, 'null input → empty');
  // Hostile keys: prototype-chain segments are skipped entirely
  const hostile = expandSamplerParams({ '__proto__.polluted': 1, 'a.__proto__.b': 2, 'constructor.x': 3, ok: 4 });
  ok(Object.keys(hostile).join(',') === 'ok' && ({}).polluted === undefined && Object.prototype.polluted === undefined,
    '__proto__/constructor/prototype segments rejected, no pollution');
}

// ---- rewind: position-based (atLen) cutoff ----
section('rewind atLen cutoff');
{
  // root(1) → m1(2) → m2(3); m1's active swipe is a REGENERATE with a fresh
  // createdAt (9000) — wall-clock cutoffs break here, position cutoffs don't.
  // Each entry's createdAt is arranged to contradict its atLen outcome, so the
  // test only passes if atLen takes precedence:
  //   kept  entries have createdAt AFTER  the fallback cutoff (9000)
  //   dropped entries have createdAt BEFORE the fallback cutoff
  const m1 = { id: 'm1', parentId: 'root', role: 'user', activeSwipe: 1, edited: false,
    swipes: [{ text: 'v1', createdAt: 10, modelId: null }, { text: 'v2', createdAt: 9000, modelId: null }] };
  const chat = {
    ...baseChat,
    messages: {
      root: node('root', null, 'assistant', 'hi', 1),
      m1,
      m2: node('m2', 'm1', 'assistant', 'there', 9500),
    },
    activeLeafId: 'm2',
    memoryStore: { memories: [
      { id: 'memOld', text: 'old', pinned: false, createdAt: 9500, atLen: 2 },
      { id: 'memNew', text: 'new', pinned: false, createdAt: 8000, atLen: 3 },
    ], cursor: 3 },
    lorePieces: [
      lore({ id: 'M', title: 'Manual' }), // hand-authored: no provenance
      { ...lore({ id: 'T1', title: 'ToolEarly' }), createdAt: 9600, createdBy: 'm1', atLen: 2 },
      { ...lore({ id: 'T2', title: 'ToolLate' }), createdAt: 8000, createdBy: 'm2', atLen: 3 },
    ],
    loreQueue: [
      { id: 'q1', title: 'QEarly', content: 'x', keys: [], source: 'tool', createdAt: 9700, atLen: 2 },
      { id: 'q2', title: 'QLate', content: 'x', keys: [], source: 'tool', createdAt: 8000, atLen: 3 },
    ],
  };
  const rw = rewindChat(chat, 'm1'); // pathLen = 2
  ok(rw.memoryStore.memories.map(m => m.id).join(',') === 'memOld',
    'atLen memories: regenerate-safe position cutoff (new swipe createdAt irrelevant)');
  ok(rw.lorePieces.map(p => p.id).join(',') === 'M,T1',
    'atLen tool lore rolls back by position; hand-authored pieces survive');
  ok(rw.loreQueue.map(q => q.id).join(',') === 'q1',
    'loreQueue proposals roll back with the same rule');
  ok(rw.memoryStore.cursor === 2 && rw.emergentCursor === 2, 'cursors reset to path length');
  // entries WITHOUT atLen still fall back to the createdAt cutoff
  const untagged = { ...baseChat,
    memoryStore: { memories: [
      { id: 'a', text: 'a', pinned: false, createdAt: 0 },
      { id: 'b', text: 'b', pinned: false, createdAt: Date.now() + 100000 },
    ], cursor: 0 },
    loreQueue: [{ id: 'q', title: 'Q', content: 'x', keys: [], source: 'tool', createdAt: Date.now() + 100000 }] };
  const rw2 = rewindChat(untagged, 'root');
  ok(rw2.memoryStore.memories.length === 1 && rw2.memoryStore.memories[0].id === 'a',
    'entries without atLen fall back to the createdAt cutoff');
  ok(rw2.loreQueue.length === 0, 'loreQueue entries without atLen fall back too');
}

// ---- pruneInterrupted purity ----
section('pruneInterrupted purity');
{
  let chat = baseChat;
  chat = appendMessage(chat, 'root', 'user', 'hi').chat;
  const u1 = chat.activeLeafId;
  chat = appendMessage(chat, u1, 'assistant', '').chat; // placeholder, dropped by prune
  const a1 = chat.activeLeafId;
  chat = appendMessage(chat, a1, 'user', 'again').chat;
  const u2 = chat.activeLeafId;
  const pruned = pruneInterrupted(chat);
  ok(pruned.messages[u2].parentId === u1, 'child of dropped node re-parented to grandparent');
  ok(chat.messages[u2].parentId === a1, 'input chat nodes not mutated by prune');
  ok(pruned.messages[u2] !== chat.messages[u2], 're-parented node is a clone');
}

// ---- digit-named speakers ----
section('digit-named speakers');
{
  const names = ['R2-D2', 'Agent 47'];
  const s = splitSpeakerSegments('R2-D2: beep boop\nNarrator: The droid rolls off.\nAgent 47: Target down.', names);
  ok(s.length === 3
    && s[0].speaker === 'R2-D2' && s[0].text === 'beep boop'
    && s[1].speaker === null && s[1].text === 'The droid rolls off.'
    && s[2].speaker === 'Agent 47' && s[2].text === 'Target down.',
    'splitSpeakerSegments splits digit-named speakers');
  ok(detectSpeaker('R2-D2: beep boop', names) === 'R2-D2', 'detectSpeaker matches a digit-named speaker');
  ok(detectSpeaker('Agent 47: Target down.', names) === 'Agent 47', 'detectSpeaker matches a space+digit name');
  ok(detectSpeaker('R2-D2: beep', ['C-3PO']) === null, 'unknown digit name still not attributed');
}

// ---- register_character dedupe across all pieces ----
section('register_character cross-origin dedupe');
{
  const scenPiece = lore({ id: 'SC1', title: 'Vex', type: 'character', content: 'scenario desc', keys: ['vex'] });
  const chat = { ...baseChat, lorePieces: [] };
  const allPieces = [scenPiece]; // merged scenario + global + chat list from the caller
  const r = applyToolCalls(chat, [{ name: 'register_character', args: { name: 'vex', description: 'new desc' } }], {}, allPieces);
  ok(r.results[0].ok && r.results[0].note.startsWith('updated'), 'scenario-level match reported as an update');
  ok(r.chat.lorePieces.length === 1 && r.chat.lorePieces[0].id === 'SC1' && r.chat.lorePieces[0].content === 'new desc',
    'scenario piece shadowed via the chat overlay — no duplicate');
  const merged = mergedLorePieces({ ...baseScenario, lorePieces: [scenPiece] }, r.chat);
  ok(merged.filter(p => p.type === 'character' && p.title.trim().toLowerCase() === 'vex').length === 1,
    'merged view keeps a single piece for the name');
  ok(Number.isFinite(r.chat.lorePieces[0].createdAt) && 'createdBy' in r.chat.lorePieces[0],
    'shadow copy carries fresh provenance so rewind drops it again');
  // old call shape (no allPieces) still dedupes within the overlay
  const r2 = applyToolCalls(r.chat, [{ name: 'register_character', args: { name: 'VEX', description: 'third' } }]);
  ok(r2.chat.lorePieces.length === 1 && r2.chat.lorePieces[0].content === 'third',
    'old call shape still dedupes inside the overlay');
}

// ---- add_lore dedupe across all pieces ----
section('add_lore cross-origin dedupe');
{
  const scenLore = lore({ id: 'SL1', title: 'The Ash Gate', content: 'scenario text', keys: ['gate'] });
  const chat = { ...baseChat, lorePieces: [] };
  const allPieces = [scenLore];
  const r = applyToolCalls(chat, [{ name: 'add_lore', args: { title: 'the ash gate', content: 'updated text' } }], {}, allPieces);
  ok(r.results[0].ok && r.results[0].note.startsWith('updated'), 'scenario-level lore match reported as an update');
  ok(r.chat.lorePieces.length === 1 && r.chat.lorePieces[0].id === 'SL1' && r.chat.lorePieces[0].content === 'updated text',
    'scenario lore shadowed via the chat overlay — no duplicate');
  const merged = mergedLorePieces({ ...baseScenario, lorePieces: [scenLore] }, r.chat);
  ok(merged.filter(p => (p.title ?? '').trim().toLowerCase() === 'the ash gate').length === 1,
    'merged view keeps a single piece for the title');
  ok(Number.isFinite(r.chat.lorePieces[0].createdAt) && 'createdBy' in r.chat.lorePieces[0],
    'lore shadow copy carries fresh provenance');
}

// ---- memory render order ----
section('memory render order');
{
  const chat = { ...baseChat, memoryStore: { memories: [
    { id: 'mPin', text: 'PINNED fact', pinned: true, createdAt: 5 },
    { id: 'mOld', text: 'OLD event', pinned: false, createdAt: 1 },
    { id: 'mNew', text: 'NEW event', pinned: false, createdAt: 10 },
  ], cursor: 0 } };
  const { messages, manifest } = assemblePrompt({
    scenario: baseScenario, persona, chat,
    settings: { contextLength: 8192, maxTokens: 400 }, platformPrompt: '' });
  const memMsg = messages.find(m => m.role === 'system' && m.content.startsWith('[Memories]'));
  const iOld = memMsg.content.indexOf('OLD event');
  const iPin = memMsg.content.indexOf('PINNED fact');
  const iNew = memMsg.content.indexOf('NEW event');
  ok(iOld !== -1 && iOld < iPin && iPin < iNew,
    'selected memories render oldest→newest regardless of pin/fill priority');
  ok(manifest.layers.memory.memories.map(m => m.id).join(',') === 'mOld,mPin,mNew',
    'manifest memory list matches render order');
}

// ---- static layer cap warning ----
section('static layer cap warning');
{
  // budget 600, staticCap 180; a huge platform prompt with NO backstory means
  // nothing is truncated — the layer simply exceeds its cap.
  const { manifest } = assemblePrompt({
    scenario: { ...baseScenario, backstory: '' },
    persona, chat: baseChat,
    settings: { contextLength: 1000, maxTokens: 400 },
    platformPrompt: 'x'.repeat(2000),
  });
  ok(manifest.layers.static.tokens > manifest.layers.static.cap, 'oversized static layer reported over cap');
  ok(manifest.warnings.some(w => /Static layer exceeds its budget cap/.test(w)),
    'manifest warns when non-backstory static text exceeds the cap');
  const fine = assemblePrompt({
    scenario: { ...baseScenario, backstory: '' }, persona, chat: baseChat,
    settings: { contextLength: 8192, maxTokens: 400 }, platformPrompt: '' });
  ok(!fine.manifest.warnings.some(w => /Static layer exceeds its budget cap/.test(w)),
    'no warning when the static layer is within its cap');
}

// ---- tool fence edge cases ----
section('tool fence edge cases');
{
  const t = 'Intro ```tool\n{"tool":"add_lore","args":{"title":"X","content":"a literal ```tool inside"}}\n``` outro';
  const p = parseToolCalls(t);
  // The fence regex ends the block at the inner literal, so the call is
  // malformed — the point is that the trailing-fence scan must NOT treat that
  // inner literal as an unterminated fence and truncate the text after it.
  ok(p.calls.length === 1 && p.calls[0].error === 'malformed JSON',
    'literal ```tool in JSON: block reported malformed, still stripped');
  ok(p.text.includes('Intro') && p.text.includes('outro'),
    'display text after the block survives the trailing-fence scan');
  const q = parseToolCalls('a ```tool\n{"tool":"x"}\n``` b ```tool\n{"partial"');
  ok(q.text === 'a  b', 'real trailing unterminated fence still hidden');
}

// ---- auto limits (resolveLimits) ----
section('auto limits');
{
  // Undetected model → defaults; reserve = ctx/16.
  let l = resolveLimits({});
  ok(l.contextLength === 8192 && l.maxTokens === 512, 'no detection → 8192 ctx, 512 reserve');
  l = resolveLimits({ modelCtxs: { m: 262144 }, model: 'm' });
  ok(l.contextLength === 262144, 'detected 256k used verbatim (no cap)');
  ok(l.maxTokens === 16384, '256k → reserve 16384 (ctx/16, no clamp)');
  l = resolveLimits({ modelCtxs: { m: 32768 }, model: 'm' });
  ok(l.contextLength === 32768 && l.maxTokens === 2048, '32k → reserve 2048 (ctx/16)');
  l = resolveLimits({ modelCtxs: { m: 2048 }, model: 'm' });
  ok(l.contextLength === 2048 && l.maxTokens === 128, 'small detected ctx used verbatim (no floor)');
  // User-pinned knobs win over detection.
  l = resolveLimits({ modelCtxs: { m: 262144 }, model: 'm', ctxAuto: false, contextLength: 16384 });
  ok(l.contextLength === 16384, 'ctxAuto false → manual context wins');
  ok(l.maxTokens === 1024, 'manual ctx still gets auto reserve (16384/16 = 1024)');
  l = resolveLimits({ modelCtxs: { m: 262144 }, model: 'm', reserveAuto: false, maxTokens: 500 });
  ok(l.maxTokens === 500, 'reserveAuto false → manual reserve wins');
  // Explicit model argument beats settings.model for the lookup.
  l = resolveLimits({ modelCtxs: { a: 65536, b: 8192 }, model: 'a' }, 'b');
  ok(l.contextLength === 8192, 'model argument selects the detected entry');
  ok(autoReserve(262144) === 16384 && autoReserve(100) === 6 && autoReserve(0) === 1, 'autoReserve = ctx/16, min 1');
}

// ---- pruneInterrupted: cycle guard ----
section('pruneInterrupted cycle guard');
{
  // A parentId 2-cycle of empty-swipe assistant nodes (only creatable via a
  // crafted import) — the seen-set guards must terminate, not hang the tab.
  const cyc = {
    id: 'C', rootMessageId: 'root', activeLeafId: 'a',
    messages: {
      root: node('root', null, 'assistant', 'hi', 1),
      a: { id: 'a', parentId: 'b', role: 'assistant', activeSwipe: 0, swipes: [{ text: '', createdAt: 2, modelId: null }] },
      b: { id: 'b', parentId: 'a', role: 'assistant', activeSwipe: 0, swipes: [{ text: '', createdAt: 3, modelId: null }] },
    },
  };
  const pruned = pruneInterrupted(cyc); // hung forever before the guard
  ok(!pruned.messages.a && !pruned.messages.b, 'cyclic placeholder nodes dropped');
  ok(pruned.activeLeafId === null, 'leaf walk into a cycle terminates detached');
  // Kept node whose parent chain enters the cycle re-parents to root.
  const cyc2 = {
    id: 'C', rootMessageId: 'root', activeLeafId: 'k',
    messages: {
      root: node('root', null, 'assistant', 'hi', 1),
      a: { id: 'a', parentId: 'b', role: 'assistant', activeSwipe: 0, swipes: [{ text: '', createdAt: 2, modelId: null }] },
      b: { id: 'b', parentId: 'a', role: 'assistant', activeSwipe: 0, swipes: [{ text: '', createdAt: 3, modelId: null }] },
      k: { id: 'k', parentId: 'a', role: 'user', activeSwipe: 0, swipes: [{ text: 'kept', createdAt: 4, modelId: null }] },
    },
  };
  const pruned2 = pruneInterrupted(cyc2);
  ok(pruned2.messages.k?.parentId === null, 'kept child of a cycle re-parents to root');
}

// ---- keyMatches: unicode whole-word ----
section('keyMatches unicode whole-word');
{
  ok(keyMatches('café', 'un café au lait', { wholeWord: true }) === true, 'wholeWord: accented key edge matches');
  ok(keyMatches('café', 'cafeteria', { wholeWord: true }) === false, 'wholeWord: accented key inside a longer word rejected');
  ok(keyMatches('cat', 'the cathedral', { wholeWord: true }) === false, 'wholeWord: ASCII regression — no substring match');
  ok(keyMatches('cat', 'a cat!', { wholeWord: true }) === true, 'wholeWord: ASCII match beside punctuation');
  ok(keyMatches('猫咪', '说 猫咪 好', { wholeWord: true }) === true, 'wholeWord: CJK key bounded by spaces matches');
  ok(keyMatches('猫咪', '有猫咪在', { wholeWord: true }) === false, 'wholeWord: CJK key inside a longer run rejected');
  ok(keyMatches('cat', 'concatenate', {}) === true, 'non-wholeWord path unchanged (substring)');
}

// ---- tool fence: opener boundary ----
section('tool fence opener boundary');
{
  const lit = parseToolCalls('using ```tools here\nmore text after');
  ok(lit.calls.length === 0 && lit.text === 'using ```tools here\nmore text after',
    '```tools literal is not a fence — text kept verbatim');
  const lit2 = parseToolCalls('a ```toolbox\n b');
  ok(lit2.calls.length === 0 && lit2.text.includes('```toolbox'), '```toolbox literal is not a fence');
  ok(stripToolBlocks('keep ```tools around') === 'keep ```tools around',
    'streaming strip leaves ```tools alone');
  const real = parseToolCalls('x ```tool\n{"tool":"add_lore","args":{"title":"T","content":"c"}}\n``` y');
  ok(real.calls.length === 1 && real.calls[0].name === 'add_lore' && real.text === 'x  y',
    'a real ```tool fence still parses and strips');
}

// ---- speaker splitting: digit-leading / long names ----
section('speaker splitting: digit-leading and long names');
{
  ok(splitSpeakerSegments('2B: hello there', ['2B'])[0].speaker === '2B', 'digit-leading name splits');
  ok(splitSpeakerSegments('7 of 9: resist', ['7 of 9'])[0].speaker === '7 of 9', 'digit-leading multi-word name splits');
  const long45 = `Commander ${'A'.repeat(39)}`; // 50 chars — over the old 40 cap, under TOOL_NAME_MAX
  ok(splitSpeakerSegments(`${long45}: at ease`, [long45])[0].speaker === long45, '50-char name splits');
  ok(splitSpeakerSegments('2024: a recap', ['Mia']).length === 1
    && splitSpeakerSegments('2024: a recap', ['Mia'])[0].speaker === null,
    'unknown digit-leading line never splits');
  ok(dedupeSpeakerPrefixes('2B: one\n2B: two', ['2B']) === '2B: one\ntwo', 'digit-leading repeat prefix deduped');
  ok(detectSpeaker('2B: beep boop', ['2B']) === '2B', 'detectSpeaker attributes digit-leading names');
}

// ---- selectLore: macro-substituted budgeting ----
section('selectLore substituted budgeting');
{
  const pieces = [lore({ id: 'L1', title: 'A', content: '{{user}} '.repeat(80).trim(), keys: ['apple'] })];
  // Raw content ≈ 218 tokens (719 chars) — fits the 250 budget; substituted
  // (each {{user}} → 20 chars) ≈ 509 tokens — must NOT fit.
  const sel = selectLore(pieces, 'apple', 250, null, { sub: (t) => t.replaceAll('{{user}}', 'A'.repeat(20)) });
  ok(sel.length === 0, 'budget applies to the substituted (rendered) text');
  const selRaw = selectLore(pieces, 'apple', 250, null, {});
  ok(selRaw.length === 1, 'identity sub (default) keeps raw budgeting');
}

// ---- import normalization ----
section('import normalization');
{
  const ns = normalizeScenario({ name: 'X' });
  ok(Array.isArray(ns.lorePieces) && ns.lorePieces.length === 0, 'scenario missing lorePieces → []');
  ok(ns.tags.length === 0 && ns.backstory === '' && ns.greeting === '' && ns.characterIds.length === 0,
    'scenario string/array fields coerced');
  const np = normalizeScenario({ name: 'Y', lorePieces: [{ title: 'T' }] });
  ok(np.lorePieces[0].id && np.lorePieces[0].keys.length === 0 && np.lorePieces[0].content === '',
    'piece healed: id minted, keys [], content string');
  ok(normalizeLorePiece(null).title === '', 'non-object piece heals to shape');
  const nc = normalizeCharacter({ name: 'Z' });
  ok(nc.keys.length === 0 && nc.greeting === '' && nc.color === '', 'character fields coerced');
  const ncDef = normalizeCharacter({ name: 'Z', model: ' qwen ', samplers: { top_k: 20 } });
  ok(ncDef.model === 'qwen' && ncDef.samplers.top_k === 20, 'character model/samplers pass through (model trimmed)');
  const ncBad = normalizeCharacter({ name: 'Z', model: ' ', samplers: [1] });
  ok(ncBad.model === undefined && ncBad.samplers === undefined, 'character blank model / malformed samplers coerced away');
  const chat = normalizeChat({ id: 'C', activeLeafId: 'r', messages: { r: { id: 'r', parentId: null, role: 'assistant' } } });
  ok(chat.messages.r.swipes.length === 1 && chat.messages.r.activeSwipe === 0,
    'swipes-less node gets a placeholder swipe, activeSwipe coerced');
  const c2 = normalizeChat({ id: 'C', messages: { r: { id: 'r', parentId: null, role: 'assistant', swipes: [{ text: 'a' }, { text: 'b' }], activeSwipe: 9 } } });
  ok(c2.messages.r.activeSwipe === 1, 'activeSwipe clamped into range');
  ok(normalizeChat(null).messages && Object.keys(normalizeChat(null).messages).length === 0,
    'non-object chat heals to an empty tree');
  const nm = normalizeScenario({ name: 'M', model: '  qwen3  ', samplers: { temperature: 0.7 } });
  ok(nm.model === 'qwen3' && nm.samplers.temperature === 0.7, 'scenario model/samplers pass through (model trimmed)');
  const nmBad = normalizeScenario({ name: 'M', model: '   ', samplers: 'nope' });
  ok(nmBad.model === undefined && nmBad.samplers === undefined, 'blank model / malformed samplers coerced away');
  ok(Array.isArray(normalizeScenario({ name: 'M', alternateGreetings: 'x' }).alternateGreetings)
    && normalizeScenario({ name: 'M', alternateGreetings: 'x' }).alternateGreetings.length === 0,
    'malformed alternateGreetings heals to []');
}

// ---- character card import (chara_card v1/v2/v3 + PNG) ----
section('character card import');
{
  const cardJson = {
    spec: 'chara_card_v2', spec_version: '2.0',
    data: {
      name: 'Mia Voss',
      description: 'A smuggler. {{char}} is quick-witted.',
      personality: 'bold, sardonic',
      scenario: 'The docks of Veyra.',
      first_mes: 'Mia Voss: "Well, look who it is."',
      mes_example: 'Mia Voss: "Example line."',
      system_prompt: 'Stay in character.',
      post_history_instructions: 'End with a hook.',
      creator_notes: 'by someone',
      tags: ['scifi'],
      alternate_greetings: ['Alt one for {{char}}.', '', 42],
      character_book: { entries: [
        { keys: ['Veyra'], content: 'Floating city.', constant: true, enabled: true, comment: 'Veyra' },
        { keys: ['Dr. Vex', 'x'], content: 'A medic.', enabled: false, case_sensitive: true },
      ] },
    },
  };
  const parsed = parseCharacterCard(cardJson);
  ok(parsed && parsed.scenario && parsed.character, 'v2 card parses');
  const { scenario: cs, character: cc } = parsed;
  ok(cc.name === 'Mia Voss' && cc.greeting === cardJson.data.first_mes && cc.keys.length === 0,
    'character: name/greeting set, keys blank (name is the default key)');
  ok(cc.content.includes('A smuggler. Mia Voss is quick-witted.'), '{{char}} binds to the card name');
  ok(cc.content.includes('Personality: bold, sardonic') && cc.content.includes('Example dialogue:\nMia Voss: "Example line."'),
    'personality + mes_example folded into character content');
  ok(cs.backstory === 'The docks of Veyra.' && cs.greeting === cardJson.data.first_mes,
    'scenario field → backstory; first_mes → both greetings');
  ok(cs.scenarioInstructions === 'Stay in character.\n\nEnd with a hook.',
    'system_prompt + post_history_instructions → scenario instructions');
  ok(cs.description === 'by someone' && cs.tags.length === 1 && cs.tags[0] === 'scifi',
    'creator_notes/tags → scenario metadata');
  ok(cs.characterIds.length === 1 && cs.characterIds[0] === cc.id, 'scenario links the new character');
  ok(cc.alternateGreetings.length === 1 && cc.alternateGreetings[0] === 'Alt one for Mia Voss.'
    && cs.alternateGreetings.length === 1 && cs.alternateGreetings[0] === 'Alt one for Mia Voss.',
    'alternate_greetings land on both entities ({{char}} bound, blanks/non-strings dropped)');
  ok(cs.lorePieces.length === 2, 'character_book entries → lore pieces');
  ok(cs.lorePieces[0].title === 'Veyra' && cs.lorePieces[0].pinned === true && cs.lorePieces[0].keys[0] === 'Veyra',
    'constant entry → pinned, comment → title');
  ok(cs.lorePieces[1].keys.length === 1 && cs.lorePieces[1].keys[0] === 'Dr\\. Vex',
    'card keys escaped to literal regex; sub-2-char key dropped');
  ok(cs.lorePieces[1].enabled === false && cs.lorePieces[1].caseSensitive === true,
    'enabled/case_sensitive carried over');
  ok(parseCharacterCard({ name: 'V1', description: 'flat card' }) !== null, 'v1 flat shape detected');
  ok(parseCharacterCard({ name: 'Only a name' }) === null, 'bare name is not a card');
  ok(parseCharacterCard({ type: 'fictionpad-scenario', data: { name: 'X' } }) === null,
    'FictionPad exports never misdetect as cards');
  ok(parseCharacterCard(null) === null && parseCharacterCard({ foo: 1 }) === null, 'non-cards → null');

  const pngWithCard = (jsonStr) => {
    const b64 = Buffer.from(jsonStr, 'utf8').toString('base64');
    const payload = Buffer.concat([Buffer.from('chara\0', 'latin1'), Buffer.from(b64, 'latin1')]);
    const chunk = Buffer.alloc(8 + payload.length + 4); // len + type + data + CRC (unverified)
    chunk.writeUInt32BE(payload.length, 0);
    chunk.write('tEXt', 4, 'latin1');
    payload.copy(chunk, 8);
    return new Uint8Array(Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk]));
  };
  const extracted = extractPngCardJson(pngWithCard(JSON.stringify(cardJson)));
  ok(extracted && JSON.parse(extracted).data.name === 'Mia Voss', 'PNG tEXt card payload extracted');
  ok(extractPngCardJson(new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) === null,
    'PNG without chunks → null');
  ok(extractPngCardJson(new Uint8Array([1, 2, 3, 4])) === null, 'non-PNG bytes → null');
}

console.log(failures === 0 ? '\nAll tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
