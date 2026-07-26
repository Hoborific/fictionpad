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

// charsPerToken is user-tunable (Settings → Generation); callers that budget
// against settings pass it through so estimates and caps stay consistent.
const estimateTokens = (text, charsPerToken = TOKEN_CHARS) =>
  Math.ceil(String(text ?? '').length / (Number(charsPerToken) > 0 ? Number(charsPerToken) : TOKEN_CHARS));
// Single-line, whitespace-collapsed excerpt (for manifest previews/tooltips).
const toPreview = (text, max = 300) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
const deepClone = (obj) => JSON.parse(JSON.stringify(obj));
// {{user}} is the only supported macro (no {{char}} — ambiguous in multi-char scenes).
// Function replacement: persona names containing $&, $$ etc. must substitute
// literally, not as replacement-string patterns.
const subUser = (text, personaName) =>
  String(text ?? '').replace(/\{\{user\}\}/gi, () => personaName || 'User');
// {{var:name}} story variables: per-chat key/value store; unknown variables
// substitute to empty. Lookup is case-insensitive (the macro regex is); an
// exact-case key wins on collision.
const subVars = (text, vars) =>
  String(text ?? '').replace(/\{\{var:([^}]+)\}\}/gi, (_, k) => {
    if (!vars) return '';
    const key = k.trim();
    if (Object.prototype.hasOwnProperty.call(vars, key)) return String(vars[key] ?? '');
    const found = Object.keys(vars).find(vk => vk.toLowerCase() === key.toLowerCase());
    return found === undefined ? '' : String(vars[found] ?? '');
  });

// Sampler params → request body fields. Flat keys pass through untouched;
// DOTTED keys (user-registered custom samplers, e.g.
// `chat_template_kwargs.enable_thinking`) expand into nested objects, with
// siblings sharing a prefix deep-merged into one parent. null/undefined
// values are dropped (a cleared override must not send null upstream).
// Flat/dotted collisions resolve last-write-wins in iteration order.
function expandSamplerParams(samplers) {
  const out = {};
  for (const [key, val] of Object.entries(samplers ?? {})) {
    if (val == null) continue;
    const parts = key.split('.').filter(Boolean);
    // Never walk into the prototype chain — a user-typed or imported key like
    // `__proto__.x` would otherwise pollute Object.prototype for the session.
    if (parts.some(p => p === '__proto__' || p === 'constructor' || p === 'prototype')) continue;
    if (parts.length <= 1) { out[key] = val; continue; }
    let node = out;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null || Array.isArray(node[parts[i]]))
        node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = val;
  }
  return out;
}

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
  // Re-parent children of dropped nodes to the dropped node's parent. Nodes
  // whose parentId must change are CLONED first — `out` otherwise shares node
  // objects by reference with the input chat, and mutating them would corrupt
  // the caller's tree.
  for (const [id, n] of Object.entries(out)) {
    let cur = n.parentId;
    while (cur && !out[cur]) cur = chat.messages[cur]?.parentId ?? null;
    if (cur !== n.parentId) out[id] = { ...n, parentId: cur };
  }
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

// Re-point the active leaf at nodeId (nothing is truncated — sibling branches
// are untouched) and roll the memory store back to it. The cutoff is
// position-based: entries stamped with `atLen` (active-path message count at
// creation) survive iff atLen <= the target's path length, so rollback is
// immune to regenerate (a new swipe gets a fresh createdAt). Entries lacking
// atLen fall back to the createdAt cutoff (target node's active-swipe
// createdAt). Tool-written lore (createdAt/atLen-tagged) and loreQueue
// proposals roll back with the same rule; hand-authored pieces (no createdAt)
// always survive.
// Deliberately rewind-EXEMPT: chat.vars and chat.authorsNote — they are world
// state, not narrative state, so rewinding the story does not un-write them.
function rewindChat(chat, nodeId) {
  const node = chat.messages[nodeId];
  if (!node) return chat;
  const pathLen = getActivePath(chat.messages, nodeId).length;
  const cutoff = node.swipes[node.activeSwipe]?.createdAt ?? Date.now();
  const keep = (e) => Number.isFinite(e?.atLen) ? e.atLen <= pathLen : (e?.createdAt ?? 0) <= cutoff;
  const memories = (chat.memoryStore?.memories ?? []).filter(keep);
  const lorePieces = Array.isArray(chat.lorePieces)
    ? chat.lorePieces.filter(keep) : chat.lorePieces;
  const loreQueue = Array.isArray(chat.loreQueue)
    ? chat.loreQueue.filter(keep) : chat.loreQueue;
  const next = {
    ...chat, activeLeafId: nodeId, memoryStore: { memories, cursor: 0 },
    ...(lorePieces !== chat.lorePieces ? { lorePieces } : {}),
    ...(loreQueue !== chat.loreQueue ? { loreQueue } : {}),
  };
  next.memoryStore.cursor = pathLen;
  next.emergentCursor = next.memoryStore.cursor; // extraction cadence rolls back too
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
// opts: user-tunable lore defaults (Settings → Generation) — per-piece
// searchDepth still wins over the global default.
function scanLore(lorePieces, conversationText, preActivated = null,
                  { searchDepth = DEFAULT_SEARCH_DEPTH, linkBoost = LINK_BOOST, chars = TOKEN_CHARS } = {}) {
  const pieces = Array.isArray(lorePieces) ? lorePieces : [];
  const active = new Map();
  for (const piece of pieces) {
    if (!piece || piece.enabled === false) continue;
    if (piece.pinned) { active.set(piece.id, { piece, reason: 'pinned', boost: 0 }); continue; }
    if (preActivated?.has(piece.id)) {
      const reason = preActivated instanceof Map ? (preActivated.get(piece.id) ?? 'semantic') : 'semantic';
      active.set(piece.id, { piece, reason, boost: 0 }); continue;
    }
    const depth = Number(piece.searchDepth) > 0 ? Number(piece.searchDepth) : searchDepth;
    const scanText = conversationText.slice(-Math.round(depth * chars));
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
      if (entry) entry.boost += linkBoost;
      else active.set(linkId, { piece: target, reason: 'link-boosted', boost: linkBoost });
    }
  }
  return active;
}

// Sort candidates by effective weight desc and fill the lore budget.
// opts.scanned: a precomputed scanLore result (assemblePrompt scans once and
// passes it in) — omitted, selectLore scans itself. Per-piece cost includes
// the `[title]\n` header exactly as rendered into the World Info block.
function selectLore(lorePieces, conversationText, budgetTokens, preActivated = null, opts = {}) {
  const scan = opts.scanned ?? scanLore(lorePieces, conversationText, preActivated, opts);
  const candidates = [...scan.values()].map(a => ({
    id: a.piece.id,
    title: a.piece.title ?? '',
    content: a.piece.content ?? '',
    type: a.piece.type ?? 'lore',
    reason: a.reason,
    boost: a.boost,
    effWeight: (Number(a.piece.weight) || 0) + a.boost,
    tokens: estimateTokens(`[${a.piece.title ?? ''}]\n${a.piece.content ?? ''}`, opts.chars),
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

// Global characters (Characters store) linked into a scenario
// (scenario.characterIds) or directly into a chat (chat.characterIds) resolve
// to character-type lore pieces at assembly time: the card is stored once and
// edits propagate live everywhere it's linked. They flow through the normal
// lore pipeline (pinned/keyword/semantic activation, budgets, /pov, speaker
// detection) — no separate prompt path. Missing ids are skipped (deleted
// characters, imported scenarios with dangling links).
function resolveCharacters(scenario, chat, charactersById) {
  if (!charactersById) return [];
  const ids = [
    ...(Array.isArray(scenario?.characterIds) ? scenario.characterIds : []),
    ...(Array.isArray(chat?.characterIds) ? chat.characterIds : []),
  ];
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const c = charactersById[id];
    if (!c) continue;
    out.push({
      id: c.id, type: 'character', title: c.name ?? '', content: c.content ?? '',
      keys: Array.isArray(c.keys) && c.keys.length ? c.keys : (c.name ? [c.name] : []),
      pinned: !!c.pinned, weight: c.weight ?? 0, links: [],
      enabled: c.enabled !== false, smart: !!c.smart,
      origin: 'character',
    });
  }
  return out;
}

// Per-chat scenario overlay: chat.lorePieces merge over the
// scenario's by id — the chat wins, including enabled:false to switch a
// scenario piece off for one chat only; chat-only pieces append after the
// scenario's. This is where model-generated characters/lore land
// and the "edit the scenario of this chat" surface. Branches inherit a copy
// via branchChat's deepClone. Linked global characters slot in after
// the scenario pieces — scenario wins on id collision, chat wins overall.
function mergedLorePieces(scenario, chat, charactersById = null) {
  const base = Array.isArray(scenario?.lorePieces) ? scenario.lorePieces : [];
  const chars = resolveCharacters(scenario, chat, charactersById);
  const over = Array.isArray(chat?.lorePieces) ? chat.lorePieces : [];
  const seenIds = new Set(base.map(p => p?.id));
  const baseAll = chars.length ? [...base, ...chars.filter(p => !seenIds.has(p.id))] : base;
  if (!over.length) return baseAll;
  const byId = new Map(over.filter(p => p?.id).map(p => [p.id, p]));
  const merged = baseAll.map(p => (p && byId.has(p.id) ? byId.get(p.id) : p));
  const baseIds = new Set(baseAll.map(p => p?.id));
  for (const p of over) if (p && !baseIds.has(p.id)) merged.push(p);
  return merged;
}

// ---- memory store -------------------------------------------------------
// Append a memory, then evict oldest unpinned entries until within cap.
// Pinned entries always survive (store may exceed cap if everything is pinned).
function addMemory(store, text, now = Date.now(), cap = MEMORY_CAP, atLen = null) {
  // atLen is stamped at creation, before eviction: in an all-pinned full store
  // the incoming entry is the one dropped, and stamping after the fact would
  // mis-tag an unrelated old memory's rewind position.
  const memories = [...(store?.memories ?? []), { id: uid(), text, pinned: false, createdAt: now,
    ...(Number.isFinite(atLen) ? { atLen } : {}) }];
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
function assemblePrompt({ scenario, persona, chat, settings = {}, platformPrompt = '', preActivated = null, pov = null, characters = null }) {
  const personaName = persona?.name?.trim() || 'User';
  const reserve = Number(settings.maxTokens) || LENGTH_PRESETS.medium.maxTokens;
  const contextLength = Number(settings.contextLength) || 8192;
  const budget = Math.max(0, contextLength - reserve);
  const manifest = { contextLength, reserve, budget, layers: {}, warnings: [] };
  // Layer budget fractions: user-overridable in Settings → Generation;
  // history always gets whatever the three layers leave behind.
  const caps = { ...LAYER_CAPS, ...(settings.layerCaps ?? {}) };
  // User-tunable estimate/scan knobs (Settings → Generation). `est` is the
  // estimator for everything below so budgets and inspector numbers agree.
  const chars = Number(settings.tokenChars) > 0 ? Number(settings.tokenChars) : TOKEN_CHARS;
  const est = (t) => estimateTokens(t, chars);
  const loreOpts = {
    searchDepth: Number(settings.loreSearchDepth) > 0 ? Number(settings.loreSearchDepth) : DEFAULT_SEARCH_DEPTH,
    linkBoost: settings.loreLinkBoost ?? LINK_BOOST,
    chars,
  };

  // 1. static layer: platform prompt + scenario instructions + backstory +
  //    persona block + per-chat custom instructions + length directive
  // sub = {{user}} then {{var:name}} substitution (per-chat story variables).
  const sub = (t) => subVars(subUser(t, personaName), chat?.vars);
  // Merged once here — the lore layer below reuses this same list.
  const lorePieces = mergedLorePieces(scenario, chat, characters);
  // Registered speakers, spelled out in the prompt: weak models shorten long
  // names ("The Auctioneer" → "Auctioneer:") and the display split is an
  // exact name match, so the full names are listed explicitly. Mirrors
  // characterNamesOf (display side).
  const speakerNames = [...new Set(lorePieces
    .filter(p => p?.type === 'character' && p.enabled !== false)
    .map(p => (p.title ?? '').trim()).filter(Boolean))];
  const leadParts = [];
  const plat = sub(platformPrompt).trim();
  if (plat) leadParts.push(plat);
  const scenInstr = sub(scenario?.scenarioInstructions ?? '').trim();
  if (scenInstr) leadParts.push(scenInstr);
  const tailParts = [];
  if (persona?.description?.trim())
    tailParts.push(`${personaName} is ${sub(persona.description).trim()}`);
  const customInstr = sub(chat?.customInstructions ?? '').trim();
  if (customInstr) tailParts.push(customInstr);
  // Author's note: per-chat sticky steering, editable in chat settings.
  const authorsNote = sub(chat?.authorsNote ?? '').trim();
  if (authorsNote) tailParts.push(`Author's note: ${authorsNote}`);
  // Length directive: user-editable in settings; falls back to the preset's
  // default text when unset (existing installs keep current behavior).
  const directive = (settings.lengthDirective ?? LENGTH_PRESETS[settings.responseLength ?? 'medium']?.directive)?.trim();
  if (directive) tailParts.push(directive);
  // /pov reframe: one generation written from another character's perspective.
  const povName = String(pov?.name ?? '').trim();
  if (speakerNames.length)
    tailParts.push(`Characters who may speak in this scene: ${speakerNames.join(', ')}. When one speaks or acts, begin that part with the exact full name and a colon ("${speakerNames[0]}:") — once, at the start of the part; later lines stay with that character.`);
  if (povName)
    tailParts.push(`Write the next reply from ${povName}'s perspective — ${povName}'s actions, words, and thoughts. Begin the reply with "${povName}:".`);
  let backstory = sub(scenario?.backstory ?? '').trim();

  const staticCap = Math.floor(budget * caps.static);
  const buildStatic = (bs) => [...leadParts, ...(bs ? [bs] : []), ...tailParts].join('\n\n');
  let staticText = buildStatic(backstory);
  if (backstory && est(staticText) > staticCap) {
    const allowedChars = Math.max(0, Math.floor((staticCap - est(buildStatic(''))) * chars));
    backstory = backstory.slice(0, allowedChars);
    staticText = buildStatic(backstory);
    manifest.warnings.push('Backstory truncated to fit the static-layer budget.');
  }
  const staticTokens = est(staticText);
  if (staticTokens > staticCap)
    manifest.warnings.push('Static layer exceeds its budget cap (platform prompt, instructions, persona, or author\'s note too long).');
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
  const greetingTokens = greetingNode ? est(sub(activeText(greetingNode))) : 0;
  manifest.layers.greeting = { tokens: greetingTokens };
  const conversationText = path.map(activeText).join('\n');

  // 3. lore layer (scenario pieces + linked global characters + per-chat
  //    overlay, chat wins on id) — list merged above the static layer.
  const loreCap = Math.floor(budget * caps.lore);
  const chatPieceIds = new Set(
    (Array.isArray(chat?.lorePieces) ? chat.lorePieces : []).map(p => p?.id).filter(Boolean));
  // Resolved global characters carry origin: 'character' from resolveCharacters
  // (via mergedLorePieces). selectLore strips extra piece fields, so origin is
  // recovered by id, not from the selected candidate. A chat overlay piece
  // shadowing a global character replaces it in the merge and thus reports
  // 'chat'.
  const charPieceIds = new Set(
    lorePieces.filter(p => p?.origin === 'character' && !chatPieceIds.has(p.id)).map(p => p.id));
  const originOf = (p) => chatPieceIds.has(p.id) ? 'chat' : (charPieceIds.has(p.id) ? 'character' : 'scenario');
  // /pov forces the named character's piece in (reason 'pov') alongside any
  // semantic pre-activations.
  let preAct = preActivated;
  if (pov?.pieceId) {
    preAct = new Map();
    if (preActivated instanceof Map) for (const [id, r] of preActivated) preAct.set(id, r);
    else if (preActivated) for (const id of preActivated) preAct.set(id, 'semantic');
    preAct.set(pov.pieceId, 'pov');
  }
  // Scan once: the same result drives both budget selection and the
  // inactive-list reasons below.
  const loreScanned = scanLore(lorePieces, conversationText, preAct, loreOpts);
  const loreSel = selectLore(lorePieces, conversationText, loreCap, preAct, { ...loreOpts, scanned: loreScanned });
  const loreText = loreSel.map(s => `[${s.title}]\n${sub(s.content)}`).join('\n\n');
  // Count the full block as sent (incl. the literal [World Info] header) so the
  // layer estimate matches the exact /tokenize count and the history headroom.
  const loreTokens = loreText ? est(`[World Info]\n${loreText}`) : 0;
  // Enabled pieces that were NOT injected — observability for "did it even scan?"
  const selectedIds = new Set(loreSel.map(s => s.id));
  const inactive = [];
  for (const p of lorePieces) {
    if (!p || p.enabled === false || selectedIds.has(p.id)) continue;
    inactive.push({
      id: p.id, title: p.title ?? '',
      reason: loreScanned.has(p.id) ? 'over-budget' : 'not-triggered',
      origin: originOf(p),
      tokens: est(`[${p.title ?? ''}]\n${p.content ?? ''}`),
      preview: toPreview(p.content), content: p.content ?? '',
    });
  }
  const overBudget = inactive.filter(p => p.reason === 'over-budget').length;
  if (overBudget > 0)
    manifest.warnings.push(`${overBudget} lore piece(s) activated but didn't fit the lore budget.`);
  manifest.layers.lore = {
    tokens: loreTokens, cap: loreCap,
    pieces: loreSel.map(s => ({ id: s.id, title: s.title, type: s.type, reason: s.reason, boost: s.boost, weight: s.effWeight, origin: originOf(s), tokens: s.tokens, preview: toPreview(s.content), content: s.content })),
    inactive,
  };

  // 4. memory layer: pinned first (oldest→newest), then recent unpinned.
  //    That ordering is only the budget-fill PRIORITY; the selected memories
  //    are rendered chronologically (createdAt asc) so the model reads the
  //    memory block forwards in time. Per-memory cost counts the `- ` prefix
  //    exactly as rendered.
  const memCap = Math.floor(budget * caps.memory);
  const memAll = Array.isArray(chat?.memoryStore?.memories) ? chat.memoryStore.memories : [];
  const memOrdered = [
    ...memAll.filter(m => m.pinned).sort((a, b) => a.createdAt - b.createdAt),
    ...memAll.filter(m => !m.pinned).sort((a, b) => b.createdAt - a.createdAt),
  ];
  const memSel = [];
  let memUsed = 0;
  for (const m of memOrdered) {
    const cost = est(`- ${m.text}`);
    if (memUsed + cost > memCap) continue;
    memSel.push(m);
    memUsed += cost;
  }
  const memRender = [...memSel].sort((a, b) => a.createdAt - b.createdAt);
  const memText = memRender.length ? `[Memories]\n${memRender.map(m => `- ${m.text}`).join('\n')}` : '';
  const memTokens = memText ? est(memText) : 0;
  manifest.layers.memory = {
    tokens: memTokens, cap: memCap,
    memories: memRender.map(m => ({ id: m.id, pinned: !!m.pinned, tokens: est(`- ${m.text}`), preview: toPreview(m.text), text: m.text ?? '' })),
  };

  // 5. history fills the remainder; oldest messages dropped first.
  //    Estimates run on the macro-SUBSTITUTED text — that's what gets sent.
  const historyCap = Math.max(0, budget - staticTokens - loreTokens - memTokens - greetingTokens);
  const kept = [];
  let histUsed = 0;
  for (let i = historyNodes.length - 1; i >= 0; i--) {
    const cost = est(sub(activeText(historyNodes[i])));
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
  if (greetingNode) messages.push({ role: 'assistant', content: sub(activeText(greetingNode)) });
  for (const n of kept)
    messages.push({ role: n.role === 'assistant' ? 'assistant' : 'user', content: sub(activeText(n)) });

  manifest.totalTokens = messages.reduce((t, m) => t + est(m.content), 0);
  return { messages, manifest };
}

// ---- tool calls -------------------------------------------------------------
// Prompt-based protocol: the platform prompt teaches the model to emit
//   ```tool
//   {"name": "…", "args": {…}}
//   ```
// blocks mid-reply. Works on any OpenAI-compatible endpoint — no tools param,
// no extra round-trip, middleware-transparent. Blocks are stripped from
// display text and executed app-side against the per-chat lore overlay.
// An unterminated fence is never a call (partial stream or model
// rambling) — it's hidden from display but executes nothing.
const TOOL_CALL_CAP = 5;   // per generation; excess calls = manifest warning
const TOOL_NAME_MAX = 60;
const TOOL_TEXT_MAX = 2000;

const TOOL_BLOCK_RE = /```tool[ \t]*\r?\n?([\s\S]*?)```/g;

// Split finished reply text into display text + parsed calls. Malformed JSON
// inside a well-formed fence = call with error: still stripped from display
// and reported, but not executed.
function parseToolCalls(text) {
  const s = String(text ?? '');
  const calls = [];
  TOOL_BLOCK_RE.lastIndex = 0;
  let m;
  while ((m = TOOL_BLOCK_RE.exec(s))) {
    const raw = m[1].trim();
    try {
      const call = JSON.parse(raw);
      // Canonical field is `tool` ({"tool": "register_character", …}) — the
      // old `name` collided with args.name (the character's name) and small
      // models put the character there. `name` accepted as a fallback.
      calls.push({
        name: String(call?.tool ?? call?.name ?? ''),
        args: (call?.args && typeof call.args === 'object') ? call.args : {},
        error: null, raw,
      });
    } catch {
      calls.push({ name: '', args: {}, error: 'malformed JSON', raw: toPreview(raw, 120) });
    }
  }
  // A trailing unterminated ```tool fence on a FINISHED reply is a truncated
  // protocol emission, not prose — stripToolBlocksMapped drops it from
  // display too (matches the streaming view, so text doesn't pop back in).
  return { text: stripToolBlocksMapped(s).text, calls };
}

// Strip tool blocks exactly like parseToolCalls' display text (complete
// blocks removed, trailing unterminated fence cut, \n{3,} collapsed, trimmed)
// while keeping a char map: map[strippedIndex] = rawIndex. Lets the raw
// logprob tape — which covers the protocol text too — be projected onto the
// stripped message, so token probs work on tool replies.
function stripToolBlocksMapped(text) {
  const s = String(text ?? '');
  const removed = [];
  TOOL_BLOCK_RE.lastIndex = 0;
  let m;
  while ((m = TOOL_BLOCK_RE.exec(s))) removed.push([m.index, m.index + m[0].length]);
  // Trailing unterminated fence: a ```tool occurrence at/after the END of the
  // last complete block. Scanning the whole string over-matches — a literal
  // ```tool inside a complete block's JSON string is content, not a fence, and
  // must never truncate the display text that follows the block.
  const scanFrom = removed.length ? removed[removed.length - 1][1] : 0;
  let cut = s.length;
  const p = s.lastIndexOf('```tool');
  if (p >= scanFrom) cut = p;
  const map = []; // keptIdx -> rawIdx
  let pos = 0;
  const take = (a, b) => { for (let i = a; i < b; i++) map.push(i); };
  for (const [a, b] of removed) {
    if (a >= cut) break;
    take(pos, Math.min(a, cut));
    pos = Math.max(pos, b);
  }
  take(pos, cut);
  const kept = map.map(i => s[i]).join('');
  // Collapse \n{3,} → \n\n, tracking indices.
  const out = []; // indices into kept
  for (let i = 0; i < kept.length;) {
    if (kept[i] === '\n') {
      let j = i;
      while (j < kept.length && kept[j] === '\n') j++;
      for (let k = 0; k < Math.min(j - i, 2); k++) out.push(i + k);
      i = j;
    } else { out.push(i); i++; }
  }
  // trim
  let a = 0, b = out.length;
  while (a < b && /\s/.test(kept[out[a]])) a++;
  while (b > a && /\s/.test(kept[out[b - 1]])) b--;
  const idx = out.slice(a, b);
  return { text: idx.map(k => kept[k]).join(''), map: idx.map(k => map[k]) };
}

// Streaming view: hide complete blocks AND any trailing unterminated ```tool
// fence, so protocol text is never shown mid-generation. No trimming — the
// streaming bubble wants the raw spacing of what remains.
function stripToolBlocks(text) {
  const s = String(text ?? '');
  let out = '', last = 0;
  TOOL_BLOCK_RE.lastIndex = 0;
  let m;
  while ((m = TOOL_BLOCK_RE.exec(s))) { out += s.slice(last, m.index); last = m.index + m[0].length; }
  out += s.slice(last);
  const open = out.lastIndexOf('```tool');
  if (open !== -1) out = out.slice(0, open);
  return out;
}

// Execute parsed calls against the chat's lore overlay. Returns
// { chat, results: [{ name, args, ok, note }] }; same chat object when
// nothing applied. Unknown tools / validation failures are notes, not throws.
// New pieces are tagged { createdAt: now, createdBy: nodeId } (plus atLen when
// the caller supplies it) — provenance for rewind rollback and regenerate
// pruning (pruneToolPieces). Updates keep the original piece's provenance.
// opts.queueLore: add_lore calls for NEW titles go to the review queue
// (emergent-lore 'queue' mode) instead of straight into lorePieces.
// allPieces (optional): the full merged piece list (scenario + global
// characters + chat overlay) — used ONLY for register_character dedupe, so a
// name that exists outside the chat overlay is shadowed via the overlay
// instead of duplicated. Omit it and dedupe stays overlay-local (old shape).
function applyToolCalls(chat, calls, { cap = TOOL_CALL_CAP, ...opts } = {}, allPieces = null) {
  let work = chat;
  const results = [];
  let applied = 0;
  for (const c of calls ?? []) {
    if (c.error) { results.push({ name: '(unparsed)', args: {}, ok: false, note: `${c.error}: ${c.raw ?? ''}` }); continue; }
    if (applied >= cap) { results.push({ name: c.name, args: c.args, ok: false, note: 'call cap reached' }); continue; }
    const r = applyToolCall(work, c, { ...opts, allPieces });
    results.push({ name: c.name, args: c.args, ok: r.ok, note: r.note });
    if (r.ok) { work = r.chat; applied++; }
  }
  return { chat: work, results };
}

// Remove tool-written pieces created by a given node (its earlier swipes).
// SAFE only when that node has no children — the caller checks. No-op (same
// object) when nothing matches.
function pruneToolPieces(chat, nodeId) {
  const pieces = chat?.lorePieces;
  if (!Array.isArray(pieces) || !pieces.some(p => p?.createdBy === nodeId)) return chat;
  return { ...chat, lorePieces: pieces.filter(p => p?.createdBy !== nodeId) };
}

// ---- emergent lore review queue ---------------------------------------------
// Proposals (add_lore tool calls under a 'queue'-mode scenario, or the
// extraction pipeline) wait in chat.loreQueue for user review. Accept moves a
// proposal into lorePieces as USER-OWNED — provenance stripped, so prune and
// rewind no longer auto-remove it.
function queueLorePiece(chat, entry) {
  const loreQueue = [...(Array.isArray(chat?.loreQueue) ? chat.loreQueue : []),
    { id: uid(), type: 'lore', title: '', content: '', keys: [], source: 'tool', createdAt: Date.now(), ...entry }];
  return { ...chat, loreQueue };
}

function acceptQueuedLore(chat, queueId) {
  const q = (chat?.loreQueue ?? []).find(e => e.id === queueId);
  if (!q) return chat;
  const piece = {
    pinned: false, weight: 0, links: [], enabled: true, searchDepth: null,
    wholeWord: false, caseSensitive: false, smart: false,
    id: q.id, type: q.type ?? 'lore', title: q.title ?? '', content: q.content ?? '', keys: q.keys ?? [],
  };
  return { ...chat,
    loreQueue: chat.loreQueue.filter(e => e.id !== queueId),
    lorePieces: [...(Array.isArray(chat.lorePieces) ? chat.lorePieces : []), piece] };
}

function dismissQueuedLore(chat, queueId) {
  if (!Array.isArray(chat?.loreQueue)) return chat;
  return { ...chat, loreQueue: chat.loreQueue.filter(e => e.id !== queueId) };
}

function applyToolCall(chat, call, { nodeId = null, now = Date.now(), queueLore = false, allPieces = null, atLen = null } = {}) {
  const fail = (note) => ({ ok: false, note, chat });
  const args = call?.args ?? {};
  const pieces = Array.isArray(chat?.lorePieces) ? chat.lorePieces : [];
  const base = {
    pinned: false, weight: 0, links: [], enabled: true, searchDepth: null,
    wholeWord: false, caseSensitive: false, smart: false,
  };
  const save = (lorePieces, note) => ({ ok: true, note, chat: { ...chat, lorePieces } });
  const provenance = { createdAt: now, ...(Number.isFinite(atLen) ? { atLen } : {}), createdBy: nodeId };
  if (call.name === 'register_character') {
    const cname = String(args.name ?? '').trim().slice(0, TOOL_NAME_MAX);
    const desc = String(args.description ?? args.content ?? '').trim().slice(0, TOOL_TEXT_MAX);
    if (!cname) return fail('register_character: name required');
    if (!desc) return fail('register_character: description required');
    // Dedupe by title across EVERYTHING the caller can see (allPieces =
    // scenario + global + chat overlay); without it only the overlay is
    // checked and a same-named scenario character would be duplicated.
    const haystack = Array.isArray(allPieces) ? allPieces : pieces;
    const existing = haystack.find(p => p.type === 'character'
      && (p.title ?? '').trim().toLowerCase() === cname.toLowerCase());
    if (existing && pieces.some(p => p.id === existing.id))
      return save(pieces.map(p => p.id === existing.id ? { ...p, content: desc } : p),
        `updated character "${cname}"`);
    if (existing)
      // Match lives outside the chat overlay (scenario/global): shadow it via
      // the overlay instead of duplicating the name (characterNamesOf would
      // report it twice). Fresh provenance → rewind drops the shadow again.
      return save([...pieces, { ...existing, ...provenance, content: desc }],
        `updated character "${cname}"`);
    return save([...pieces, { ...base, ...provenance, id: uid(), type: 'character', title: cname, content: desc, keys: [cname] }],
      `registered character "${cname}"`);
  }
  if (call.name === 'add_lore') {
    const title = String(args.title ?? '').trim().slice(0, TOOL_NAME_MAX);
    const content = String(args.content ?? '').trim().slice(0, TOOL_TEXT_MAX);
    if (!title) return fail('add_lore: title required');
    if (!content) return fail('add_lore: content required');
    const keys = (Array.isArray(args.keys) ? args.keys : [])
      .map(k => String(k).trim()).filter(k => k.length >= MIN_KEY_LENGTH).slice(0, 5);
    // Dedupe by title across EVERYTHING the caller can see (same rationale as
    // register_character above) — a same-titled scenario/global piece would
    // otherwise be duplicated in the merged view and injected twice.
    const haystack = Array.isArray(allPieces) ? allPieces : pieces;
    const existing = haystack.find(p => (p.type ?? 'lore') === 'lore'
      && (p.title ?? '').trim().toLowerCase() === title.toLowerCase());
    if (existing && pieces.some(p => p.id === existing.id))
      return save(pieces.map(p => p.id === existing.id ? { ...p, content, ...(keys.length ? { keys } : {}) } : p),
        `updated lore "${title}"`);
    if (existing)
      // Match lives outside the chat overlay: shadow it via an overlay copy
      // (fresh provenance → rewind drops the shadow again).
      return save([...pieces, { ...existing, ...provenance, content, ...(keys.length ? { keys } : {}) }],
        `updated lore "${title}"`);
    // Emergent-lore 'queue' mode: new titles wait for user review.
    if (queueLore)
      return { ok: true, note: `queued lore "${title}" for review`,
        chat: queueLorePiece(chat, { title, content, keys, source: 'tool', createdAt: now,
          ...(Number.isFinite(atLen) ? { atLen } : {}) }) };
    return save([...pieces, { ...base, ...provenance, id: uid(), type: 'lore', title, content, keys }],
      `added lore "${title}"`);
  }
  return fail(`unknown tool "${call.name}"`);
}

// Default platform-prompt addition teaching the protocol. Appended when tool
// calling is enabled (settings.toolsEnabled !== false); the text itself is
// user-editable in Settings (settings.toolsPrompt, this is the default).
// {{user}} inside is substituted at assembly time like the rest of the
// platform prompt. NOTE: the canonical JSON field is `tool`, not `name` —
// `name` collided with args.name and models put the character's name there.
const TOOLS_PROMPT = `You can grow the story's cast and world by emitting tool blocks in your reply, in this exact format:
\`\`\`tool
{"tool": "register_character", "args": {"name": "Vex", "description": "A wiry dock informant with a copper eye. Nervous, greedy, loyal to whoever pays."}}
\`\`\`
Available tools:
- register_character(name, description) — a NEW named character enters the story who may recur. description: appearance, personality, motives in a few sentences.
- add_lore(title, content, keys?) — record a lasting fact about the world, a place, or an object. keys: up to 5 optional trigger words.
Rules: the JSON field for the tool is "tool", never "name"; emit a block at the moment the character or thing enters the narrative, then continue the story; never register {{user}}; a character you speak for with a Name: prefix must be known to the app — register a newcomer BEFORE their first prefixed line, in the same reply; at most one tool block per reply unless several newcomers appear at once; never mention tool blocks in the prose.`;

// ---- multi-speaker segments -------------------------------------------------
// One turn stays ONE swipe in the tree; a reply containing several
// `Name:`-prefixed parts is split for DISPLAY into per-speaker bubbles.
// Split points are line starts like `Name:` / `**Name:**` / `*Name*:` where
// Name is a known character (case-insensitive) — or the literal `Narrator:`,
// which starts a narration segment (that's how narration RESUMES after a
// character's part; an unprefixed line always continues the current segment).
// Leading text before the first prefix is narration (speaker: null).
// Prefixes are stripped from segment text. Unknown `Name:` lines (not in
// `names`) never split.
function splitSpeakerSegments(text, names) {
  const s = String(text ?? '');
  if (!s || !names?.length) return [{ speaker: null, text: s }];
  const byLower = new Map(names.map(n => [String(n).toLowerCase(), n]));
  // Stars after the colon only close a bold prefix (`**Name:**` — stars
  // followed by whitespace/EOL); an action's opening star (`Mira: *nods*`)
  // must survive or the emphasis is left unpaired.
  const re = /^\s*\*{0,2}\s*([\p{L}][\p{L}\p{M}\p{N}'. \-]{0,39}?)\s*\*{0,2}\s*:(?:[ \t]*\*{1,2}(?=\s|$))?\s*/u;
  const segments = [];
  let cur = { speaker: null, text: '' };
  const push = () => { if (cur.text.trim()) segments.push({ speaker: cur.speaker, text: cur.text.trim() }); };
  for (const line of s.split('\n')) {
    const m = re.exec(line);
    const key = m?.[1].trim().toLowerCase();
    const name = m && key !== 'narrator' ? byLower.get(key) : null;
    if (name || key === 'narrator') {
      push();
      cur = { speaker: name ?? null, text: line.slice(m[0].length) };
    } else {
      cur.text += (cur.text ? '\n' : '') + line;
    }
  }
  push();
  return segments.length ? segments : [{ speaker: null, text: s }];
}

// Default platform-prompt addition permitting multi-speaker replies.
// Appended when settings.multiSpeaker !== false; user-editable
// (settings.speakerPrompt, this is the default).
const SPEAKER_PROMPT = `When several named characters share the scene, you may reply for more than one of them in a single turn: start each character's part with their FULL registered name and a colon on its own line ("The Auctioneer: …" — shortenings like "Auctioneer:" are not recognized), in the order they speak or act, at most one part per character. One prefix starts the whole part — never repeat it for the same character; the following lines belong to that character until another name or "Narrator:" appears. Narration needs no prefix at the start of the reply; after a character's part, resume it with "Narrator:" on its own line — but only for genuine scene-level narration that belongs to no character. In a scene with only one character, write everything in that character's own voice, action and description included; do not use "Narrator:" at all. Use a prefix only for a character the app already knows — from the scenario lore or an earlier registration; a prefix for an unknown name is not recognized and is shown to the reader as plain text.`;

// Prose formatting conventions — single source of truth, woven into the
// platform prompt (src/83-settings.js) and both generator prompts below, so
// the RP reply format and generated greetings/lore can't drift apart.
const PROSE_FORMAT_RULES = 'Prose format: wrap spoken dialogue in double quotation marks ("like this") and actions or non-verbal beats in single asterisks (*like this*). When a specific character speaks or acts, begin that part with the character\'s FULL name exactly as registered, followed by a colon ("The Auctioneer:" — never a shortening like "Auctioneer:"; a partial name is not recognized and shows to the reader as plain text). One prefix starts the whole part — never repeat it for the same character; the following lines belong to that character until another name or "Narrator:" appears. The app labels the message with the prefix and hides it from the reader; resume scene-level narration with "Narrator:". Narration without a speaker needs no prefix.';

// Default aux-task prompts (user-editable in Settings → Prompts). {{user}} is
// substituted with the persona name at call time; the suggestions prompt also
// takes {{count}} and {{words}}.
const DEFAULT_SUGGESTIONS_PROMPT = 'You suggest what the user\'s character ({{user}}) might say or do next in this roleplay. Reply with exactly {{count}} options as a numbered list, one per line, at most {{words}} words each, written in first person as {{user}}. In-character; do not narrate other characters\' actions; no commentary.';
const DEFAULT_MEMORY_PROMPT = 'You keep memory notes for an ongoing roleplay. Summarize the key recent events, revealed facts, and relationship changes as compact plain prose of at most 500 characters. Past events only; no speculation; no lists; no formatting.';
const DEFAULT_LORE_EXTRACT_PROMPT = 'You maintain the lorebook of an ongoing roleplay. Extract up to 3 NEW lasting facts about the world, places, objects, or factions from the recent conversation — long-term reference material, not momentary events, and never facts already in the existing lore. Reply with a JSON array only: [{"title":"…","content":"…","keys":["…"]}] — or [] if nothing qualifies.';
const DEFAULT_IMPROVE_PROMPT = 'Rewrite the user\'s draft in first person as {{user}}, matching the roleplay\'s tone. Output only the rewritten text.';
const DEFAULT_RECAP_PROMPT = 'Summarize the following roleplay excerpt into a cohesive recap in third person, past tense, at most 400 words. Output only the recap.';
// Generator prompts (✦ Generate in the scenario/character editors) take no
// runtime placeholders — {{user}} stays literal so the generated text keeps
// the macro. The reply contract is one JSON object; parsing is tolerant
// (first { to last } — see extractGenJSON in src/97-generator.js).
const DEFAULT_SCENARIO_GEN_PROMPT = 'You design roleplay scenarios for a chat app. Given the user\'s request (and an optional current draft to extend), reply with a single JSON object only, no commentary: {"name":"…","description":"…","tags":["…"],"scenarioInstructions":"…","backstory":"…","greeting":"…","lorePieces":[{"type":"lore|character","title":"…","content":"…","keys":["…"],"pinned":false}]}. name, description and tags are metadata never sent to the AI — description is a one-line teaser. scenarioInstructions steer the AI\'s style and behavior; backstory is the world setup the AI always sees. The greeting is the first assistant message of every new chat — write it in scene as narrative prose in the app\'s format. Each lore piece covers ONE entity (a character, location, faction or item): content is compact reference prose, keys are trigger words that inject the piece when mentioned — every character piece needs its name as a key. Every character who speaks or acts in the greeting needs a character lore piece — the app attributes Name: speech only to characters in the lore. At most 5 character pieces. {{user}} in any field is a literal macro for the user\'s character — keep it as-is. Omit lorePieces if none are needed; always return the complete object. ' + PROSE_FORMAT_RULES;
const DEFAULT_CHARACTER_GEN_PROMPT = 'You design character cards for a roleplay chat app. Given the user\'s request (and an optional current draft to extend), reply with a single JSON object only, no commentary: {"name":"…","content":"…","keys":["…"],"greeting":"…","color":"#rrggbb"}. content is the card sent to the AI when the character is active — compact reference prose covering appearance, personality and motives. keys are trigger words that activate the card when mentioned; include the character\'s name. The greeting is the first assistant message of a chat with this character — write it in scene from that character, in the app\'s prose format. color is optional: a hex colour suiting the character, used for their name in the chat UI — omit it when nothing fits. {{user}} in any field is a literal macro for the user\'s character — keep it as-is. ' + PROSE_FORMAT_RULES;
// === PURE CORE END ===

