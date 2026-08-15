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
  normalizeBranchSwipes, childrenOf, activateBranch, pathIdSet, pieceAtPath, pieceVisibleAt,
  keyMatches, scanLore, selectLore, mergedLorePieces, resolveCharacters, addMemory, assemblePrompt,
  parseToolCalls, stripToolBlocks, stripToolBlocksMapped, applyToolCalls, TOOL_CALL_CAP, splitSpeakerSegments,
  dedupeSpeakerPrefixes, splitImageCalls, imagePromptWithPrefix, IMAGE_CALL_CAP, DEFAULT_IMAGE_PROMPT, DEFAULT_AVATAR_GEN_PROMPT,
  healImageEntry, groupImageSlots,
  resolveLimits, autoReserve, DEFAULT_CONTEXT_LENGTH, DEFAULT_MAX_TOKENS,
  subVars, queueLorePiece, acceptQueuedLore, dismissQueuedLore, expandSamplerParams,
  normalizeScenario, normalizeCharacter, normalizeChat, normalizeLorePiece,
  parseCharacterCard, extractPngCardJson, buildCharacterCard, embedPngCardJson, pngCrc32,
  hashImageId, extractImages, rehydrateImages, collectImageUrls,
  PROFILE_FIELDS, profileFromSettings, applyProfile };`;
const core = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(src));

const {
  MEMORY_CAP, LINK_BOOST, LAYER_CAPS, estimateTokens, subUser,
  activeText, getActivePath, appendMessage, applyUsedSwipes, pruneInterrupted, deleteSubtree, rewindChat, branchChat,
  normalizeBranchSwipes, childrenOf, activateBranch, pathIdSet, pieceAtPath, pieceVisibleAt,
  keyMatches, scanLore, selectLore, mergedLorePieces, resolveCharacters, addMemory, assemblePrompt,
  parseToolCalls, stripToolBlocks, stripToolBlocksMapped, applyToolCalls, TOOL_CALL_CAP, splitSpeakerSegments,
  dedupeSpeakerPrefixes, splitImageCalls, imagePromptWithPrefix, IMAGE_CALL_CAP, DEFAULT_IMAGE_PROMPT, DEFAULT_AVATAR_GEN_PROMPT,
  healImageEntry, groupImageSlots,
  resolveLimits, autoReserve,
  subVars, queueLorePiece, acceptQueuedLore, dismissQueuedLore, expandSamplerParams,
  normalizeScenario, normalizeCharacter, normalizeChat, normalizeLorePiece,
  parseCharacterCard, extractPngCardJson, buildCharacterCard, embedPngCardJson, pngCrc32,
  hashImageId, extractImages, rehydrateImages, collectImageUrls,
  PROFILE_FIELDS, profileFromSettings, applyProfile,
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
  // The fork is self-contained: only the fork node's ancestor path comes
  // over — later messages and sibling branches stay behind in the old chat.
  ok(b.messages.root && b.messages[uid1] && !b.messages[r.id] && Object.keys(b.messages).length === 2,
    'fork keeps only the root→fork path');
  ok(getActivePath(b.messages, b.activeLeafId).length === 2, 'fork path is root→fork node');
  // World state comes over intact; scope derives per assembly — entries
  // stamped past the fork point hide in the fork (their nodes don't exist
  // there), nothing is deleted.
  const c2 = { ...chat, memoryStore: { memories: [
    { id: 'mOld', text: 'old', pinned: false, createdAt: 1, atLen: 2, atMsg: uid1 }, // at the fork node
    { id: 'mNew', text: 'new', pinned: false, createdAt: 2, atLen: 3, atMsg: r.id }, // past it
  ], cursor: 3 } };
  const b3 = branchChat(c2, uid1);
  ok(b3.memoryStore.memories.length === 2, 'fork keeps all memories — derivation, not deletion');
  ok(b3.memoryStore.cursor === 2, 'fork resets the memory cursor to the fork path length');
  const forkMan = assemblePrompt({ scenario: baseScenario, persona, chat: b3, settings }).manifest;
  ok(forkMan.layers.memory.memories.some(m => m.id === 'mOld')
    && forkMan.layers.memory.inactive.some(m => m.id === 'mNew' && m.reason === 'branch'),
    'fork hides memories stamped past the fork point');
  ok(c2.memoryStore.memories.length === 2 && c2.memoryStore.cursor === 3,
    'fork leaves the source chat untouched');
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
  // provenance + swipe-scoped visibility + rewind derivation
  {
    const r = applyToolCalls(baseChat, [{ name: 'register_character', args: { name: 'Vex', description: 'd' } }],
      { nodeId: 'N1', now: 1000, createdSwipe: 1 });
    const piece = r.chat.lorePieces[0];
    ok(piece.createdBy === 'N1' && piece.createdAt === 1000 && piece.createdSwipe === 1,
      'new tool pieces tagged with node + swipe provenance');
    // update path preserves original provenance
    const r2 = applyToolCalls(r.chat, [{ name: 'register_character', args: { name: 'Vex', description: 'd2' } }],
      { nodeId: 'N2', now: 2000 });
    ok(r2.chat.lorePieces[0].createdBy === 'N1' && r2.chat.lorePieces[0].createdAt === 1000
      && r2.chat.lorePieces[0].content === 'd2', 'update keeps original provenance');
    ok(r2.chat.lorePieces[0].revisions[1].createdBy === 'N2'
      && r2.chat.lorePieces[0].revisions[1].createdSwipe == null,
      'revision stamped with its writer node; swipe omitted when not supplied');
    // swipe-scoped visibility: stamped (N1, swipe 1) hides while N1 shows another swipe
    const msgs = { root: node('root', null, 'assistant', 'hi'),
      N1: { ...node('N1', 'root', 'assistant', 'take0'), swipes: [{ text: 'take0' }, { text: 'take1' }], activeSwipe: 0 } };
    const ids = new Set(['root', 'N1']);
    ok(pieceVisibleAt(piece, ids, { ...msgs, N1: { ...msgs.N1, activeSwipe: 1 } }),
      'piece visible when its node is viewed at the stamped swipe');
    ok(!pieceVisibleAt(piece, ids, msgs), 'piece hides when its node is viewed at another swipe');
    ok(pieceVisibleAt({ ...piece, createdSwipe: undefined }, ids, msgs),
      'legacy stamp without a swipe scopes to the node alone');
    ok(!pieceVisibleAt(piece, new Set(['root']), msgs), 'piece hides when its node leaves the path');
    // rewind never deletes: tool + manual pieces survive; visibility derives per assembly
    let chat = baseChat;
    let r3 = appendMessage(chat, 'root', 'user', 'hi', null); chat = r3.chat;
    const future = { ...chat, lorePieces: [
      lore({ id: 'M', title: 'Manual' }),                       // hand-authored: no provenance
      { ...lore({ id: 'T', title: 'Tool' }), createdAt: Date.now(), createdBy: 'x' },
    ] };
    const rewound = rewindChat(future, 'root');
    ok(rewound.lorePieces.length === 2 && rewound.activeLeafId === 'root',
      'rewind keeps all lore pieces — derivation, not deletion');
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

// ---- segment start/end offsets (v4.10 positional images) ----
// Offsets index the INPUT text and delimit each segment's visible content
// (after the stripped speaker prefix), so a generated image's `pos` can be
// placed between segment bubbles. Additive: text/speaker are unchanged.
section('speaker segment offsets');
{
  const names = ['Vex', 'Mira'];
  {
    const input = 'The door opens.\nVex: hi there\n**Mira:** *nods*\nNarrator: Silence falls.';
    const s = splitSpeakerSegments(input, names);
    ok(s.length === 4 && s.every(seg => Number.isInteger(seg.start) && Number.isInteger(seg.end)),
      'every segment carries integer start/end');
    ok(s.every(seg => input.slice(seg.start, seg.end).includes(seg.text)),
      'slice(start, end) contains the segment text');
    ok(s.every((seg, i) => i === 0 || seg.start >= s[i - 1].end),
      'offsets are ordered and non-overlapping');
    ok(s[0].start === 0 && s[3].end === input.length, 'first/last segment reach the input ends');
    ok(s[1].start === input.indexOf('hi there') && s[3].start === input.indexOf('Silence falls.'),
      'speaker/Narrator segments start after their prefixes');
  }
  {
    // The image-placement case: a gap (blank line + next prefix) sits between
    // two segments' content regions — a pos in it belongs to the EARLIER one.
    const input = 'Narrator: *The door creaks open.*\n\nMira: "Come in."';
    const s = splitSpeakerSegments(input, names);
    ok(s.length === 2 && s[0].speaker === null && s[1].speaker === 'Mira',
      'Narrator + speaker split (offsets variant)');
    ok(input.slice(s[0].start, s[0].end) === '*The door creaks open.*', 'narration region is exact');
    ok(s[0].end < s[1].start && input.slice(s[0].end, s[1].start) === '\n\nMira: ',
      'the gap between segments is the newline + prefix region');
    ok(input.slice(s[1].start, s[1].end) === '"Come in."', 'speaker region starts after the prefix');
  }
  {
    // Multi-line segments: interior blank lines stay inside the region.
    const input = 'Vex: line one\n\nline three\nMira: yo';
    const s = splitSpeakerSegments(input, names);
    ok(s.length === 2 && input.slice(s[0].start, s[0].end) === 'line one\n\nline three',
      'multi-line segment region spans the blank line');
  }
  {
    // Dedupe dropped a repeat prefix: the segment's slice keeps the dropped
    // chars (offsets stay INPUT-relative), so assert the first line instead
    // of the full text — the documented approximation.
    const input = 'Vex: first\nVex: second';
    const s = splitSpeakerSegments(input, names);
    ok(s.length === 1 && s[0].text === 'first\nsecond', 'dedupe still merges repeat prefixes');
    ok(s[0].start === input.indexOf('first') && s[0].end === input.length,
      'deduped segment offsets map back to the input');
    ok(input.slice(s[0].start, s[0].end).includes(s[0].text.split('\n')[0]),
      'deduped slice contains the first content line');
  }
  {
    // Fallbacks stay well-formed.
    ok(splitSpeakerSegments('plain text', null)[0].start === 0
      && splitSpeakerSegments('plain text', null)[0].end === 'plain text'.length,
      'no-names fallback spans the input');
    const s = splitSpeakerSegments('', names);
    ok(s.length === 1 && s[0].start === 0 && s[0].end === 0, 'empty input → zero offsets');
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

// ---- rewind keeps world state (derivation, not deletion) ----
section('rewind');
{
  let chat = baseChat;
  let r = appendMessage(chat, 'root', 'user', 'first', null); chat = r.chat;
  const leafId = r.id;
  const store = addMemory(chat.memoryStore, 'recent event', Date.now(), MEMORY_CAP, 2, leafId);
  chat = { ...chat, memoryStore: store };
  const rewound = rewindChat(chat, 'root');
  ok(rewound.activeLeafId === 'root', 'rewind sets active leaf');
  ok(rewound.memoryStore.memories.length === 1, 'rewind keeps memories — derivation, not deletion');
  ok(rewound.memoryStore.cursor === 1, 'rewind resets the summary cursor to path length');
  // the memory's atMsg leaf left the active path → hidden per assembly…
  const man = assemblePrompt({ scenario: baseScenario, persona, chat: rewound, settings }).manifest;
  ok(man.layers.memory.memories.length === 0
    && man.layers.memory.inactive.some(m => m.reason === 'branch'),
    'rewound-away memory hides as Not injected · branch');
  // …and re-emerges when its branch is viewed again
  const back = assemblePrompt({ scenario: baseScenario, persona, chat, settings }).manifest;
  ok(back.layers.memory.memories.length === 1, 'memory re-emerges on its own branch');
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
  // optional steering text rides the directive (`/pov CHAR [TEXT]`)
  const steered = assemblePrompt({
    scenario: baseScenario, persona, chat: baseChat,
    settings: { contextLength: 8192, maxTokens: 400 }, platformPrompt: '',
    pov: { name: 'Veyra', pieceId: null, text: 'She finds the letter.' },
  });
  ok(steered.messages[0].content.includes("from Veyra's perspective")
    && steered.messages[0].content.includes('Direction for this reply: She finds the letter.'),
    'pov steering text appended to the directive');
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
  // String samplers (e.g. chat_template_kwargs.reasoning_effort) pass through verbatim
  ok(expandSamplerParams({ 'chat_template_kwargs.reasoning_effort': 'high' })
    .chat_template_kwargs?.reasoning_effort === 'high', 'string value nests verbatim');
  ok(expandSamplerParams({ effort: '' }).effort === '', 'empty string kept (explicitly enabled)');
  // Hostile keys: prototype-chain segments are skipped entirely
  const hostile = expandSamplerParams({ '__proto__.polluted': 1, 'a.__proto__.b': 2, 'constructor.x': 3, ok: 4 });
  ok(Object.keys(hostile).join(',') === 'ok' && ({}).polluted === undefined && Object.prototype.polluted === undefined,
    '__proto__/constructor/prototype segments rejected, no pollution');
}

// ---- rewind: non-destructive, visibility derives per assembly ----
section('rewind derivation');
{
  // root(1) → m1(2) → m2(3). Rewinding to m1 used to DELETE everything
  // stamped past it; now it only re-points the leaf and resets the cursors —
  // off-path pieces/memories hide by branch derivation instead.
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
      { id: 'memNew', text: 'new', pinned: false, createdAt: 8000, atLen: 3, atMsg: 'm2' },
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
  const rw = rewindChat(chat, 'm1');
  ok(rw.activeLeafId === 'm1' && rw.memoryStore.memories.length === 2
    && rw.lorePieces.length === 3 && rw.loreQueue.length === 2,
    'rewind keeps memories, tool lore and queue entries — derivation, not deletion');
  ok(rw.memoryStore.cursor === 2 && rw.emergentCursor === 2, 'cursors reset to path length');
  // derivation: T2 (written by m2, off the rewound path) hides as branch; T1 stays node-scoped
  const man = assemblePrompt({ scenario: baseScenario, persona, chat: rw, settings }).manifest;
  ok(man.layers.lore.inactive.find(p => p.id === 'T2')?.reason === 'branch',
    'piece written past the rewind point hides as Not injected · branch');
  ok(man.layers.lore.inactive.find(p => p.id === 'T1')?.reason === 'not-triggered',
    'piece written at the rewind point stays live on the branch');
  ok(man.layers.memory.inactive.find(m => m.id === 'memNew')?.reason === 'branch',
    'memory stamped with an off-path leaf hides as branch');
  // …and everything re-emerges when the branch is viewed again
  const back = assemblePrompt({ scenario: baseScenario, persona, chat, settings }).manifest;
  ok(back.layers.lore.inactive.find(p => p.id === 'T2')?.reason === 'not-triggered',
    'piece re-emerges on its own branch');
  ok(back.layers.memory.inactive.find(m => m.id === 'memNew') == null,
    'memory re-emerges on its own branch');
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

// ---- update_character + revision history ----
section('update_character revisions');
{
  const chat = { ...baseChat, lorePieces: [lore({ id: 'C1', title: 'Vex', type: 'character', content: 'old card', keys: ['vex'] })] };
  const r = applyToolCalls(chat, [{ name: 'update_character', args: { name: 'vex', content: 'new card' } }],
    { nodeId: 'N1', now: 1000, atLen: 5 });
  const p = r.chat.lorePieces[0];
  ok(r.results[0].ok && r.results[0].note === 'updated character "vex"',
    'update_character updates a chat-owned character (case-insensitive name)');
  ok(p.content === 'new card' && p.revisions.length === 2, 'content replaced, revision appended');
  ok(p.revisions[0].content === 'old card' && p.revisions[0].atLen === null && p.revisions[0].createdBy === null,
    'rev 0 is the null-stamped pre-tool original');
  ok(p.revisions[1].content === 'new card' && p.revisions[1].atLen === 5 && p.revisions[1].createdBy === 'N1',
    'new revision stamped with position + node');
  ok(p.keys.join() === 'vex' && p.revisions[1].keys.join() === 'vex', 'keys kept when omitted');
  const r2 = applyToolCalls(r.chat, [{ name: 'update_character', args: { name: 'Vex', content: 'card v3', keys: ['x', 'copper-eye'] } }],
    { nodeId: 'N2', now: 2000, atLen: 7 });
  const p2 = r2.chat.lorePieces[0];
  ok(p2.revisions.length === 3 && p2.content === 'card v3'
    && p2.keys.join() === 'copper-eye' && p2.revisions[2].keys.join() === 'copper-eye',
    'keys replaced (sanitized) only when provided; no re-seed on second update');
  ok(!applyToolCalls(chat, [{ name: 'update_character', args: { name: 'Ghost', content: 'x' } }]).results[0].ok,
    'unknown character rejected (register first)');
  const loreTitled = { ...baseChat, lorePieces: [lore({ id: 'L1', title: 'Vex', content: 'a place' })] };
  ok(!applyToolCalls(loreTitled, [{ name: 'update_character', args: { name: 'Vex', content: 'x' } }]).results[0].ok,
    'lore-typed title match rejected');
  ok(!applyToolCalls(chat, [{ name: 'update_character', args: { name: 'Vex', content: '' } }]).results[0].ok,
    'missing content rejected');
  const rq = applyToolCalls(chat, [{ name: 'update_character', args: { name: 'Vex', content: 'q card' } }],
    { nodeId: 'N3', now: 3000, atLen: 9, queueLore: true });
  ok(rq.results[0].ok && !(rq.chat.loreQueue ?? []).length && rq.chat.lorePieces[0].content === 'q card',
    'queue mode applies updates directly (not queued)');
}

// ---- update_character cross-origin shadow ----
section('update_character cross-origin shadow');
{
  const scenPiece = lore({ id: 'SC1', title: 'Vex', type: 'character', content: 'scenario card', keys: ['vex'] });
  const chat = { ...baseChat, lorePieces: [] };
  const r = applyToolCalls(chat, [{ name: 'update_character', args: { name: 'Vex', content: 'evolved card' } }],
    { nodeId: 'N1', now: 1000, atLen: 5 }, [scenPiece]);
  const shadow = r.chat.lorePieces[0];
  ok(r.results[0].ok && shadow.id === 'SC1' && shadow.content === 'evolved card',
    'scenario character shadowed into the overlay with new content');
  ok(scenPiece.content === 'scenario card' && scenPiece.revisions === undefined,
    'scenario original untouched');
  ok(shadow.revisions.length === 2 && shadow.revisions[0].content === 'scenario card'
    && shadow.revisions[0].atLen === null && shadow.revisions[0].createdAt === null,
    'shadow rev 0 = unprovenanced original');
  ok(Number.isFinite(shadow.createdAt) && shadow.createdBy === 'N1',
    'shadow carries fresh provenance so rewind drops it');
  const merged = mergedLorePieces({ ...baseScenario, lorePieces: [scenPiece] }, r.chat);
  ok(merged.filter(p => p.type === 'character' && p.title.trim().toLowerCase() === 'vex').length === 1,
    'merged view keeps a single piece for the name');
}

// ---- universal rollback: EVERY tool update path is revisioned ----
section('universal rollback of tool updates');
{
  // register_character re-registration (dedupe update) is revisioned
  const chat = { ...baseChat, lorePieces: [lore({ id: 'C1', title: 'Vex', type: 'character', content: 'v1', keys: ['vex'] })] };
  const reg = applyToolCalls(chat, [{ name: 'register_character', args: { name: 'Vex', description: 'v2' } }],
    { nodeId: 'N1', now: 100, atLen: 2 });
  ok(reg.chat.lorePieces[0].revisions?.length === 2 && reg.chat.lorePieces[0].revisions[0].content === 'v1',
    'register_character re-registration appends a revision');
  // scenario shadow via register seeds rev 0 from the unprovenanced original
  const scenPiece = lore({ id: 'S1', title: 'Vex', type: 'character', content: 'scen v1' });
  const sh = applyToolCalls({ ...baseChat, lorePieces: [] },
    [{ name: 'register_character', args: { name: 'Vex', description: 'v2' } }],
    { nodeId: 'N1', now: 100, atLen: 2 }, [scenPiece]);
  ok(sh.chat.lorePieces[0].revisions?.[0]?.content === 'scen v1'
    && sh.chat.lorePieces[0].revisions[0].atLen === null,
    'register shadow seeds rev 0 from the unprovenanced original');
  // add_lore title update (also the extraction-pass auto-mode path) is revisioned
  const loreChat = { ...baseChat, lorePieces: [lore({ id: 'L1', title: 'Gate', content: 'old text', keys: ['gate'] })] };
  const upd = applyToolCalls(loreChat, [{ name: 'add_lore', args: { title: 'gate', content: 'new text' } }],
    { nodeId: 'N1', now: 100, atLen: 2 });
  const lp = upd.chat.lorePieces[0];
  ok(lp.revisions?.length === 2 && lp.content === 'new text' && lp.revisions[0].content === 'old text',
    'add_lore title-update appends a revision (covers extraction auto mode)');
  ok(lp.keys.join() === 'gate' && lp.revisions[1].keys.join() === 'gate',
    'add_lore update without keys keeps current keys');
  // end-to-end: an applied update reverts to the pre-update card on rewind —
  // the piece is never mutated; the assembler's revision view falls back
  let c2 = baseChat;
  const a1 = appendMessage(c2, 'root', 'user', 'one', null); c2 = a1.chat;      // pathLen 2
  const a2 = appendMessage(c2, a1.id, 'user', 'two', null); c2 = a2.chat;        // pathLen 3
  c2 = { ...c2, lorePieces: [lore({ id: 'C1', title: 'Vex', type: 'character', content: 'v1' })] };
  c2 = applyToolCalls(c2, [{ name: 'update_character', args: { name: 'Vex', content: 'v2' } }],
    { nodeId: 'x', now: Date.now(), atLen: 3 }).chat;
  const rwAsm = assemblePrompt({ scenario: baseScenario, persona, chat: rewindChat(c2, a1.id), settings }).manifest;
  ok(c2.lorePieces[0].content === 'v2'
    && rwAsm.layers.lore.inactive.find(p => p.id === 'C1')?.content === 'v1',
    'applied update reverts to the pre-update card on rewind (derived view, log intact)');
}

// ---- revision views derive per branch (rewind never trims the log) ----
section('revision derivation');
{
  let chat = baseChat;
  const m1 = appendMessage(chat, 'root', 'user', 'one', null); chat = m1.chat;   // pathLen 2
  const m2 = appendMessage(chat, m1.id, 'user', 'two', null); chat = m2.chat;    // pathLen 3
  const piece = { ...lore({ id: 'C1', title: 'Vex', type: 'character', content: 'v3', keys: ['k3'] }),
    revisions: [
      { content: 'v1', keys: ['k1'], atLen: null, createdAt: null, createdBy: null },
      { content: 'v2', keys: ['k2'], atLen: 2, createdAt: 100, createdBy: m1.id },
      { content: 'v3', keys: ['k3'], atLen: 3, createdAt: 200, createdBy: m2.id },
    ] };
  const withPiece = { ...chat, lorePieces: [piece] };
  const viewAt = (leaf) => {
    const ids = pathIdSet(withPiece.messages, leaf);
    return pieceAtPath(withPiece.lorePieces[0], ids, withPiece.messages);
  };
  ok(viewAt(m2.id).content === 'v3', 'tip view sees the latest revision');
  ok(viewAt(m1.id).content === 'v2' && viewAt(m1.id).keys.join() === 'k2',
    'mid-chain view falls back to the last on-view revision');
  ok(viewAt('root').content === 'v1' && viewAt('root').keys.join() === 'k1',
    'root view restores the null-stamped original');
  const rw = rewindChat(withPiece, m1.id);
  ok(rw.lorePieces[0].revisions.length === 3 && rw.lorePieces[0].content === 'v3',
    'rewind keeps the full revision log and content — views derive per assembly');
}

// ---- swipe-scoped world state in the assembler ----
section('swipe-scoped lore derivation');
{
  // Node A has two takes; the tool write belongs to take 1. Viewing take 0
  // hides it (a replaced swipe is its own branch), take 1 restores it.
  const A = { id: 'A', parentId: 'root', role: 'assistant', activeSwipe: 0, edited: false,
    swipes: [{ text: 'first take', createdAt: 1, modelId: null }, { text: 'second take', createdAt: 2, modelId: null }] };
  const chat = { ...baseChat,
    messages: { root: node('root', null, 'assistant', 'hi', 1), A },
    activeLeafId: 'A',
    lorePieces: [{ ...lore({ id: 'T', title: 'TakeLore', pinned: true }), createdAt: 2, createdBy: 'A', createdSwipe: 1 }],
  };
  const at = (swipe) => assemblePrompt({ scenario: baseScenario, persona,
    chat: { ...chat, messages: { ...chat.messages, A: { ...A, activeSwipe: swipe } } }, settings }).manifest;
  ok(at(1).layers.lore.pieces.some(p => p.id === 'T' && p.origin === 'chat'),
    'piece injects with chat origin when its take is viewed');
  const man0 = at(0);
  ok(!man0.layers.lore.pieces.some(p => p.id === 'T')
    && man0.layers.lore.inactive.some(p => p.id === 'T' && p.reason === 'branch'),
    'piece hides as Not injected · branch when another take is viewed — never deleted');
  ok(chat.lorePieces.length === 1, 'state untouched by derivation');
}

// ---- revisions import healing ----
section('revisions import healing');
{
  const healed = normalizeLorePiece({ title: 'T',
    revisions: [{ content: 42, keys: 'x', atLen: '2', createdAt: 5, createdBy: 7 }, 'junk'] });
  ok(healed.revisions.length === 2 && healed.revisions[0].content === '42'
    && healed.revisions[0].atLen === null && healed.revisions[0].createdAt === 5
    && healed.revisions[0].createdBy === '7' && healed.revisions[0].keys.join() === ''
    && healed.revisions[1].content === '' && healed.revisions[1].createdBy === null,
    'malformed revisions healed to shape');
  ok(normalizeLorePiece({ title: 'T' }).revisions === undefined,
    'absent revisions stay absent');
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

// ---- timed lore activation (sticky / cooldown / delay / probability) ----
section('timed lore activation');
{
  // Path fixture: key "dragon" hits message 0 and message 5 (chars:1 →
  // per-piece searchDepth IS the window size in chars).
  const msgs4 = ['dragon one', 'calm aa', 'calm bb', 'calm cc', 'calm dd', 'dragon two'];
  const conv4 = msgs4.join('\n');
  // Plain pieces ignore the messages option entirely (unchanged behavior).
  const plain = scanLore([lore({ id: 'T', keys: ['dragon'], searchDepth: 12 })], conv4, null, { messages: msgs4, chars: 1 });
  ok(plain.has('T') && plain.get('T').reason === 'triggered', 'untimed piece scans the window as before');

  // sticky: key left the window, piece held alive
  const holdMsgs = ['dragon one', 'calm aa', 'calm bb', 'calm cc'];
  const hold = scanLore([lore({ id: 'T', keys: ['dragon'], sticky: 3, searchDepth: 12 })], holdMsgs.join('\n'), null, { messages: holdMsgs, chars: 1 });
  ok(hold.has('T') && hold.get('T').reason === 'sticky', 'sticky holds the piece after the key leaves the window');
  const noHold = scanLore([lore({ id: 'T', keys: ['dragon'], sticky: 1, searchDepth: 12 })], holdMsgs.join('\n'), null, { messages: holdMsgs, chars: 1 });
  ok(!noHold.has('T'), 'sticky lapsed → piece inactive');

  // cooldown: lapsed, then a fresh match inside the cooldown is blocked
  const cd = scanLore([lore({ id: 'T', keys: ['dragon'], sticky: 1, cooldown: 3, searchDepth: 12 })], conv4, null, { messages: msgs4, chars: 1 });
  ok(!cd.has('T') && cd.detail.get('T') === 'cooldown', 're-match inside cooldown blocked + reported');
  const cdOk = scanLore([lore({ id: 'T', keys: ['dragon'], sticky: 1, cooldown: 2, searchDepth: 12 })], conv4, null, { messages: msgs4, chars: 1 });
  ok(cdOk.has('T') && cdOk.get('T').reason === 'triggered', 're-match after cooldown re-activates');

  // delay: can't activate before the position
  const dl = scanLore([lore({ id: 'T', keys: ['dragon'], delay: 7 })], conv4, null, { messages: msgs4, chars: 1 });
  ok(!dl.has('T') && dl.detail.get('T') === 'delayed', 'before the delay position → blocked + reported');
  const dlOk = scanLore([lore({ id: 'T', keys: ['dragon'], delay: 4 })], conv4, null, { messages: msgs4, chars: 1 });
  ok(dlOk.has('T'), 'delay reached → activates');

  // probability: injected rng decides
  const p0 = scanLore([lore({ id: 'T', keys: ['dragon'], prob: 50 })], conv4, null, { rng: () => 0.99 });
  ok(!p0.has('T') && p0.detail.get('T') === 'probability', 'probability roll-out suppresses + reports');
  const p1 = scanLore([lore({ id: 'T', keys: ['dragon'], prob: 50 })], conv4, null, { rng: () => 0.01 });
  ok(p1.has('T'), 'probability roll-in activates');
  const p100 = scanLore([lore({ id: 'T', keys: ['dragon'], prob: 0 })], conv4, null, {});
  ok(!p100.has('T'), 'prob 0 never fires');

  // pinned + semantic activations bypass probability and timed fields
  const pinnedProb = scanLore([lore({ id: 'T', keys: ['dragon'], pinned: true, prob: 0 })], conv4, null, {});
  ok(pinnedProb.has('T'), 'pinned bypasses probability');
  const semTimed = scanLore([lore({ id: 'T', keys: ['dragon'], sticky: 5, prob: 0 })], 'no key here', new Set(['T']), { messages: ['no key here'] });
  ok(semTimed.has('T') && semTimed.get('T').reason === 'semantic', 'semantic activation bypasses timed fields + probability');

  // text-only scan (no messages): timed fields no-op, plain window scan
  const textOnly = scanLore([lore({ id: 'T', keys: ['dragon'], sticky: 9, cooldown: 9, delay: 99 })], conv4);
  ok(textOnly.has('T') && textOnly.get('T').reason === 'triggered', 'timed fields ignored without a message path');
}

// ---- inclusion groups ----
section('inclusion groups');
{
  const conv = 'dragon here';
  const both = scanLore([
    lore({ id: 'low', keys: ['dragon'], group: 'event', weight: 1 }),
    lore({ id: 'high', keys: ['dragon'], group: 'event', weight: 9 }),
    lore({ id: 'free', keys: ['dragon'] }),
  ], conv);
  ok(both.has('high') && !both.has('low') && both.detail.get('low') === 'group',
    'group: highest weight wins, loser reported');
  ok(both.has('free'), 'ungrouped piece unaffected');
  const tie = scanLore([
    lore({ id: 'first', keys: ['dragon'], group: 'event', weight: 5 }),
    lore({ id: 'second', keys: ['dragon'], group: 'event', weight: 5 }),
  ], conv);
  ok(tie.has('first') && !tie.has('second'), 'group tie keeps list order');
  const pin = scanLore([
    lore({ id: 'P', keys: ['dragon'], group: 'event', pinned: true, weight: 0 }),
    lore({ id: 'T', keys: ['dragon'], group: 'event', weight: 9 }),
  ], conv);
  ok(pin.has('P') && pin.has('T'), 'pinned member bypasses its group');
  // a suppressed group loser lends no link boost
  const noBoost = scanLore([
    lore({ id: 'low', keys: ['dragon'], group: 'event', weight: 1, links: ['B'] }),
    lore({ id: 'high', keys: ['dragon'], group: 'event', weight: 9 }),
    lore({ id: 'B', keys: [] }),
  ], conv);
  ok(!noBoost.has('B'), 'group loser lends no link boost');
}

// ---- smart memory recall ----
section('smart memory recall');
{
  const memChat = { ...baseChat, memoryStore: { memories: [
    { id: 'm1', text: 'OLD relevant fact', pinned: false, createdAt: 1 },
    { id: 'm2', text: 'OLD irrelevant fact', pinned: false, createdAt: 2 },
    { id: 'm3', text: 'recent three', pinned: false, createdAt: 3 },
    { id: 'm4', text: 'recent four', pinned: false, createdAt: 4 },
    { id: 'm5', text: 'recent five', pinned: false, createdAt: 5 },
  ], cursor: 0 } };
  const scores = new Map([['m1', 0.99], ['m2', 0.30], ['m3', 0.10], ['m4', 0.20], ['m5', 0.05]]);
  const { manifest } = assemblePrompt({
    scenario: baseScenario, persona, chat: memChat,
    settings: { contextLength: 8192, maxTokens: 400 }, platformPrompt: '', memScores: scores });
  const mem = manifest.layers.memory;
  ok(mem.recall === 'smart', 'smart recall flagged on the layer');
  const byId = new Map(mem.memories.map(m => [m.id, m]));
  ok(byId.get('m1')?.reason === 'semantic' && byId.get('m1')?.score === 0.99,
    'old high-similarity memory recalled with its score');
  ok(['m3', 'm4', 'm5'].every(id => byId.get(id)?.reason === 'recent'),
    'newest unpinned memories kept on the recency floor');
  const inact = new Map((mem.inactive ?? []).map(m => [m.id, m]));
  ok(!byId.has('m2') && inact.get('m2')?.reason === 'below-threshold' && inact.get('m2')?.score === 0.30,
    'below-threshold memory excluded + reported with its score');

  // pinned memories inject regardless of scores
  const pinChat = { ...memChat, memoryStore: { memories: [
    ...memChat.memoryStore.memories,
    { id: 'mP', text: 'PINNED fact', pinned: true, createdAt: 0 },
  ], cursor: 0 } };
  const pinMan = assemblePrompt({
    scenario: baseScenario, persona, chat: pinChat,
    settings: { contextLength: 8192, maxTokens: 400 }, platformPrompt: '', memScores: scores }).manifest;
  ok(pinMan.layers.memory.memories.some(m => m.id === 'mP' && m.pinned && m.reason === 'pinned'),
    'pinned memory injects in smart mode without a score');

  // no scores → classic recency fill (m2 survives), no inactive list pressure
  const classic = assemblePrompt({
    scenario: baseScenario, persona, chat: memChat,
    settings: { contextLength: 8192, maxTokens: 400 }, platformPrompt: '' }).manifest;
  ok(classic.layers.memory.recall === 'recent' && classic.layers.memory.memories.some(m => m.id === 'm2'),
    'without scores the fill stays pinned-then-recent');
}

// ---- context horizon (history keptIds) ----
section('context horizon keptIds');
{
  let chat = baseChat;
  for (let i = 0; i < 40; i++) {
    const r = appendMessage(chat, chat.activeLeafId, i % 2 ? 'assistant' : 'user', `message ${i} ` + 'x'.repeat(150), i);
    chat = r.chat;
  }
  const { manifest } = assemblePrompt({
    scenario: baseScenario, persona, chat,
    settings: { contextLength: 2000, maxTokens: 400 }, platformPrompt: '' });
  const h = manifest.layers.history;
  ok(h.dropped > 0, 'history trimmed under budget pressure (horizon fixture)');
  ok(Array.isArray(h.keptIds) && h.keptIds.length === h.kept, 'keptIds length matches kept count');
  ok(h.keptIds.every(id => typeof id === 'string' && chat.messages[id]), 'keptIds are live node ids');
  ok(h.keptIds[0] !== h.keptIds[h.keptIds.length - 1] && h.keptIds[h.keptIds.length - 1] === chat.activeLeafId,
    'keptIds run oldest→newest down to the leaf');
}

// ---- timed/group normalization healing ----
section('timed field import healing');
{
  const healed = normalizeLorePiece({ title: 'X', sticky: '3', cooldown: 0, delay: 2.7, prob: 250, group: '  event  ' });
  ok(healed.sticky === 3 && healed.delay === 3 && healed.cooldown === undefined,
    'timed fields coerced to positive ints (0/off → absent)');
  ok(healed.prob === 100 && healed.group === 'event', 'prob clamped to 0–100, group trimmed');
  const blank = normalizeLorePiece({ title: 'Y' });
  ok(blank.sticky === undefined && blank.prob === undefined && blank.group === undefined,
    'absent timed fields stay absent');
}

// ---- in-chat branching: fromSwipe, activateBranch, branch-visible world state ----
section('in-chat branching');
{
  // appendMessage stamps the child with the parent's active swipe
  {
    let chat = { ...baseChat, messages: { ...baseChat.messages,
      root: { ...baseChat.messages.root,
        swipes: [...baseChat.messages.root.swipes, { text: 'alt greeting', createdAt: 2, modelId: null }],
        activeSwipe: 1 } } };
    const r = appendMessage(chat, 'root', 'user', 'hi');
    ok(r.chat.messages[r.id].fromSwipe === 1, 'appendMessage stamps fromSwipe = parent activeSwipe');
    ok(r.chat.messages.root.usedSwipe === 1, 'usedSwipe still recorded alongside fromSwipe');
    ok(!('fromSwipe' in r.chat.messages.root), 'root carries no fromSwipe');
  }
  // normalizeBranchSwipes: legacy children heal from parent.usedSwipe
  {
    const legacy = {
      ...baseChat,
      messages: {
        root: { ...node('root', null, 'assistant', 'g0', 1),
          swipes: [{ text: 'g0', createdAt: 1, modelId: null }, { text: 'g1', createdAt: 2, modelId: null }],
          activeSwipe: 0, usedSwipe: 1 },
        u1: node('u1', 'root', 'user', 'hi', 3),            // no fromSwipe → heals to 1
        u2: { ...node('u2', 'root', 'user', 'yo', 4), fromSwipe: 0 }, // already stamped
      },
      activeLeafId: 'u1',
    };
    const healed = normalizeBranchSwipes(legacy);
    ok(healed.messages.u1.fromSwipe === 1, 'legacy child stamped from parent usedSwipe');
    ok(healed.messages.u2.fromSwipe === 0, 'stamped child untouched');
    ok(normalizeBranchSwipes(healed) === healed, 'normalize is a no-op (same object) when clean');
    const clamped = normalizeBranchSwipes({ ...legacy, messages: { ...legacy.messages,
      root: { ...legacy.messages.root, usedSwipe: 99 } } });
    ok(clamped.messages.u1.fromSwipe === 1, 'out-of-range usedSwipe clamps to swipe count');
    ok(normalizeChat(legacy).messages.u1.fromSwipe === 1, 'normalizeChat heals imports too');
  }
  // branch tree fixture: root(2 swipes) → swipe0: u1 → a1 · swipe1: u2 → a2
  const bNode = (id, parentId, role, text, createdAt, fromSwipe, extra = {}) => ({
    id, parentId, role, activeSwipe: 0, edited: false,
    swipes: [{ text, createdAt, modelId: null }], ...(fromSwipe != null ? { fromSwipe } : {}), ...extra,
  });
  const branchChatFx = () => ({
    ...baseChat,
    messages: {
      root: { ...bNode('root', null, 'assistant', 'g0', 1),
        swipes: [{ text: 'g0', createdAt: 1, modelId: null }, { text: 'g1', createdAt: 2, modelId: null }],
        usedSwipe: 1 },
      u1: bNode('u1', 'root', 'user', 'branch A user', 3, 0),
      a1: bNode('a1', 'u1', 'assistant', 'branch A reply', 4, 0),
      u2: bNode('u2', 'root', 'user', 'branch B user', 5, 1),
      a2: bNode('a2', 'u2', 'assistant', 'branch B reply', 6, 0),
    },
    activeLeafId: 'a1',
  });
  // swipe switch propagates: changing root's swipe swaps the whole branch below
  {
    const chat = branchChatFx();
    const swiped = { ...chat, messages: { ...chat.messages, root: { ...chat.messages.root, activeSwipe: 1 } } };
    const next = activateBranch(swiped, 'root', { keepPath: true });
    ok(next.activeLeafId === 'a2', 'swiping to swipe 1 follows that swipe\'s branch to its tip');
    ok(getActivePath(next.messages, next.activeLeafId).map(n => n.id).join(',') === 'root,u2,a2',
      'new path runs through the matching children');
    // swipe back: branch A re-emerges
    const back = activateBranch({ ...next, messages: { ...next.messages, root: { ...next.messages.root, activeSwipe: 0 } } }, 'root', { keepPath: true });
    ok(back.activeLeafId === 'a1', 'swiping back restores branch A');
    // nothing deleted while browsing
    ok(Object.keys(next.messages).length === 5, 'hidden branch nodes stay in the tree');
  }
  // no continuation under the new swipe → the path truncates to the swiped node
  {
    const chat = branchChatFx();
    const u1swiped = { ...chat, messages: { ...chat.messages, u1: { ...chat.messages.u1,
      swipes: [...chat.messages.u1.swipes, { text: 'branch A user (take 2)', createdAt: 7, modelId: null }],
      activeSwipe: 1 } } };
    const next = activateBranch(u1swiped, 'u1', { keepPath: true });
    ok(next.activeLeafId === 'u1', 'no child continues the new swipe → leaf truncates to the node');
    ok(next.messages.a1, 'the old continuation is kept, not deleted');
    const back = activateBranch({ ...next, messages: { ...next.messages, u1: { ...next.messages.u1, activeSwipe: 0 } } }, 'u1', { keepPath: true });
    ok(back.activeLeafId === 'a1', 'swiping back re-descends into the kept continuation');
  }
  // explicit swipe vs jump into a node whose viewed swipe has no continuation
  {
    const chat = branchChatFx();
    // u1 gains a second swipe; usedSwipe records the conversation continued from swipe 0
    const u1swiped = { ...chat, messages: { ...chat.messages, u1: { ...chat.messages.u1,
      swipes: [...chat.messages.u1.swipes, { text: 'branch A user (take 2)', createdAt: 7, modelId: null }],
      activeSwipe: 1, usedSwipe: 0 } } };
    const next = activateBranch(u1swiped, 'u1', { keepPath: true, snapStart: false });
    ok(next.messages.u1.activeSwipe === 1, 'explicit swipe to an uncontinued swipe is not snapped back');
    ok(next.activeLeafId === 'u1', 'and the path truncates to the swiped node');
    const jumped = activateBranch(u1swiped, 'u1');
    ok(jumped.messages.u1.activeSwipe === 0 && jumped.activeLeafId === 'a1',
      'a tree jump into the same node still snaps to the continued swipe');
  }
  // jump: aligns ancestor swipes to the branch being entered
  {
    const chat = branchChatFx(); // root.activeSwipe 0, leaf a1
    const jumped = activateBranch(chat, 'u2');
    ok(jumped.messages.root.activeSwipe === 1, 'jump aligns the parent to the branch\'s fromSwipe');
    ok(jumped.activeLeafId === 'a2', 'jump descends to the branch tip');
    const ident = activateBranch(jumped, 'a2');
    ok(ident === jumped, 'activateBranch on the aligned leaf is a no-op (same object)');
  }
  // keepPath prefers the current child when it still matches
  {
    const chat = branchChatFx();
    // second child under root swipe 1, older than u2 — the current path runs through it
    chat.messages.u0 = bNode('u0', 'root', 'user', 'older B user', 0, 1);
    chat.messages.a0 = bNode('a0', 'u0', 'assistant', 'older B reply', 1, 0);
    chat.activeLeafId = 'a0';
    chat.messages.root = { ...chat.messages.root, activeSwipe: 1 };
    const kept = activateBranch(chat, 'root', { keepPath: true });
    ok(kept.activeLeafId === 'a0', 'keepPath keeps the current child over a newer sibling');
    const newest = activateBranch(chat, 'root');
    ok(newest.activeLeafId === 'a2', 'without keepPath the newest matching child wins');
  }
  // usedSwipe snap: a node whose viewed swipe has no continuation follows the recorded one
  {
    const chat = branchChatFx();
    chat.messages.u1 = { ...chat.messages.u1, activeSwipe: 0, usedSwipe: 0,
      swipes: [...chat.messages.u1.swipes, { text: 'draft', createdAt: 7, modelId: null }] };
    chat.messages.u1.activeSwipe = 1; // browsing an un-continued swipe
    chat.activeLeafId = 'u1';
    const jumped = activateBranch(chat, 'u1');
    ok(jumped.messages.u1.activeSwipe === 0, 'no continuation under viewed swipe → snaps to usedSwipe');
    ok(jumped.activeLeafId === 'a1', 'and follows the recorded continuation down');
  }
  // descend:false aligns the path without moving the leaf (chat open)
  {
    const chat = branchChatFx();
    chat.activeLeafId = 'root';
    const opened = activateBranch(chat, 'root', { descend: false });
    ok(opened.activeLeafId === 'root', 'descend:false keeps the persisted (rewound) leaf');
  }
  // pruneInterrupted re-stamps fromSwipe when re-parenting
  {
    let chat = { ...baseChat, messages: { ...baseChat.messages,
      root: { ...baseChat.messages.root,
        swipes: [...baseChat.messages.root.swipes, { text: 'alt greeting', createdAt: 2, modelId: null }],
        activeSwipe: 1 } } };
    chat = appendMessage(chat, 'root', 'assistant', '').chat; // placeholder (all-empty) under swipe 1
    const a1 = chat.activeLeafId;
    chat = appendMessage(chat, a1, 'user', 'hello?').chat;   // child of the placeholder
    const u2 = chat.activeLeafId;
    const pruned = pruneInterrupted(chat);
    ok(pruned.messages[u2].parentId === 'root', 'child re-parented past the dropped placeholder');
    ok(pruned.messages[u2].fromSwipe === 1, 'fromSwipe re-stamped against the new parent');
  }
}
section('branch-visible world state');
{
  // branch fixture: path A root→u1→a1 vs path B root→u2 (activeLeaf u2)
  const bChat = () => ({
    ...baseChat,
    messages: {
      root: node('root', null, 'assistant', 'Welcome to Veyra, {{user}}.', 1),
      u1: { ...node('u1', 'root', 'user', 'hi', 2), fromSwipe: 0 },
      a1: { ...node('a1', 'u1', 'assistant', 'hello there', 3), fromSwipe: 0 },
      u2: { ...node('u2', 'root', 'user', 'different hi', 4), fromSwipe: 0 },
    },
    activeLeafId: 'u2',
  });
  const scen = { ...baseScenario, lorePieces: [
    lore({ id: 'SP', title: 'Shared', content: 'scenario version', keys: ['Veyra'] }),
  ] };
  const chat = bChat();
  chat.lorePieces = [
    // shadows the scenario piece, but was written on branch A (createdBy a1)
    { ...lore({}), id: 'SP', title: 'Shared', content: 'chat shadow version', keys: ['Veyra'],
      createdBy: 'a1', createdAt: 5, atLen: 3 },
    // branch-A-only pinned piece
    lore({ id: 'CL', title: 'BranchA', content: 'branch A secret', keys: [], pinned: true,
      createdBy: 'a1', createdAt: 5, atLen: 3 }),
    // written on branch B, then updated by a tool on branch A (revision log)
    lore({ id: 'CL2', title: 'Mia', content: 'v2 rewritten on branch A', keys: ['Mia'], pinned: true,
      createdBy: 'u2', createdAt: 4, atLen: 2,
      revisions: [
        { content: 'original Mia', keys: ['Mia'], atLen: null, createdAt: null, createdBy: null },
        { content: 'v2 rewritten on branch A', keys: ['Mia'], atLen: 3, createdAt: 5, createdBy: 'a1' },
      ] }),
  ];
  chat.memoryStore = { memories: [
    { id: 'mA', text: 'branch A memory', pinned: false, createdAt: 5, atLen: 3, atMsg: 'a1' },
    { id: 'mB', text: 'global memory', pinned: false, createdAt: 6, atLen: 2 },
    { id: 'mC', text: 'branch B memory', pinned: false, createdAt: 7, atLen: 2, atMsg: 'u2' },
  ], cursor: 0 };
  {
    const r = assemblePrompt({ scenario: scen, persona, chat, settings });
    const L = r.manifest.layers.lore;
    const mem = r.manifest.layers.memory;
    const sp = L.pieces.find(p => p.id === 'SP');
    ok(sp && sp.content === 'scenario version', 'branch-hidden shadow stops shadowing — scenario piece resurfaces');
    ok(sp && sp.origin === 'scenario', 'resurfaced piece reports scenario origin');
    ok(!L.pieces.some(p => p.id === 'CL'), 'branch-A piece not injected on branch B');
    const cl2 = L.pieces.find(p => p.id === 'CL2');
    ok(cl2 && cl2.content === 'original Mia', 'revision view falls back to the last on-path revision');
    ok(L.inactive.filter(p => p.reason === 'branch').map(p => p.id).sort().join(',') === 'CL,SP',
      'hidden pieces appear as Not injected · branch');
    const memIds = mem.memories.map(m => m.id).sort().join(',');
    ok(memIds === 'mB,mC', 'only global + this-branch memories inject');
    ok(mem.inactive.some(m => m.id === 'mA' && m.reason === 'branch'), 'branch memory listed as Not injected · branch');
  }
  {
    // same chat viewed from branch A (leaf a1): everything flips back
    const r = assemblePrompt({ scenario: scen, persona, chat: { ...chat, activeLeafId: 'a1' }, settings });
    const L = r.manifest.layers.lore;
    const mem = r.manifest.layers.memory;
    ok(L.pieces.find(p => p.id === 'SP')?.content === 'chat shadow version', 'branch A sees the shadow again');
    ok(L.pieces.some(p => p.id === 'CL'), 'branch A piece injected on branch A');
    ok(L.pieces.find(p => p.id === 'CL2')?.content === 'v2 rewritten on branch A', 'branch A sees its own revision');
    ok(mem.memories.some(m => m.id === 'mA') && !mem.memories.some(m => m.id === 'mC'),
      'memory visibility flips with the branch');
  }
  // pieceAtPath unit behavior
  {
    const bare = lore({ id: 'Y' });
    ok(pieceAtPath(bare, new Set(['x'])) === bare, 'no revision log → identity');
    const p = lore({ id: 'X', content: 'latest', revisions: [
      { content: 'orig', keys: [], createdBy: null },
      { content: 'latest', keys: [], createdBy: 'somewhere' },
    ] });
    ok(pieceAtPath(p, new Set(['somewhere'])) === p, 'latest revision visible → identity');
    const hidden = pieceAtPath(p, new Set(['elsewhere']));
    ok(hidden !== p && hidden.content === 'orig', 'latest revision off-path → last visible revision content');
    ok(hidden.revisions.length === 2, 'revision log itself is never trimmed by the view');
  }
}

// ---- image takes: slot grouping + active-take resolution (v4.10) ----
section('groupImageSlots');
{
  // Slotless (legacy) entries → singleton slots, in array order.
  const leg = [{ src: 'a' }, { src: 'b' }];
  const gl = groupImageSlots(leg, null);
  ok(gl.length === 2 && gl[0].slot === '_0' && gl[1].slot === '_1'
    && gl[0].takes.length === 1 && gl[0].active === leg[0] && gl[0].activeIdx === 0,
    'slotless entries group into singleton slots in order');
  // Multi-take slots group by first occurrence; interleaving keeps takes together.
  const multi = [
    { src: 's1t0', slot: 's1' }, { src: 's2t0', slot: 's2' }, { src: 's1t1', slot: 's1' },
  ];
  const gm = groupImageSlots(multi, null);
  ok(gm.length === 2 && gm[0].slot === 's1' && gm[1].slot === 's2'
    && gm[0].takes.length === 2 && gm[0].takes[0] === multi[0] && gm[0].takes[1] === multi[2],
    'takes group by slot in first-occurrence order');
  ok(gm[0].active === multi[2] && gm[0].activeIdx === 1 && gm[1].activeIdx === 0,
    'active take defaults to the LAST take');
  const gw = groupImageSlots(multi, { s1: 0 });
  ok(gw[0].active === multi[0] && gw[0].activeIdx === 0, 'imgUsed override picks the shown take');
  const gc = groupImageSlots(multi, { s1: 99 });
  ok(gc[0].activeIdx === 1 && gc[0].active === multi[2], 'out-of-range imgUsed clamps high');
  const gc2 = groupImageSlots(multi, { s1: -5 });
  ok(gc2[0].activeIdx === 0 && gc2[0].active === multi[0], 'out-of-range imgUsed clamps low');
  const garbage = groupImageSlots(multi, { s1: 'soon' });
  ok(garbage[0].activeIdx === 1, 'non-numeric imgUsed falls back to the last take');
  ok(multi.length === 3 && multi[0].slot === 's1' && !('activeIdx' in (multi[0] ?? {})),
    'input array and entries are not mutated');
  ok(groupImageSlots(null, null).length === 0 && groupImageSlots(undefined, {}).length === 0,
    'missing images array groups to nothing');
}

// ---- swipe image attachments: prune keep + pending heal (v4.10) ----
section('pruneInterrupted images');
{
  let chat = baseChat;
  chat = appendMessage(chat, 'root', 'user', 'hi').chat;
  const u1 = chat.activeLeafId;
  chat = appendMessage(chat, u1, 'assistant', '').chat; // empty text — would be pruned…
  const a1 = chat.activeLeafId;
  const a1node = chat.messages[a1];
  // …but the swipe carries a generated image (image-only message)
  const imgSwipe = { text: '', createdAt: 3, modelId: null,
    images: [{ src: 'data:image/webp;base64,xx', prompt: 'a dragon', caption: 'A dragon', at: 3 }] };
  chat = { ...chat, messages: { ...chat.messages, [a1]: { ...a1node, swipes: [imgSwipe] } } };
  const pruned = pruneInterrupted(chat);
  ok(pruned.messages[a1] && pruned.messages[a1].swipes.length === 1,
    'empty-text swipe with images survives the prune');
  ok(pruned.messages[a1].swipes[0] === imgSwipe, 'clean image swipe kept by reference');
  ok(pruneInterrupted(pruned) === pruned, 'settled image chat passes through by reference');

  // pending image entries heal to error (pending dropped) on a kept swipe
  const pendSwipe = { text: 'Here it is.', createdAt: 4, modelId: null,
    images: [{ prompt: 'a dragon', caption: 'A dragon', at: 4, pending: true }, { src: 'data:x', at: 4 }] };
  const chat2 = { ...chat, messages: { ...chat.messages, [a1]: { ...a1node, swipes: [pendSwipe] } } };
  const healed = pruneInterrupted(chat2);
  const he = healed.messages[a1].swipes[0].images;
  ok(healed !== chat2 && he.length === 2, 'pending heal clones the chat');
  ok(he[0].error === true && !('pending' in he[0]) && he[0].prompt === 'a dragon' && he[0].caption === 'A dragon' && he[0].at === 4,
    'pending entry heals to error, pending dropped, other fields kept');
  ok(he[1].src === 'data:x' && he[1].error === undefined, 'non-pending entry untouched');

  // healing also applies to the root greeting swipe (root is never dropped)
  const rootPend = { ...baseChat, messages: { root: { ...baseChat.messages.root,
    swipes: [{ text: 'Welcome.', createdAt: 1, modelId: null, images: [{ prompt: 'x', pending: true }] }] } } };
  const rootHealed = pruneInterrupted(rootPend);
  ok(rootHealed !== rootPend && rootHealed.messages.root.swipes[0].images[0].error === true
    && !('pending' in rootHealed.messages.root.swipes[0].images[0]),
    'pending image heals even on the root greeting swipe');

  // healImageEntry keeps `pos` (the image's placement in the reply) through
  // the pending → error rebuild; a missing pos is not invented.
  const healedPos = healImageEntry({ pending: true, prompt: 'a door', caption: 'Door', at: 5, pos: 42 });
  ok(healedPos.error === true && healedPos.pos === 42 && !('pending' in healedPos)
    && healedPos.prompt === 'a door' && healedPos.caption === 'Door' && healedPos.at === 5,
    'heal keeps pos (and the other fields), drops pending');
  const healedNoPos = healImageEntry({ pending: true, prompt: 'x', at: 5 });
  ok(healedNoPos.error === true && !('pos' in healedNoPos), 'heal does not invent pos');
  const settled = { src: 'data:x', at: 1, pos: 7 };
  ok(healImageEntry(settled) === settled, 'settled entry returns by reference (pos untouched)');
  // `slot` (the take's placement id) survives the pending → error rebuild too.
  const healedSlot = healImageEntry({ pending: true, prompt: 'a door', at: 5, slot: 's1' });
  ok(healedSlot.error === true && healedSlot.slot === 's1' && !('pending' in healedSlot),
    'heal keeps slot, drops pending');
  const settledSlot = { src: 'data:x', at: 1, slot: 's1' };
  ok(healImageEntry(settledSlot) === settledSlot, 'settled entry with slot returns by reference');
}

// ---- shown images leave a cheap marker in fed-back history (v4.10) ----
section('image history markers');
{
  const imgChat = (u1images, a1images) => ({
    ...baseChat,
    messages: {
      root: node('root', null, 'assistant', 'Welcome to Veyra, {{user}}.', 1),
      u1: { ...node('u1', 'root', 'user', 'hi', 2), fromSwipe: 0,
        swipes: [{ text: 'hi', createdAt: 2, modelId: null, ...(u1images ? { images: u1images } : {}) }] },
      a1: { ...node('a1', 'u1', 'assistant', 'Look at this.', 3), fromSwipe: 0,
        swipes: [{ text: 'Look at this.', createdAt: 3, modelId: null, ...(a1images ? { images: a1images } : {}) }] },
    },
    activeLeafId: 'a1',
  });
  const find1 = (r, frag) => r.messages.find(m => m.content.includes(frag));
  const r1 = assemblePrompt({ scenario: baseScenario, persona, settings,
    chat: imgChat(null, [{ src: 'data:image/webp;base64,xx', caption: 'A dragon over Veyra', prompt: 'dragon prompt', at: 3 }]) });
  ok(find1(r1, 'Look at this.').content.includes('\n\n[Image shown: A dragon over Veyra]'),
    'shown image leaves a caption marker in fed-back history');
  const r2 = assemblePrompt({ scenario: baseScenario, persona, settings,
    chat: imgChat(null, [{ src: 'data:x', prompt: 'dragon prompt', at: 3 }]) });
  ok(find1(r2, 'Look at this.').content.includes('[Image shown: dragon prompt]'),
    'marker falls back to the prompt when no caption');
  const r3 = assemblePrompt({ scenario: baseScenario, persona, settings,
    chat: imgChat(null, [{ error: true, prompt: 'lost image', at: 3 }, { pending: true, prompt: 'pending image', at: 3 }]) });
  ok(!r3.messages.some(m => m.content.includes('[Image shown:')),
    'error/pending entries (no src) leave no marker');
  const r4 = assemblePrompt({ scenario: baseScenario, persona, settings,
    chat: imgChat([{ src: 'data:y', caption: 'User sketch', at: 2 }], null) });
  ok(r4.messages.find(m => m.role === 'user').content.includes('[Image shown: User sketch]'),
    'marker applies to user messages too');
  const r5 = assemblePrompt({ scenario: baseScenario, persona, settings,
    chat: imgChat(null, [{ src: 'data:z', caption: 'x'.repeat(300), at: 3 }]) });
  ok(find1(r5, 'Look at this.').content.includes(`[Image shown: ${'x'.repeat(200)}]`),
    'marker text is capped at 200 chars');
  // Multi-take slots (image takes): ONE marker per slot, from the active
  // take — default the last take, or the imgUsed pick.
  const takes = [
    { src: 'data:t0', caption: 'First take', prompt: 'p', at: 3, slot: 's1' },
    { src: 'data:t1', caption: 'Second take', prompt: 'p', at: 4, slot: 's1' },
  ];
  const m6 = find1(assemblePrompt({ scenario: baseScenario, persona, settings,
    chat: imgChat(null, takes) }), 'Look at this.').content;
  ok((m6.match(/\[Image shown:/g) ?? []).length === 1 && m6.includes('[Image shown: Second take]'),
    'a multi-take slot leaves exactly one marker, from the last take by default');
  const c7 = imgChat(null, takes);
  c7.messages = { ...c7.messages, a1: { ...c7.messages.a1,
    swipes: [{ ...c7.messages.a1.swipes[0], imgUsed: { s1: 0 } }] } };
  const m7 = find1(assemblePrompt({ scenario: baseScenario, persona, settings,
    chat: c7 }), 'Look at this.').content;
  ok((m7.match(/\[Image shown:/g) ?? []).length === 1 && m7.includes('[Image shown: First take]'),
    'imgUsed picks the take the marker describes');
}

// ---- splitImageCalls (v4.10) ----
section('splitImageCalls');
{
  const img = { name: 'generate_image', args: { prompt: 'a dragon' }, error: null, raw: '{}' };
  const loreCall = { name: 'add_lore', args: {}, error: null, raw: '{}' };
  const bad = { name: '', args: {}, error: 'malformed JSON', raw: '…' };
  const unknown = { name: 'explode', args: {}, error: null, raw: '{}' };
  const errImg = { name: 'generate_image', args: {}, error: 'malformed JSON', raw: '…' };
  const { imageCalls, loreCalls } = splitImageCalls([img, loreCall, bad, unknown, errImg]);
  ok(imageCalls.length === 1 && imageCalls[0] === img, 'generate_image call partitioned out');
  ok(loreCalls.length === 4 && loreCalls[0] === loreCall && loreCalls.includes(bad)
    && loreCalls.includes(unknown) && loreCalls.includes(errImg),
    'lore/malformed/unknown/error calls all stay in loreCalls');
  const empty = splitImageCalls(undefined);
  ok(empty.imageCalls.length === 0 && empty.loreCalls.length === 0, 'missing input partitions to empty lists');
  ok(IMAGE_CALL_CAP === 1 && DEFAULT_IMAGE_PROMPT.includes('generate_image') && DEFAULT_AVATAR_GEN_PROMPT.length > 0,
    'image call cap + default prompts present');
}

// ---- connection profiles ----
section('connection profiles');
{
  const st = {
    endpoint: 'http://a:1', apiKey: 'k1', model: 'm1', auxModel: 'm2',
    samplers: { temperature: 0.7 }, disabledSamplers: ['top_k'], customSamplers: [{ id: 'x', key: 'k' }],
    serverToken: 'secret', contextLength: 4096, platformPrompt: 'pp',
  };
  const fields = profileFromSettings(st);
  ok(fields.endpoint === 'http://a:1' && fields.model === 'm1' && fields.samplers.temperature === 0.7,
    'profile snapshot carries connection, model and sampler fields');
  ok(!('serverToken' in fields) && !('contextLength' in fields) && !('platformPrompt' in fields)
    && !PROFILE_FIELDS.includes('serverToken'),
    'profile snapshot excludes the server token and unrelated settings');
  const profile = { id: 'P', name: 'p', fields: { ...fields, bogus: 1 } };
  const applied = applyProfile(st, profile);
  ok(applied.endpoint === 'http://a:1' && applied.apiKey === 'k1' && applied.auxModel === 'm2'
    && applied.serverToken === 'secret' && applied.contextLength === 4096,
    'apply overlays profile fields, keeps the rest of the settings');
  ok(!('bogus' in applied), 'apply ignores keys outside the allowlist');
  ok(st.endpoint === 'http://a:1' && !('bogus' in st), 'apply does not mutate the input');
  const cleared = applyProfile(st, { id: 'P2', name: 'q', fields: { ...fields, endpoint: 'http://b:2' } });
  ok(cleared.endpoint === 'http://b:2' && cleared.apiKey === 'k1', 'second profile overlays only what differs');
}

// ---- image prompt prefix (v4.10) ----
section('image prompt prefix');
{
  ok(imagePromptWithPrefix('masterpiece, best quality', 'a dragon') === 'masterpiece, best quality, a dragon',
    'non-empty prefix comma-joins ahead of the prompt');
  ok(imagePromptWithPrefix('', 'a dragon') === 'a dragon', 'empty prefix passes the prompt through');
  ok(imagePromptWithPrefix('   ', 'a dragon') === 'a dragon', 'blank prefix passes the prompt through');
  ok(imagePromptWithPrefix('  detailed  ', 'a dragon') === 'detailed, a dragon', 'prefix is trimmed before joining');
}

// ---- character card export + PNG embed (v4.10) ----
section('character card export');
{
  const src3 = normalizeScenario({
    id: 'S1', name: 'Mia Voss', description: 'A teaser line.', tags: ['scifi'],
    backstory: 'The docks of Veyra.', greeting: 'Mia Voss: "Well, look who it is."',
    scenarioInstructions: 'Stay in character.', alternateGreetings: ['Alt one.'],
  });
  const char3 = normalizeCharacter({
    id: 'C1', name: 'Mia Voss', content: 'A smuggler. Quick-witted.',
    greeting: 'Mia Voss: "Well, look who it is."', alternateGreetings: ['Alt one.'],
  });
  const card = buildCharacterCard(src3, char3);
  ok(card.spec === 'chara_card_v2' && card.spec_version === '2.0' && card.data.name === 'Mia Voss',
    'builds a chara_card v2 object');
  const rt = parseCharacterCard(card);
  ok(rt && rt.character.name === 'Mia Voss' && rt.scenario.name === 'Mia Voss', 'round-trip: name');
  ok(rt.character.content === char3.content, 'round-trip: description → character content');
  ok(rt.scenario.description === src3.description, 'round-trip: description → creator_notes → scenario metadata');
  ok(rt.character.greeting === char3.greeting && rt.scenario.greeting === src3.greeting,
    'round-trip: first_mes → both greetings');
  ok(rt.scenario.backstory === src3.backstory, 'round-trip: backstory → scenario field');
  ok(rt.scenario.scenarioInstructions === src3.scenarioInstructions, 'round-trip: scenarioInstructions → system_prompt');
  ok(rt.scenario.tags.join(',') === 'scifi', 'round-trip: tags');
  ok(rt.character.alternateGreetings.length === 1 && rt.character.alternateGreetings[0] === 'Alt one.'
    && rt.scenario.alternateGreetings[0] === 'Alt one.', 'round-trip: alternateGreetings');
  // Character-only export (character linked nowhere): a null scenario still
  // builds a valid card — character fields carry it, scenario fields empty.
  const solo = buildCharacterCard(null, char3);
  ok(solo.data.name === 'Mia Voss' && solo.data.scenario === '' && solo.data.creator_notes === ''
    && solo.data.system_prompt === '' && solo.data.tags.length === 0 && solo.data.first_mes === char3.greeting,
    'null scenario → character-only card');
  const rtSolo = parseCharacterCard(solo);
  ok(rtSolo && rtSolo.character.name === 'Mia Voss' && rtSolo.character.content === char3.content
    && rtSolo.character.greeting === char3.greeting && rtSolo.scenario.backstory === '',
    'null-scenario card round-trips the character');
}
section('PNG card embed');
{
  // Minimal PNG the extractor accepts: signature + one IHDR + IEND (chunk
  // contents/CRCs are not validated by the extractor).
  const minimalPng = () => {
    const ihdr = Buffer.alloc(8 + 13 + 4);
    ihdr.writeUInt32BE(13, 0);
    ihdr.write('IHDR', 4, 'latin1');
    const iend = Buffer.alloc(8 + 4);
    iend.writeUInt32BE(0, 0);
    iend.write('IEND', 4, 'latin1');
    return new Uint8Array(Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), ihdr, iend]));
  };
  const json = JSON.stringify({ spec: 'chara_card_v2', data: { name: 'Mia "☁" Voss', note: 'héllo' } });
  const src = minimalPng();
  const embedded = embedPngCardJson(src, json);
  ok(extractPngCardJson(embedded) === json, 'embed → extract round-trips the JSON exactly (UTF-8 + base64)');
  ok(src.length === 8 + 25 + 12 && extractPngCardJson(src) === null, 'input bytes untouched (still cardless)');
  // chunk structure: inserted right after IHDR, length/type/CRC well-formed
  const off = 8 + 25; // signature + IHDR chunk
  const be32 = (a, o) => (((a[o] << 24) | (a[o + 1] << 16) | (a[o + 2] << 8) | a[o + 3]) >>> 0);
  const u8type = (a, o) => String.fromCharCode(a[o + 4], a[o + 5], a[o + 6], a[o + 7]);
  const len = be32(embedded, off);
  ok(u8type(embedded, off) === 'tEXt' && len === ('chara\0'.length + Buffer.from(json, 'utf8').toString('base64').length),
    'tEXt chunk inserted before IEND with the chara payload length');
  ok(be32(embedded, off + 8 + len) === pngCrc32(embedded.subarray(off + 4, off + 8 + len)),
    'embedded chunk CRC32 validates');
  ok(be32(embedded, off + 8 + len + 4 + 0) === 0 && u8type(embedded, off + 8 + len + 4) === 'IEND',
    'IEND follows the inserted chunk');
  let threw = false;
  try { embedPngCardJson(new Uint8Array([1, 2, 3, 4]), '{}'); } catch { threw = true; }
  ok(threw, 'non-PNG input throws');
  threw = false;
  try { embedPngCardJson(new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), '{}'); } catch { threw = true; }
  ok(threw, 'PNG without IEND throws');
}

// ---- avatar field import healing (v4.10) ----
section('avatar normalization');
{
  ok(normalizeCharacter({ name: 'Z' }).avatar === '', 'character missing avatar heals to empty string');
  ok(normalizeCharacter({ name: 'Z', avatar: 42 }).avatar === '', 'character non-string avatar heals to empty string');
  ok(normalizeCharacter({ name: 'Z', avatar: 'data:image/webp;base64,xx' }).avatar === 'data:image/webp;base64,xx',
    'character avatar string kept');
  ok(normalizeScenario({ name: 'X' }).avatar === '', 'scenario missing avatar heals to empty string');
  ok(normalizeScenario({ name: 'X', avatar: null }).avatar === '', 'scenario non-string avatar heals to empty string');
  ok(normalizeScenario({ name: 'X', avatar: 'data:image/png;base64,yy' }).avatar === 'data:image/png;base64,yy',
    'scenario avatar string kept');
  ok(normalizeCharacter({ name: 'Z' }).avatarFull === '', 'character missing avatarFull heals to empty string');
  ok(normalizeCharacter({ name: 'Z', avatarFull: 42 }).avatarFull === '', 'character non-string avatarFull heals to empty string');
  ok(normalizeCharacter({ name: 'Z', avatarFull: 'data:image/webp;base64,xx' }).avatarFull === 'data:image/webp;base64,xx',
    'character avatarFull string kept');
  ok(normalizeScenario({ name: 'X' }).avatarFull === '', 'scenario missing avatarFull heals to empty string');
  ok(normalizeScenario({ name: 'X', avatarFull: null }).avatarFull === '', 'scenario non-string avatarFull heals to empty string');
  ok(normalizeScenario({ name: 'X', avatarFull: 'data:image/png;base64,yy' }).avatarFull === 'data:image/png;base64,yy',
    'scenario avatarFull string kept');
  // Character-type lore pieces (tool-registered characters) carry avatars too.
  ok(normalizeLorePiece({ title: 'T' }).avatar === '', 'lore piece missing avatar heals to empty string');
  ok(normalizeLorePiece({ title: 'T', avatar: 42 }).avatar === '', 'lore piece non-string avatar heals to empty string');
  ok(normalizeLorePiece({ title: 'T', avatar: 'data:image/webp;base64,xx' }).avatar === 'data:image/webp;base64,xx',
    'lore piece avatar string kept');
  ok(normalizeLorePiece({ title: 'T' }).avatarFull === '', 'lore piece missing avatarFull heals to empty string');
  ok(normalizeLorePiece({ title: 'T', avatarFull: null }).avatarFull === '', 'lore piece non-string avatarFull heals to empty string');
  ok(normalizeLorePiece({ title: 'T', avatarFull: 'data:image/webp;base64,xx' }).avatarFull === 'data:image/webp;base64,xx',
    'lore piece avatarFull string kept');
}

section('image externalization (extractImages / rehydrateImages)');
{
  const A = 'data:image/webp;base64,AAAA';
  const B = 'data:image/png;base64,BBBB';
  const entity = {
    name: 'Chat', avatar: A,
    messages: { n1: { swipes: [{ text: 'hi', images: [{ src: A, caption: 'x' }, { src: B }] }, { text: 'plain' }] } },
  };
  const { entity: stripped, images } = extractImages(entity, new Map());
  ok(images.length === 2, 'two distinct images extracted (dedupe within entity)');
  ok(entity.avatar === A && entity.messages.n1.swipes[0].images[0].src === A, 'input not mutated');
  const idA = hashImageId(A), idB = hashImageId(B);
  ok(stripped.avatar === `imgref:${idA}`, 'avatar replaced by sentinel');
  ok(stripped.messages.n1.swipes[0].images[0].src === `imgref:${idA}`, 'shared URL shares one id');
  ok(stripped.messages.n1.swipes[0].images[1].src === `imgref:${idB}`, 'second image gets its own id');
  ok(stripped.messages.n1.swipes[0].images[0].caption === 'x', 'non-image strings untouched');
  ok(stripped.messages.n1.swipes[1] === entity.messages.n1.swipes[1], 'unchanged subtree shared by reference');
  ok(/^imgref:[0-9a-f]{16}$/.test(stripped.avatar), 'sentinel format');

  // Dedupe against already-stored images: same content → no new row.
  const known = new Map([[idA, A]]);
  const again = extractImages({ a: A, b: B }, known);
  ok(again.images.length === 1 && again.images[0][0] === idB, 'known image deduped, only the new one stored');
  ok(again.entity.a === `imgref:${idA}`, 'known image still replaced by its sentinel');

  // Hash collision: known id with DIFFERENT content → salted id.
  const collider = new Map([[idA, 'data:image/gif;base64,OTHER']]);
  const col = extractImages({ a: A }, collider);
  ok(col.images.length === 1 && col.images[0][0] === `${idA}-2`, 'collision salts the id');
  ok(col.entity.a === `imgref:${idA}-2`, 'salted sentinel written');

  // Re-extracting an already-extracted entity is a no-op (idempotent).
  const re = extractImages(stripped, new Map());
  ok(re.images.length === 0 && re.entity === stripped, 're-extraction is a no-op by reference');

  // Round-trip.
  const map = new Map(images);
  const back = rehydrateImages(stripped, map);
  ok(back.avatar === A && back.messages.n1.swipes[0].images[1].src === B, 'rehydrate round-trips');
  ok(back.avatar === map.get(idA), 'rehydrated string is the shared stored instance');
  ok(rehydrateImages(stripped, new Map()).avatar === stripped.avatar, 'missing ref passes through');
  ok(rehydrateImages({ t: 'imgref:nothex' }, map).t === 'imgref:nothex', 'ref-shaped user text untouched');
  ok(stripped.avatar.startsWith('imgref:'), 'rehydrate does not mutate the stripped entity');

  // GC reference scan: urls found across nested entities, compared by URL.
  const refs = collectImageUrls({ list: [entity, { deep: { x: B } }] });
  ok(refs.has(A) && refs.has(B) && refs.size === 2, 'collectImageUrls finds nested image URLs');
  ok(collectImageUrls({ t: 'data:text/plain,xx' }).size === 0, 'non-image data URLs not collected');
}

console.log(failures === 0 ? '\nAll tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
