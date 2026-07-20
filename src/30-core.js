// ============================================================================
// PURE CORE — no DOM, no React, no imports. Everything between the markers is
// extracted and unit-tested standalone by tests/assembler.test.mjs.
// === PURE CORE START ===
const TOKEN_CHARS = 3.3; // char-estimate fallback: ~3.3 chars per token
const DEFAULT_SEARCH_DEPTH = 2048; // estimated tokens scanned for lore keys
const LINK_BOOST = 2; // effective-weight bonus from one active linking piece
const MEMORY_CAP = 100;
const MEMORY_EVERY = 30; // messages on active path between auto-summaries
const LAYER_CAPS = { static: 0.30, lore: 0.20, memory: 0.10 }; // history = rest
const LENGTH_PRESETS = {
  short:  { maxTokens: 150, directive: 'Keep your response concise: one or two short paragraphs.' },
  medium: { maxTokens: 400, directive: 'Write a response of moderate length: a few paragraphs.' },
  long:   { maxTokens: 800, directive: 'Write a long, detailed response with rich description.' },
};

const estimateTokens = (text) => Math.ceil(String(text ?? '').length / TOKEN_CHARS);
// Single-line, whitespace-collapsed excerpt (for manifest previews/tooltips).
const toPreview = (text, max = 300) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
const deepClone = (obj) => JSON.parse(JSON.stringify(obj));
// {{user}} is the only supported macro (no {{char}} — ambiguous in multi-char scenes).
const subUser = (text, personaName) =>
  String(text ?? '').replace(/\{\{user\}\}/gi, personaName || 'User');

// ---- message tree -------------------------------------------------------
const activeText = (node) => node?.swipes?.[node.activeSwipe]?.text ?? '';

// Oldest → newest path from the root down to activeLeafId.
function getActivePath(messages, activeLeafId) {
  const path = [];
  const seen = new Set();
  let id = activeLeafId;
  while (id && messages?.[id] && !seen.has(id)) {
    seen.add(id);
    path.unshift(messages[id]);
    id = messages[id].parentId;
  }
  return path;
}

function appendMessage(chat, parentId, role, text, modelId = null) {
  const id = uid();
  const node = { id, parentId, role, swipes: [{ text, createdAt: Date.now(), modelId }], activeSwipe: 0, edited: false };
  const messages = { ...chat.messages, [id]: node };
  // Record which swipe of the parent the conversation continues from.
  const parent = messages[parentId];
  if (parent) messages[parentId] = { ...parent, usedSwipe: parent.activeSwipe };
  return { chat: { ...chat, messages, activeLeafId: id }, id };
}

// Reset every node's activeSwipe to its recorded usedSwipe (the version the
// conversation actually continued from). No-op (same object) when nothing
// needs changing. Called on chat open and after branching.
function applyUsedSwipes(chat) {
  let changed = false;
  const messages = { ...chat.messages };
  for (const [id, n] of Object.entries(messages)) {
    if (Number.isInteger(n.usedSwipe) && n.usedSwipe !== n.activeSwipe
        && n.usedSwipe >= 0 && n.usedSwipe < n.swipes.length) {
      messages[id] = { ...n, activeSwipe: n.usedSwipe };
      changed = true;
    }
  }
  return changed ? { ...chat, messages } : chat;
}

// Remove debris from generations killed by a page reload/close: assistant
// swipes with empty text (the stream never delivered). A non-root node left
// with no swipes at all was a generation placeholder — drop it and re-parent
// its children. Root is never touched. No-op (same object) when clean.
// Called on chat open, before applyUsedSwipes.
function pruneInterrupted(chat) {
  if (!chat?.messages) return chat;
  let changed = false;
  const out = {};
  for (const [id, n] of Object.entries(chat.messages)) {
    if (n.role !== 'assistant' || !n.parentId) { out[id] = n; continue; }
    const swipes = n.swipes ?? [];
    const kept = [];
    const idxMap = new Map(); // old swipe index → new index
    swipes.forEach((s, i) => {
      if ((s?.text ?? '') === '') return;
      idxMap.set(i, kept.length);
      kept.push(s);
    });
    if (kept.length === swipes.length) { out[id] = n; continue; }
    changed = true;
    if (kept.length === 0) continue; // drop the placeholder node entirely
    out[id] = {
      ...n, swipes: kept,
      activeSwipe: idxMap.get(n.activeSwipe) ?? kept.length - 1,
      ...(n.usedSwipe != null ? { usedSwipe: idxMap.get(n.usedSwipe) ?? kept.length - 1 } : {}),
    };
  }
  if (!changed) return chat;
  // Re-parent children of dropped nodes to the dropped node's parent.
  for (const n of Object.values(out))
    while (n.parentId && !out[n.parentId]) n.parentId = chat.messages[n.parentId]?.parentId ?? null;
  let activeLeafId = chat.activeLeafId;
  while (activeLeafId && !out[activeLeafId]) activeLeafId = chat.messages[activeLeafId]?.parentId ?? null;
  return { ...chat, messages: out, activeLeafId };
}

// Returns a new messages map with nodeId and all its descendants removed.
function deleteSubtree(messages, nodeId) {
  const copy = { ...messages };
  const stack = [nodeId];
  while (stack.length) {
    const id = stack.pop();
    for (const [cid, n] of Object.entries(copy))
      if (n.parentId === id) stack.push(cid);
    delete copy[id];
  }
  return copy;
}

// Truncate the active branch at nodeId and roll the memory store back to it.
function rewindChat(chat, nodeId) {
  const node = chat.messages[nodeId];
  if (!node) return chat;
  const cutoff = node.swipes[node.activeSwipe]?.createdAt ?? Date.now();
  const memories = (chat.memoryStore?.memories ?? []).filter(m => m.createdAt <= cutoff);
  const next = { ...chat, activeLeafId: nodeId, memoryStore: { memories, cursor: 0 } };
  next.memoryStore.cursor = getActivePath(next.messages, nodeId).length;
  return next;
}

// Fork the whole chat (messages + memory store) into a new chat rooted at the
// same tree, with nodeId as the active leaf.
function branchChat(chat, nodeId) {
  const copy = deepClone(chat);
  return { ...copy, id: uid(), name: `${chat.name} (branch)`, activeLeafId: nodeId, createdAt: Date.now() };
}

// ---- lore engine --------------------------------------------------------
// Semantic ("smart") activation: pieces may set `smart: true` and the app
// (settings.embeddingModel) then embeds them + the recent conversation at
// generation time; ids above the semantic threshold arrive here via the
// `preActivated` set and activate with reason 'semantic' — otherwise they
// behave exactly like keyword-triggered pieces (weight, budget, link boost).
// `preActivated` may also be a Map(id → reason) for other forced injections
// (e.g. /pov forcing a character piece in with reason 'pov').
// Keyword triggers. Keys are regexes; per-piece options: `caseSensitive`
// (default off → 'i' flag) and `wholeWord` (default off → wraps the key in
// \b…\b so "cat" doesn't match "cathedral"). Keys shorter than
// MIN_KEY_LENGTH never match (single-char triggers fire on everything —
// FictionLab arrived at the same floor).
const MIN_KEY_LENGTH = 2;
function keyMatches(key, text, { wholeWord = false, caseSensitive = false } = {}) {
  if (!key || !text || String(key).length < MIN_KEY_LENGTH) return false;
  const pattern = wholeWord ? `\\b(?:${key})\\b` : key;
  try { return new RegExp(pattern, caseSensitive ? '' : 'i').test(text); } catch { return false; }
}

// Determine which pieces are active this turn.
// Returns Map(id → { piece, reason: 'pinned'|'triggered'|'semantic'|'pov'|'link-boosted', boost }).
function scanLore(lorePieces, conversationText, preActivated = null) {
  const pieces = Array.isArray(lorePieces) ? lorePieces : [];
  const active = new Map();
  for (const piece of pieces) {
    if (!piece || piece.enabled === false) continue;
    if (piece.pinned) { active.set(piece.id, { piece, reason: 'pinned', boost: 0 }); continue; }
    if (preActivated?.has(piece.id)) {
      const reason = preActivated instanceof Map ? (preActivated.get(piece.id) ?? 'semantic') : 'semantic';
      active.set(piece.id, { piece, reason, boost: 0 }); continue;
    }
    const depth = Number(piece.searchDepth) > 0 ? Number(piece.searchDepth) : DEFAULT_SEARCH_DEPTH;
    const scanText = conversationText.slice(-Math.round(depth * TOKEN_CHARS));
    const opts = { wholeWord: !!piece.wholeWord, caseSensitive: !!piece.caseSensitive };
    if ((Array.isArray(piece.keys) ? piece.keys : []).some(k => keyMatches(k, scanText, opts)))
      active.set(piece.id, { piece, reason: 'triggered', boost: 0 });
  }
  // One hop of link boosting: an active piece lends weight to its linked pieces.
  for (const { piece } of [...active.values()]) {
    for (const linkId of piece.links ?? []) {
      const target = pieces.find(p => p.id === linkId);
      if (!target || target.enabled === false || target.pinned) continue;
      const entry = active.get(linkId);
      if (entry) entry.boost += LINK_BOOST;
      else active.set(linkId, { piece: target, reason: 'link-boosted', boost: LINK_BOOST });
    }
  }
  return active;
}

// Sort candidates by effective weight desc and fill the lore budget.
function selectLore(lorePieces, conversationText, budgetTokens, preActivated = null) {
  const candidates = [...scanLore(lorePieces, conversationText, preActivated).values()].map(a => ({
    id: a.piece.id,
    title: a.piece.title ?? '',
    content: a.piece.content ?? '',
    type: a.piece.type ?? 'lore',
    reason: a.reason,
    boost: a.boost,
    effWeight: (Number(a.piece.weight) || 0) + a.boost,
    tokens: estimateTokens(`${a.piece.title ?? ''}\n${a.piece.content ?? ''}`),
  }));
  candidates.sort((x, y) => y.effWeight - x.effWeight);
  const selected = [];
  let used = 0;
  for (const c of candidates) {
    if (used + c.tokens > budgetTokens) continue; // a smaller piece may still fit
    selected.push(c);
    used += c.tokens;
  }
  return selected;
}

// ---- memory store -------------------------------------------------------
// Append a memory, then evict oldest unpinned entries until within cap.
// Pinned entries always survive (store may exceed cap if everything is pinned).
function addMemory(store, text, now = Date.now(), cap = MEMORY_CAP) {
  const memories = [...(store?.memories ?? []), { id: uid(), text, pinned: false, createdAt: now }];
  while (memories.length > cap) {
    const idx = memories.findIndex(m => !m.pinned);
    if (idx === -1) break;
    memories.splice(idx, 1);
  }
  return { ...(store ?? {}), memories };
}

// ---- context assembler --------------------------------------------------
// Pure function: same inputs → same { messages, manifest }. The manifest
// records exactly what was injected and why (powers the Context Inspector).
function assemblePrompt({ scenario, persona, chat, settings = {}, platformPrompt = '', preActivated = null, pov = null }) {
  const personaName = persona?.name?.trim() || 'User';
  const reserve = Number(settings.maxTokens) || LENGTH_PRESETS.medium.maxTokens;
  const contextLength = Number(settings.contextLength) || 8192;
  const budget = Math.max(0, contextLength - reserve);
  const manifest = { contextLength, reserve, budget, layers: {}, warnings: [] };

  // 1. static layer: platform prompt + scenario instructions + backstory +
  //    persona block + per-chat custom instructions + length directive
  const leadParts = [];
  const plat = subUser(platformPrompt, personaName).trim();
  if (plat) leadParts.push(plat);
  const scenInstr = subUser(scenario?.scenarioInstructions ?? '', personaName).trim();
  if (scenInstr) leadParts.push(scenInstr);
  const tailParts = [];
  if (persona?.description?.trim())
    tailParts.push(`${personaName} is ${subUser(persona.description, personaName).trim()}`);
  const customInstr = subUser(chat?.customInstructions ?? '', personaName).trim();
  if (customInstr) tailParts.push(customInstr);
  // Length directive: user-editable in settings; falls back to the preset's
  // default text when unset (existing installs keep current behavior).
  const directive = (settings.lengthDirective ?? LENGTH_PRESETS[settings.responseLength ?? 'medium']?.directive)?.trim();
  if (directive) tailParts.push(directive);
  // /pov reframe: one generation written from another character's perspective.
  const povName = String(pov?.name ?? '').trim();
  if (povName)
    tailParts.push(`Write the next reply from ${povName}'s perspective — ${povName}'s actions, words, and thoughts. Begin the reply with "${povName}:".`);
  let backstory = subUser(scenario?.backstory ?? '', personaName).trim();

  const staticCap = Math.floor(budget * LAYER_CAPS.static);
  const buildStatic = (bs) => [...leadParts, ...(bs ? [bs] : []), ...tailParts].join('\n\n');
  let staticText = buildStatic(backstory);
  if (backstory && estimateTokens(staticText) > staticCap) {
    const allowedChars = Math.max(0, Math.floor((staticCap - estimateTokens(buildStatic(''))) * TOKEN_CHARS));
    backstory = backstory.slice(0, allowedChars);
    staticText = buildStatic(backstory);
    manifest.warnings.push('Backstory truncated to fit the static-layer budget.');
  }
  const staticTokens = estimateTokens(staticText);
  manifest.layers.static = { tokens: staticTokens, cap: staticCap };

  // 2. conversation: root assistant node doubles as the scenario greeting.
  //    The greeting is always injected, so its tokens are budgeted like a layer.
  const path = getActivePath(chat?.messages ?? {}, chat?.activeLeafId);
  let greetingNode = null;
  let historyNodes = path;
  if (path.length > 0 && !path[0].parentId && path[0].role === 'assistant') {
    greetingNode = path[0];
    historyNodes = path.slice(1);
  }
  const greetingTokens = greetingNode ? estimateTokens(subUser(activeText(greetingNode), personaName)) : 0;
  manifest.layers.greeting = { tokens: greetingTokens };
  const conversationText = path.map(activeText).join('\n');

  // 3. lore layer
  const loreCap = Math.floor(budget * LAYER_CAPS.lore);
  const lorePieces = Array.isArray(scenario?.lorePieces) ? scenario.lorePieces : [];
  // /pov forces the named character's piece in (reason 'pov') alongside any
  // semantic pre-activations.
  let preAct = preActivated;
  if (pov?.pieceId) {
    preAct = new Map();
    if (preActivated instanceof Map) for (const [id, r] of preActivated) preAct.set(id, r);
    else if (preActivated) for (const id of preActivated) preAct.set(id, 'semantic');
    preAct.set(pov.pieceId, 'pov');
  }
  const loreScanned = scanLore(lorePieces, conversationText, preAct);
  const loreSel = selectLore(lorePieces, conversationText, loreCap, preAct);
  const loreText = loreSel.map(s => `[${s.title}]\n${subUser(s.content, personaName)}`).join('\n\n');
  const loreTokens = loreText ? estimateTokens(loreText) : 0;
  // Enabled pieces that were NOT injected — observability for "did it even scan?"
  const selectedIds = new Set(loreSel.map(s => s.id));
  const inactive = [];
  for (const p of lorePieces) {
    if (!p || p.enabled === false || selectedIds.has(p.id)) continue;
    inactive.push({
      id: p.id, title: p.title ?? '',
      reason: loreScanned.has(p.id) ? 'over-budget' : 'not-triggered',
      tokens: estimateTokens(`${p.title ?? ''}\n${p.content ?? ''}`),
      preview: toPreview(p.content), content: p.content ?? '',
    });
  }
  const overBudget = inactive.filter(p => p.reason === 'over-budget').length;
  if (overBudget > 0)
    manifest.warnings.push(`${overBudget} lore piece(s) activated but didn't fit the lore budget.`);
  manifest.layers.lore = {
    tokens: loreTokens, cap: loreCap,
    pieces: loreSel.map(s => ({ id: s.id, title: s.title, type: s.type, reason: s.reason, boost: s.boost, weight: s.effWeight, tokens: s.tokens, preview: toPreview(s.content), content: s.content })),
    inactive,
  };

  // 4. memory layer: pinned first (oldest→newest), then recent unpinned
  const memCap = Math.floor(budget * LAYER_CAPS.memory);
  const memAll = Array.isArray(chat?.memoryStore?.memories) ? chat.memoryStore.memories : [];
  const memOrdered = [
    ...memAll.filter(m => m.pinned).sort((a, b) => a.createdAt - b.createdAt),
    ...memAll.filter(m => !m.pinned).sort((a, b) => b.createdAt - a.createdAt),
  ];
  const memSel = [];
  let memUsed = 0;
  for (const m of memOrdered) {
    const cost = estimateTokens(m.text);
    if (memUsed + cost > memCap) continue;
    memSel.push(m);
    memUsed += cost;
  }
  const memText = memSel.length ? `[Memories]\n${memSel.map(m => `- ${m.text}`).join('\n')}` : '';
  const memTokens = memText ? estimateTokens(memText) : 0;
  manifest.layers.memory = {
    tokens: memTokens, cap: memCap,
    memories: memSel.map(m => ({ id: m.id, pinned: !!m.pinned, tokens: estimateTokens(m.text), preview: toPreview(m.text), text: m.text ?? '' })),
  };

  // 5. history fills the remainder; oldest messages dropped first
  const historyCap = Math.max(0, budget - staticTokens - loreTokens - memTokens - greetingTokens);
  const kept = [];
  let histUsed = 0;
  for (let i = historyNodes.length - 1; i >= 0; i--) {
    const cost = estimateTokens(activeText(historyNodes[i]));
    if (histUsed + cost > historyCap && kept.length > 0) break; // always keep the newest
    kept.unshift(historyNodes[i]);
    histUsed += cost;
  }
  const dropped = historyNodes.length - kept.length;
  if (dropped > 0) manifest.warnings.push(`${dropped} oldest message(s) dropped to fit the context window.`);
  manifest.layers.history = { tokens: histUsed, cap: historyCap, kept: kept.length, dropped };

  // 6. chat-completions message array
  const messages = [{ role: 'system', content: staticText }];
  if (loreText) messages.push({ role: 'system', content: `[World Info]\n${loreText}` });
  if (memText) messages.push({ role: 'system', content: memText });
  if (greetingNode) messages.push({ role: 'assistant', content: subUser(activeText(greetingNode), personaName) });
  for (const n of kept)
    messages.push({ role: n.role === 'assistant' ? 'assistant' : 'user', content: subUser(activeText(n), personaName) });

  manifest.totalTokens = messages.reduce((t, m) => t + estimateTokens(m.content), 0);
  return { messages, manifest };
}
// === PURE CORE END ===

