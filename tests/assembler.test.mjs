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
  keyMatches, scanLore, selectLore, mergedLorePieces, addMemory, assemblePrompt,
  parseToolCalls, stripToolBlocks, stripToolBlocksMapped, applyToolCalls, pruneToolPieces, TOOL_CALL_CAP, splitSpeakerSegments,
  subVars, queueLorePiece, acceptQueuedLore, dismissQueuedLore };`;
const core = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(src));

const {
  MEMORY_CAP, LINK_BOOST, estimateTokens, subUser,
  activeText, getActivePath, appendMessage, applyUsedSwipes, pruneInterrupted, deleteSubtree, rewindChat, branchChat,
  keyMatches, scanLore, selectLore, mergedLorePieces, addMemory, assemblePrompt,
  parseToolCalls, stripToolBlocks, stripToolBlocksMapped, applyToolCalls, pruneToolPieces, TOOL_CALL_CAP, splitSpeakerSegments,
  subVars, queueLorePiece, acceptQueuedLore, dismissQueuedLore,
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
  const sel = selectLore([
    lore({ id: 'low', pinned: true, weight: 1, content: 'x'.repeat(30) }),
    lore({ id: 'high', keys: ['aa'], weight: 9, content: 'x'.repeat(30) }),
  ], 'aa', estimateTokens('x'.repeat(33)));
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

// ---- per-chat lore overlay (v2.0a) ----
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

// ---- tool calls (v2.0b) ----
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
    ok(p.calls.length === 1 && p.calls[0].name === 'add_lore', 'legacy "name" field still accepted');
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

// ---- multi-speaker segments (v2.0c) ----
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
}

// ---- story variables + author's note + lore queue (v2.0d) ----
section('v2.0d: vars, notes, queue, custom tools');
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
  // custom tool actions
  {
    const defs = [
      { id: '1', name: 'add_beat', action: 'note' },
      { id: '2', name: 'track', action: 'set_var' },
      { id: '3', name: 'recruit', action: 'register_character' },
      { id: '4', name: 'add_lore', action: 'note' }, // shadowing attempt: built-in must win
      { id: '5', name: 'broken', action: 'explode' },
    ];
    let chat = baseChat;
    chat = applyToolCalls(chat, [{ name: 'add_beat', args: { text: 'rain incoming' } }], { customTools: defs }).chat;
    ok(chat.authorsNote === 'rain incoming', 'note action appends authorsNote');
    chat = applyToolCalls(chat, [{ name: 'add_beat', args: { text: 'second line' } }], { customTools: defs }).chat;
    ok(chat.authorsNote === 'rain incoming\nsecond line', 'note action appends with newline');
    chat = applyToolCalls(chat, [{ name: 'track', args: { name: 'hp', value: '7' } }], { customTools: defs }).chat;
    ok(chat.vars?.hp === '7', 'set_var writes chat.vars');
    chat = applyToolCalls(chat, [{ name: 'recruit', args: { name: 'Vex', description: 'd' } }], { customTools: defs }).chat;
    ok(chat.lorePieces?.[0]?.type === 'character' && chat.lorePieces[0].title === 'Vex', 'register_character alias works');
    const r = applyToolCalls(baseChat, [{ name: 'add_lore', args: { title: 'X', content: 'y' } }], { customTools: defs });
    ok(r.chat.lorePieces?.[0]?.type === 'lore', 'custom def cannot shadow a built-in');
    const r2 = applyToolCalls(baseChat, [{ name: 'broken', args: {} }], { customTools: defs });
    ok(!r2.results[0].ok && r2.results[0].note.includes('unknown action'), 'unknown custom action rejected');
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

console.log(failures === 0 ? '\nAll tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
