// ============================================================================
// PURE CORE — no DOM, no React, no imports. Everything between the markers is
// extracted and unit-tested standalone by tests/assembler.test.mjs.
// === PURE CORE START ===
const TOKEN_CHARS = 3.3; // char-estimate fallback: ~3.3 chars per token
const DEFAULT_SEARCH_DEPTH = 2048; // estimated tokens scanned for lore keys
const LINK_BOOST = 2; // effective-weight bonus from one active linking piece
const MEMORY_CAP = 100;
const MEMORY_EVERY = 30; // messages on active path between auto-summaries
const MEM_RECENT_KEEP = 3; // newest unpinned memories always injected in smart-recall mode
const LAYER_CAPS = { static: 0.30, lore: 0.20, memory: 0.10 }; // history = rest
// Length presets are prose guidance ONLY — they never cap tokens. The
// directive joins the prompt tail; the response reserve is a separate knob.
const LENGTH_PRESETS = {
  short:  { directive: 'Keep your response concise: one or two short paragraphs.' },
  medium: { directive: 'Write a response of moderate length: a few paragraphs.' },
  long:   { directive: 'Write a long, detailed response with rich description.' },
};
const DEFAULT_CONTEXT_LENGTH = 8192;
const DEFAULT_MAX_TOKENS = 1024; // fallback response reserve
// Auto limits (resolveLimits): the detected model context drives both knobs
// unless the user pinned them (ctxAuto / reserveAuto false). Detection comes
// from /v1/models vendor fields (vLLM max_model_len, llama.cpp n_ctx,
// OpenRouter context_length) stored in settings.modelCtxs on Fetch, and is
// used VERBATIM — the server operator's context choice is the user's choice.
// Reserve heuristic: 1/16 of the context, no clamp (256k → 16k).
const autoReserve = (ctx) => Math.max(1, Math.round((Number(ctx) || 0) / 16));
function resolveLimits(settings = {}, model = null) {
  const detected = Number(settings.modelCtxs?.[model ?? settings.model]) || 0;
  const contextLength = settings.ctxAuto === false
    ? (Number(settings.contextLength) || DEFAULT_CONTEXT_LENGTH)
    : (detected > 0 ? detected : DEFAULT_CONTEXT_LENGTH);
  const maxTokens = settings.reserveAuto === false
    ? (Number(settings.maxTokens) || DEFAULT_MAX_TOKENS)
    : autoReserve(contextLength);
  return { contextLength, maxTokens };
}

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
  const parent = chat.messages[parentId];
  // fromSwipe: which swipe of the parent this child continues from — the link
  // that makes swiping a mid-chain node swap the branch below it.
  const node = { id, parentId, role, swipes: [{ text, createdAt: Date.now(), modelId }], activeSwipe: 0, edited: false,
    ...(parent ? { fromSwipe: parent.activeSwipe } : {}) };
  const messages = { ...chat.messages, [id]: node };
  // Record which swipe of the parent the conversation continues from.
  if (parent) messages[parentId] = { ...parent, usedSwipe: parent.activeSwipe };
  return { chat: { ...chat, messages, activeLeafId: id }, id };
}

// Branch links for chats saved before in-chat branching: a child with no
// fromSwipe continues the swipe the conversation was recorded as continuing
// from (parent.usedSwipe, else the parent's current view). Clamped to the
// parent's swipe count. No-op (same object) when nothing needs stamping.
function normalizeBranchSwipes(chat) {
  if (!chat?.messages) return chat;
  let changed = false;
  const messages = { ...chat.messages };
  for (const [id, n] of Object.entries(messages)) {
    if (!n?.parentId || Number.isInteger(n.fromSwipe)) continue;
    const p = messages[n.parentId];
    if (!p) continue;
    const idx = Number.isInteger(p.usedSwipe) ? p.usedSwipe : (p.activeSwipe ?? 0);
    messages[id] = { ...n, fromSwipe: Math.min(Math.max(idx, 0), (p.swipes?.length ?? 1) - 1) };
    changed = true;
  }
  return changed ? { ...chat, messages } : chat;
}

// Children of a node, oldest first (first-swipe createdAt, then id).
function childrenOf(messages, nodeId) {
  const out = [];
  for (const n of Object.values(messages ?? {}))
    if (n?.parentId === nodeId) out.push(n);
  out.sort((a, b) => ((a.swipes?.[0]?.createdAt ?? 0) - (b.swipes?.[0]?.createdAt ?? 0))
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

// Switch the visible branch so the active path runs THROUGH nodeId, then
// descend to the branch tip. Two phases:
//   1. Align ancestors — each node on the root→nodeId path is set to show the
//      swipe its path-child continues from (child.fromSwipe), so a rendered
//      path is always one consistent conversation.
//   2. Descend from nodeId — follow children matching the node's activeSwipe.
//      keepPath (swipe cycling) prefers the child already on the current path
//      when it still matches, so browsing disrupts the tail as little as
//      possible; otherwise the newest child wins. A node whose viewed swipe
//      has no continuation but whose usedSwipe does snaps to usedSwipe —
//      self-heals view state left over from pre-branching chats. The snap
//      never applies to the start node when snapStart is false (explicit
//      swipe browsing: the user asked to view that swipe — truncate instead
//      of snapping back to the continued one).
//      descend:false stops after phase 1 (chat open: align the persisted view
//      without re-descending into a rewound branch).
// Nothing is deleted — hidden branches stay in the tree and re-emerge when
// their swipe is selected again. Identity return when nothing changes.
function activateBranch(chat, nodeId, { keepPath = false, descend = true, snapStart = true } = {}) {
  const msgs = chat?.messages;
  if (!msgs?.[nodeId]) return chat;
  let messages = msgs;
  const setSwipe = (id, idx) => {
    const n = messages[id];
    if (!n || !Number.isInteger(idx) || idx < 0 || idx >= (n.swipes?.length ?? 0) || n.activeSwipe === idx) return;
    if (messages === msgs) messages = { ...msgs };
    messages[id] = { ...n, activeSwipe: idx };
  };
  const matches = (parent, child) => (child.fromSwipe ?? parent.usedSwipe ?? 0) === parent.activeSwipe;
  const path = getActivePath(msgs, nodeId);
  for (let i = 0; i < path.length - 1; i++) {
    const desired = path[i + 1].fromSwipe ?? path[i].usedSwipe;
    if (Number.isInteger(desired)) setSwipe(path[i].id, desired);
  }
  const curPath = keepPath ? new Set(getActivePath(msgs, chat.activeLeafId).map(n => n.id)) : null;
  let tip = descend ? nodeId : chat.activeLeafId;
  let atStart = true;
  for (let guard = descend ? Object.keys(msgs).length + 1 : 0; guard > 0; guard--) {
    const node = messages[tip];
    if (!node) break;
    let kids = childrenOf(messages, tip).filter(k => matches(node, k));
    if (!kids.length && (snapStart || !atStart)
        && Number.isInteger(node.usedSwipe) && node.usedSwipe !== node.activeSwipe) {
      const snapped = { ...node, activeSwipe: node.usedSwipe };
      const alt = childrenOf(messages, tip).filter(k => matches(snapped, k));
      if (alt.length) {
        if (messages === msgs) messages = { ...msgs };
        messages[tip] = snapped;
        kids = alt;
      }
    }
    atStart = false;
    if (!kids.length) break;
    const next = (curPath && kids.find(k => curPath.has(k.id))) || kids[kids.length - 1];
    tip = next.id;
  }
  if (messages === msgs && tip === chat.activeLeafId) return chat;
  return { ...chat, messages, activeLeafId: tip };
}

// Ids on the active path — the branch-visibility scope for world state.
const pathIdSet = (messages, leafId) => new Set(getActivePath(messages, leafId).map(n => n.id));

// A narrative-state stamp (createdBy node + optional createdSwipe) is "on
// view" when the node is on the active path AND — for swipe-stamped (v4.10.1+)
// writes — the node is currently VIEWED at that swipe. Legacy stamps without
// createdSwipe scope to the node alone (any swipe). A null createdBy is never
// on view here — callers handle the global case themselves.
const stampOnView = (createdBy, createdSwipe, pathIds, messages) => {
  if (createdBy == null || !pathIds?.has(createdBy)) return false;
  if (!Number.isInteger(createdSwipe)) return true;
  return messages?.[createdBy]?.activeSwipe === createdSwipe;
};

// Branch view of a revision-tracked piece: effective content/keys come from
// the last revision whose origin is global (null createdBy) or on view. The
// stored log is never touched — switching branches/swipes re-derives the
// view. Identity return when the latest revision is visible.
function pieceAtPath(piece, pathIds, messages = null) {
  const revs = piece?.revisions;
  if (!Array.isArray(revs) || revs.length < 2 || !pathIds) return piece;
  let vis = null;
  for (const r of revs)
    if (r?.createdBy == null || stampOnView(r.createdBy, r.createdSwipe, pathIds, messages)) vis = r;
  if (!vis || vis === revs[revs.length - 1]) return piece;
  return { ...piece, content: vis.content, keys: vis.keys ?? [] };
}

// Piece-level branch visibility: a piece belongs on this branch when its own
// origin OR any revision's origin is global/on-view — a tool update written
// on this branch pulls the piece into this branch's view (pieceAtPath then
// picks the content this branch last saw). Replaced swipes keep their world
// state: a piece stamped with another swipe of an on-path node hides until
// that swipe is viewed again — derivation, never deletion.
function pieceVisibleAt(piece, pathIds, messages = null) {
  if (piece?.createdBy == null) return true;
  if (stampOnView(piece.createdBy, piece.createdSwipe, pathIds, messages)) return true;
  return Array.isArray(piece?.revisions)
    && piece.revisions.some(r => stampOnView(r?.createdBy, r?.createdSwipe, pathIds, messages));
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

// A swipe image entry with pending: true is reload debris — the generation
// that would have filled it died with the page. Heal it to a failed entry:
// same fields minus pending, plus error. Identity return when not pending.
const healImageEntry = (e) => {
  if (!e?.pending) return e;
  const out = {};
  for (const k of ['src', 'prompt', 'caption', 'at', 'pos', 'slot']) if (e[k] !== undefined) out[k] = e[k];
  out.error = true;
  return out;
};

// Group a swipe's image entries into placements ("slots") of one or more
// takes (per-image swipes, v4.10): every entry stamped with the same `slot`
// id is a take of ONE image placement; legacy entries without one are
// singletons (keyed `_${arrayIndex}`). First-occurrence order, input never
// mutated. `imgUsed[slot]` picks the shown take — default the last one,
// clamped into range. Returns [{ slot, takes: [entry…], active, activeIdx }].
const groupImageSlots = (images, imgUsed) => {
  const groups = [];
  const bySlot = new Map();
  (images ?? []).forEach((e, i) => {
    const key = e?.slot ?? `_${i}`;
    let g = bySlot.get(key);
    if (!g) { g = { slot: key, takes: [] }; bySlot.set(key, g); groups.push(g); }
    g.takes.push(e);
  });
  for (const g of groups) {
    const w = parseInt(imgUsed?.[g.slot], 10);
    g.activeIdx = Math.min(Math.max(Number.isNaN(w) ? g.takes.length - 1 : w, 0), g.takes.length - 1);
    g.active = g.takes[g.activeIdx];
  }
  return groups;
};

// Remove debris from generations killed by a page reload/close: assistant
// swipes with empty text (the stream never delivered) — but a swipe carrying
// generated images survives even with empty text (image-only message).
// Pending image entries on any swipe heal to error (healImageEntry). A
// non-root node left with no swipes at all was a generation placeholder —
// drop it and re-parent its children. Root is never dropped. No-op (same
// object) when clean. Called on chat open, before applyUsedSwipes.
function pruneInterrupted(chat) {
  if (!chat?.messages) return chat;
  let changed = false;
  const out = {};
  for (const [id, n] of Object.entries(chat.messages)) {
    // Heal image debris first, on ANY node — kept swipes below carry the
    // healed copies, and an image-only node heals without being dropped.
    const rawSwipes = n.swipes ?? [];
    let healed = null;
    rawSwipes.forEach((s, i) => {
      if (!Array.isArray(s?.images)) return;
      const imgs = s.images.map(healImageEntry);
      if (imgs.some((e, j) => e !== s.images[j])) {
        if (!healed) healed = rawSwipes.slice();
        healed[i] = { ...s, images: imgs };
      }
    });
    if (n.role !== 'assistant' || !n.parentId) {
      if (healed) { out[id] = { ...n, swipes: healed }; changed = true; }
      else out[id] = n;
      continue;
    }
    const swipes = healed ?? rawSwipes;
    const kept = [];
    const idxMap = new Map(); // old swipe index → new index
    swipes.forEach((s, i) => {
      if ((s?.text ?? '') === '' && !(Array.isArray(s?.images) && s.images.length)) return;
      idxMap.set(i, kept.length);
      kept.push(s);
    });
    if (kept.length === swipes.length) {
      if (healed) { out[id] = { ...n, swipes: kept }; changed = true; }
      else out[id] = n;
      continue;
    }
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
  // Both walks below carry a seen-set: a parentId cycle (only creatable via a
  // crafted import — chat import validates little) must terminate, not hang
  // the tab. A walk that ends on a node outside `out` re-parents to root.
  for (const [id, n] of Object.entries(out)) {
    let cur = n.parentId;
    const seen = new Set();
    while (cur && !out[cur] && !seen.has(cur)) { seen.add(cur); cur = chat.messages[cur]?.parentId ?? null; }
    if (cur && !out[cur]) cur = null; // the chain closed a cycle
    if (cur !== n.parentId) {
      // Re-parented: fromSwipe indexes the OLD parent's swipes — re-stamp it
      // against the new parent (or drop it when the node becomes a root).
      const p = cur ? out[cur] : null;
      const nn = { ...n, parentId: cur };
      if (p) nn.fromSwipe = Number.isInteger(p.usedSwipe) ? p.usedSwipe : (p.activeSwipe ?? 0);
      else delete nn.fromSwipe;
      out[id] = nn;
    }
  }
  let activeLeafId = chat.activeLeafId;
  const leafSeen = new Set();
  while (activeLeafId && !out[activeLeafId] && !leafSeen.has(activeLeafId)) {
    leafSeen.add(activeLeafId);
    activeLeafId = chat.messages[activeLeafId]?.parentId ?? null;
  }
  if (activeLeafId && !out[activeLeafId]) activeLeafId = null; // cycle
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
// are untouched). Narrative state is NOT deleted: tool lore, memories and
// loreQueue entries stay in the chat — whatever belonged to the rewound-away
// tail hides by branch/swipe derivation in the assembler (pieceVisibleAt,
// memory atMsg scope) and re-emerges if that branch is revisited. Only the
// summary/extraction cadence cursors roll back, so those passes re-fire from
// the rewind point. Rewind-EXEMPT as before: chat.vars and chat.authorsNote.
function rewindChat(chat, nodeId) {
  const node = chat.messages[nodeId];
  if (!node) return chat;
  const pathLen = getActivePath(chat.messages, nodeId).length;
  return { ...chat, activeLeafId: nodeId,
    memoryStore: { ...(chat.memoryStore ?? { memories: [], cursor: 0 }), cursor: pathLen },
    emergentCursor: pathLen };
}

// Fork the chat at nodeId into a NEW self-contained chat. Only the fork
// node's ancestor path comes over — each chat is its own tree, so the old
// chat's sibling branches stay behind (before in-chat branching made the
// tree visible, deep-copying the whole tree was harmless; it isn't anymore).
// World state comes over intact but stays scoped: pieces/memories stamped
// with nodes beyond the fork point have no path to them in the new chat and
// hide by derivation (rewindChat here just re-points the leaf + cursors).
function branchChat(chat, nodeId) {
  const copy = deepClone(chat);
  if (!copy.messages?.[nodeId])
    return { ...copy, id: uid(), name: `${chat.name} (branch)`, createdAt: Date.now() };
  // Keep only the fork node's ancestor chain (walk up, cycle-guarded).
  const keep = new Set();
  let top = nodeId;
  for (let id = nodeId; id && copy.messages[id] && !keep.has(id); id = copy.messages[id].parentId) {
    keep.add(id);
    top = id;
  }
  const messages = {};
  for (const id of keep.keys()) messages[id] = copy.messages[id];
  const pruned = { ...copy, messages,
    ...(messages[copy.rootMessageId] ? {} : { rootMessageId: top }) };
  const trimmed = rewindChat(pruned, nodeId);
  return { ...trimmed, id: uid(), name: `${chat.name} (branch)`, createdAt: Date.now() };
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
// word boundaries so "cat" doesn't match "cathedral"). Keys shorter than
// MIN_KEY_LENGTH never match (single-char triggers fire on everything —
// FictionLab arrived at the same floor).
const MIN_KEY_LENGTH = 2;
// wholeWord boundary is Unicode-aware: \b is ASCII-only even with the u flag,
// so a key starting/ending in a non-ASCII word char ("café", CJK) would never
// match. The leading alternative consumes the preceding char instead of a
// lookbehind — keyMatches only .test()s, so match positions don't matter.
function keyMatches(key, text, { wholeWord = false, caseSensitive = false } = {}) {
  if (!key || !text || String(key).length < MIN_KEY_LENGTH) return false;
  const pattern = wholeWord ? `(?:^|[^\\p{L}\\p{M}\\p{N}_])(?:${key})(?![\\p{L}\\p{M}\\p{N}_])` : key;
  try { return new RegExp(pattern, (caseSensitive ? '' : 'i') + (wholeWord ? 'u' : '')).test(text); } catch { return false; }
}

// ---- timed activation (sticky / cooldown / delay / probability) ----------
// Optional per-piece fields, measured in ACTIVE-PATH MESSAGES:
//   sticky:   stay active this many messages after the key last matched
//   cooldown: after going inactive (post-sticky), can't re-activate for this
//             many messages
//   delay:    can't activate before this path position (1-based)
//   prob:     percent chance a keyword activation fires (default 100)
// Activation state is recomputed from the message path on every scan —
// derived, never stored — so rewind/regenerate/branch can't leave stale
// activation behind (universal rollback rule). A key "matches at position p"
// when it matches any single message inside the piece's scan window ending at
// p: per-message matching (a key spanning a message boundary isn't seen — the
// untimed path scans the joined window text). Pieces with no timed fields
// scan exactly as before, as do text-only scans (no `messages` given).
const timedFieldsOf = (p) => {
  const n = (v) => Math.max(0, Math.round(Number(v) || 0));
  return { sticky: n(p?.sticky), cooldown: n(p?.cooldown), delay: n(p?.delay) };
};
const hasTimedFields = (p) => {
  const t = timedFieldsOf(p);
  return t.sticky > 0 || t.cooldown > 0 || t.delay > 0;
};
// Probability trigger: `prob` is a percent chance (default 100 = always).
// Applies to keyword-path activations only — pinned, semantic, /pov and
// link-boosted activations always fire. One roll per scan; rng injectable.
const probabilityRoll = (piece, rand) => {
  const prob = Number(piece?.prob);
  if (!Number.isFinite(prob) || prob >= 100) return true;
  if (prob <= 0) return false;
  return rand() * 100 < prob;
};
// Simulate a timed piece over the message path. Returns
// { active, matchNow, blocked: 'cooldown'|'delayed'|null } for the final
// position (blocked is set only when the CURRENT position matches but is held
// back — the "why didn't this trigger?" answer).
function timedActivation(piece, messages, depthChars) {
  const { sticky, cooldown, delay } = timedFieldsOf(piece);
  const msgs = (Array.isArray(messages) ? messages : []).map(m => String(m ?? ''));
  const L = msgs.length;
  const ends = new Array(L); // joined-text offset at the end of message i
  let accLen = 0;
  for (let i = 0; i < L; i++) { accLen += msgs[i].length + (i ? 1 : 0); ends[i] = accLen; }
  const opts = { wholeWord: !!piece.wholeWord, caseSensitive: !!piece.caseSensitive };
  const keys = Array.isArray(piece.keys) ? piece.keys : [];
  const hit = msgs.map(t => keys.some(k => keyMatches(k, t, opts)));
  let active = false, lastMatch = 0, lastActive = 0, blocked = null;
  let wStart = 0, inWin = 0; // sliding key-hit count over the char window
  let matchNow = false;
  for (let p = 1; p <= L; p++) {
    if (hit[p - 1]) inWin++;
    const limit = ends[p - 1] - depthChars;
    while (wStart < p - 1 && ends[wStart] <= limit) { if (hit[wStart]) inWin--; wStart++; }
    const match = inWin > 0;
    matchNow = match;
    if (active) {
      if (match) lastMatch = p;
      else if (p - lastMatch > sticky) { active = false; lastActive = p - 1; }
    } else if (match) {
      if (p < delay) blocked = 'delayed';
      else if (lastActive && p - lastActive <= cooldown) blocked = 'cooldown';
      else { active = true; lastMatch = p; blocked = null; }
    }
  }
  return { active, matchNow, blocked: (active || !matchNow) ? null : blocked };
}

// Determine which pieces are active this turn.
// Returns Map(id → { piece, reason: 'pinned'|'triggered'|'sticky'|'semantic'|'pov'|'link-boosted', boost })
// with a `.detail` property attached: Map(id → 'cooldown'|'delayed'|'probability'|'group')
// for pieces a naive scan would call active — Inspector observability for
// suppressed pieces. The plain Map shape is stable for old callers.
// opts: user-tunable lore defaults (Settings → Generation) — per-piece
// searchDepth still wins over the global default. opts.messages: the active
// path's per-message texts (oldest→newest) for timed activation; opts.rng:
// probability-roll source (tests inject determinism, prod uses Math.random).
function scanLore(lorePieces, conversationText, preActivated = null,
                  { searchDepth = DEFAULT_SEARCH_DEPTH, linkBoost = LINK_BOOST, chars = TOKEN_CHARS, messages = null, rng = null } = {}) {
  const pieces = Array.isArray(lorePieces) ? lorePieces : [];
  const active = new Map();
  const detail = new Map();
  const rand = typeof rng === 'function' ? rng : Math.random;
  for (const piece of pieces) {
    if (!piece || piece.enabled === false) continue;
    if (piece.pinned) { active.set(piece.id, { piece, reason: 'pinned', boost: 0 }); continue; }
    if (preActivated?.has(piece.id)) {
      const reason = preActivated instanceof Map ? (preActivated.get(piece.id) ?? 'semantic') : 'semantic';
      active.set(piece.id, { piece, reason, boost: 0 }); continue;
    }
    const depth = Number(piece.searchDepth) > 0 ? Number(piece.searchDepth) : searchDepth;
    // Timed pieces derive from the per-message path (see timedActivation).
    if (Array.isArray(messages) && messages.length && hasTimedFields(piece)) {
      const t = timedActivation(piece, messages, Math.round(depth * chars));
      if (t.active) {
        if (probabilityRoll(piece, rand))
          active.set(piece.id, { piece, reason: t.matchNow ? 'triggered' : 'sticky', boost: 0 });
        else detail.set(piece.id, 'probability');
      } else if (t.blocked) detail.set(piece.id, t.blocked);
      continue;
    }
    const scanText = conversationText.slice(-Math.round(depth * chars));
    const opts = { wholeWord: !!piece.wholeWord, caseSensitive: !!piece.caseSensitive };
    if ((Array.isArray(piece.keys) ? piece.keys : []).some(k => keyMatches(k, scanText, opts))) {
      if (probabilityRoll(piece, rand)) active.set(piece.id, { piece, reason: 'triggered', boost: 0 });
      else detail.set(piece.id, 'probability');
    }
  }
  // Inclusion groups: pieces sharing a non-empty `group` name are mutually
  // exclusive — the highest weight wins (ties: list order), losers are
  // reported as group-suppressed. Pinned pieces bypass groups entirely;
  // link-boosted additions below skip the check (a winner pulled them in).
  const best = new Map(); // group → { id, weight }
  for (const [id, a] of active) {
    const g = String(a.piece.group ?? '').trim();
    if (!g || a.piece.pinned) continue;
    const w = Number(a.piece.weight) || 0;
    const cur = best.get(g);
    if (!cur || w > cur.weight) best.set(g, { id, weight: w });
  }
  const winners = new Set([...best.values()].map(b => b.id));
  for (const [id, a] of active) {
    const g = String(a.piece.group ?? '').trim();
    if (!g || a.piece.pinned || winners.has(id)) continue;
    active.delete(id);
    detail.set(id, 'group');
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
  active.detail = detail;
  return active;
}

// Sort candidates by effective weight desc and fill the lore budget.
// opts.scanned: a precomputed scanLore result (assemblePrompt scans once and
// passes it in) — omitted, selectLore scans itself. Per-piece cost includes
// the `[title]\n` header exactly as rendered into the World Info block.
// opts.sub: macro substitution applied at render time ({{user}}, {{var:}}) —
// budget against the RENDERED text, or macro expansion silently inflates the
// layer past budgetTokens. Defaults to identity.
function selectLore(lorePieces, conversationText, budgetTokens, preActivated = null, opts = {}) {
  const scan = opts.scanned ?? scanLore(lorePieces, conversationText, preActivated, opts);
  const subFn = typeof opts.sub === 'function' ? opts.sub : (t) => t;
  const candidates = [...scan.values()].map(a => ({
    id: a.piece.id,
    title: a.piece.title ?? '',
    content: a.piece.content ?? '',
    type: a.piece.type ?? 'lore',
    reason: a.reason,
    boost: a.boost,
    effWeight: (Number(a.piece.weight) || 0) + a.boost,
    tokens: estimateTokens(`[${a.piece.title ?? ''}]\n${subFn(a.piece.content ?? '')}`, opts.chars),
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
function addMemory(store, text, now = Date.now(), cap = MEMORY_CAP, atLen = null, atMsg = null) {
  // atLen is stamped at creation, before eviction: in an all-pinned full store
  // the incoming entry is the one dropped, and stamping after the fact would
  // mis-tag an unrelated old memory's rewind position. atMsg (active leaf at
  // creation) scopes the memory to its branch in assemblePrompt.
  const memories = [...(store?.memories ?? []), { id: uid(), text, pinned: false, createdAt: now,
    ...(Number.isFinite(atLen) ? { atLen } : {}), ...(atMsg ? { atMsg } : {}) }];
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
// memScores (optional): Map(memoryId → cosine score) from the embeddings
// pass — turns on smart memory recall (similarity-ranked injection) instead
// of plain recency; null keeps the classic pinned-then-recent fill.
function assemblePrompt({ scenario, persona, chat, settings = {}, platformPrompt = '', preActivated = null, pov = null, characters = null, memScores = null }) {
  const personaName = persona?.name?.trim() || 'User';
  const reserve = Number(settings.maxTokens) || DEFAULT_MAX_TOKENS;
  const contextLength = Number(settings.contextLength) || DEFAULT_CONTEXT_LENGTH;
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
  // Branch visibility: model/app-written world state is scoped to where it
  // was written. A chat-overlay piece whose origin (createdBy node +
  // createdSwipe swipe) — and every revision's origin — is not on the ACTIVE
  // view is hidden, as is a memory whose origin leaf (atMsg) is off the
  // active path — derived per assembly, never deleted, so switching
  // branches/swipes re-derives it (unstamped entries are global). A hidden
  // overlay piece also stops shadowing its scenario/global original, which
  // resurfaces on other branches. Dedupe paths (applyToolCalls allPieces)
  // still see everything.
  const pathIds = pathIdSet(chat?.messages ?? {}, chat?.activeLeafId);
  const chatMsgs = chat?.messages ?? null;
  const branchHidden = (Array.isArray(chat?.lorePieces) ? chat.lorePieces : [])
    .filter(p => !pieceVisibleAt(p, pathIds, chatMsgs));
  const chatForLore = branchHidden.length
    ? { ...chat, lorePieces: chat.lorePieces.filter(p => pieceVisibleAt(p, pathIds, chatMsgs)) }
    : chat;
  // Merged once here — the lore layer below reuses this same list. Pieces with
  // a revision log are viewed at the last revision visible on this branch.
  const lorePieces = mergedLorePieces(scenario, chatForLore, characters)
    .map(p => pieceAtPath(p, pathIds, chatMsgs));
  // Registered speakers, spelled out in the prompt: weak models shorten long
  // names ("The Auctioneer" → "Auctioneer:") and the display split is an
  // exact name match, so the full names are listed explicitly. Mirrors
  // characterNamesOf (display side).
  const speakerNames = [...new Set(lorePieces
    .filter(p => p?.type === 'character' && p.enabled !== false)
    .map(p => (p.title ?? '').trim()).filter(Boolean))];
  // Fed-back text of a node, as sent: macro-substituted, and for assistant
  // messages with repeated same-speaker prefixes stripped (weak models learn
  // the repeat habit from their own raw output; the display split hides them
  // too). User text is verbatim. Used for BOTH estimates and message content
  // so the numbers agree with what's sent.
  const histText = (n) => {
    const t = sub(activeText(n));
    let out = n.role === 'assistant' ? dedupeSpeakerPrefixes(t, speakerNames) : t;
    // Generated images attached to the active swipe (resolved exactly like
    // activeText) were shown to the reader — mention them cheaply so the
    // model knows they exist. One marker per SLOT from the active take (a
    // multi-take placement still showed one image). Only entries that
    // actually rendered (truthy src); pending/error entries are invisible to
    // the model.
    const imgSwipe = n?.swipes?.[n.activeSwipe];
    if (Array.isArray(imgSwipe?.images))
      for (const g of groupImageSlots(imgSwipe.images, imgSwipe.imgUsed))
        if (g.active?.src) out += `\n\n[Image shown: ${String(g.active.caption || g.active.prompt || 'image').slice(0, 200)}]`;
    return out;
  };
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
  // /pov reframe: one generation written from another character's perspective,
  // with optional per-reply steering text (`/pov CHAR [TEXT]`).
  const povName = String(pov?.name ?? '').trim();
  const povText = String(pov?.text ?? '').trim();
  if (speakerNames.length)
    tailParts.push(`Characters who may speak in this scene: ${speakerNames.join(', ')}. When one speaks or acts, begin that part with the exact full name and a colon ("${speakerNames[0]}:") — once, at the start of the part; later lines stay with that character.`);
  if (povName)
    tailParts.push(`Write the next reply from ${povName}'s perspective — ${povName}'s actions, words, and thoughts. Begin the reply with "${povName}:".${povText ? ` Direction for this reply: ${povText}` : ''}`);
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
  const greetingTokens = greetingNode ? est(histText(greetingNode)) : 0;
  manifest.layers.greeting = { tokens: greetingTokens };
  const conversationText = path.map(activeText).join('\n');
  // Timed activation (sticky/cooldown/delay) derives from the per-message path.
  loreOpts.messages = path.map(activeText);

  // 3. lore layer (scenario pieces + linked global characters + per-chat
  //    overlay, chat wins on id) — list merged above the static layer.
  const loreCap = Math.floor(budget * caps.lore);
  const chatPieceIds = new Set(
    (Array.isArray(chatForLore?.lorePieces) ? chatForLore.lorePieces : []).map(p => p?.id).filter(Boolean));
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
  const loreSel = selectLore(lorePieces, conversationText, loreCap, preAct, { ...loreOpts, scanned: loreScanned, sub });
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
      // Timed/probability/group suppressions outrank the generic reasons —
      // they answer "it matched, why isn't it in?".
      reason: loreScanned.detail?.get(p.id) ?? (loreScanned.has(p.id) ? 'over-budget' : 'not-triggered'),
      origin: originOf(p),
      tokens: est(`[${p.title ?? ''}]\n${sub(p.content ?? '')}`),
      preview: toPreview(p.content), content: p.content ?? '',
    });
  }
  const overBudget = inactive.filter(p => p.reason === 'over-budget').length;
  if (overBudget > 0)
    manifest.warnings.push(`${overBudget} lore piece(s) activated but didn't fit the lore budget.`);
  // Branch-hidden overlay pieces surface in the Inspector's Not-injected list
  // with their own reason — they're not disabled or unmatched, they belong to
  // a sibling branch.
  for (const p of branchHidden) {
    inactive.push({
      id: p.id, title: p.title ?? '', reason: 'branch', origin: 'chat',
      tokens: est(`[${p.title ?? ''}]\n${sub(p.content ?? '')}`),
      preview: toPreview(p.content), content: p.content ?? '',
    });
  }
  manifest.layers.lore = {
    tokens: loreTokens, cap: loreCap,
    pieces: loreSel.map(s => ({ id: s.id, title: s.title, type: s.type, reason: s.reason, boost: s.boost, weight: s.effWeight, origin: originOf(s), tokens: s.tokens, preview: toPreview(s.content), content: s.content })),
    inactive,
  };

  // 4. memory layer: pinned first (oldest→newest), then recent unpinned.
  //    Smart recall (memScores from the embeddings pass): the newest
  //    MEM_RECENT_KEEP unpinned memories always inject (recency floor), the
  //    rest are ranked by similarity and must clear the semantic threshold —
  //    old but relevant memories beat merely recent ones. Fill order is only
  //    the budget PRIORITY; the selected memories are rendered chronologically
  //    (createdAt asc) so the model reads the memory block forwards in time.
  //    Per-memory cost counts the `- ` prefix exactly as rendered.
  const memCap = Math.floor(budget * caps.memory);
  // Branch visibility (same rule as the lore layer): a memory stamped with
  // atMsg (the leaf it was summarized under) injects only while that node is
  // on the active path; unstamped memories are global.
  const memStore = Array.isArray(chat?.memoryStore?.memories) ? chat.memoryStore.memories : [];
  const memHidden = memStore.filter(m => m?.atMsg != null && !pathIds.has(m.atMsg));
  const memAll = memStore.filter(m => !(m?.atMsg != null && !pathIds.has(m.atMsg)));
  const smart = memScores instanceof Map;
  const memThreshold = typeof settings.semanticThreshold === 'number' ? settings.semanticThreshold : 0.55;
  const memPinnedList = memAll.filter(m => m.pinned).sort((a, b) => a.createdAt - b.createdAt);
  const memUnpinned = memAll.filter(m => !m.pinned).sort((a, b) => b.createdAt - a.createdAt);
  let memOrdered, memReason;
  const recentKeep = new Set(smart ? memUnpinned.slice(0, MEM_RECENT_KEEP).map(m => m.id) : []);
  if (smart) {
    const scored = memUnpinned
      .filter(m => !recentKeep.has(m.id) && (memScores.get(m.id) ?? 0) >= memThreshold)
      .sort((a, b) => (memScores.get(b.id) ?? 0) - (memScores.get(a.id) ?? 0));
    memOrdered = [...memPinnedList, ...memUnpinned.filter(m => recentKeep.has(m.id)), ...scored];
    memReason = (m) => m.pinned ? 'pinned' : recentKeep.has(m.id) ? 'recent' : 'semantic';
  } else {
    memOrdered = [...memPinnedList, ...memUnpinned];
    memReason = (m) => m.pinned ? 'pinned' : 'recent';
  }
  const memSel = [];
  let memUsed = 0;
  for (const m of memOrdered) {
    const cost = est(`- ${m.text}`);
    if (memUsed + cost > memCap) continue;
    memSel.push(m);
    memUsed += cost;
  }
  const memSelIds = new Set(memSel.map(m => m.id));
  const memRender = [...memSel].sort((a, b) => a.createdAt - b.createdAt);
  const memText = memRender.length ? `[Memories]\n${memRender.map(m => `- ${m.text}`).join('\n')}` : '';
  const memTokens = memText ? est(memText) : 0;
  manifest.layers.memory = {
    tokens: memTokens, cap: memCap, recall: smart ? 'smart' : 'recent',
    memories: memRender.map(m => ({ id: m.id, pinned: !!m.pinned, reason: memReason(m),
      ...(smart ? { score: memScores.get(m.id) ?? null } : {}),
      tokens: est(`- ${m.text}`), preview: toPreview(m.text), text: m.text ?? '' })),
    // Excluded memories, same observability contract as the lore layer.
    inactive: memAll.filter(m => !memSelIds.has(m.id)).map(m => ({
      id: m.id, pinned: !!m.pinned,
      reason: (smart && !m.pinned && !recentKeep.has(m.id) && (memScores.get(m.id) ?? 0) < memThreshold)
        ? 'below-threshold' : 'over-budget',
      ...(smart ? { score: memScores.get(m.id) ?? null } : {}),
      tokens: est(`- ${m.text}`), preview: toPreview(m.text), text: m.text ?? '' }))
      // Belong to a sibling branch — hidden, not deleted.
      .concat(memHidden.map(m => ({
        id: m.id, pinned: !!m.pinned, reason: 'branch',
        tokens: est(`- ${m.text}`), preview: toPreview(m.text), text: m.text ?? '' }))),
  };

  // 5. history fills the remainder; oldest messages dropped first.
  //    Estimates run on the macro-SUBSTITUTED text — that's what gets sent.
  const historyCap = Math.max(0, budget - staticTokens - loreTokens - memTokens - greetingTokens);
  const kept = [];
  let histUsed = 0;
  for (let i = historyNodes.length - 1; i >= 0; i--) {
    const cost = est(histText(historyNodes[i]));
    if (histUsed + cost > historyCap && kept.length > 0) break; // always keep the newest
    kept.unshift(historyNodes[i]);
    histUsed += cost;
  }
  const dropped = historyNodes.length - kept.length;
  if (dropped > 0) manifest.warnings.push(`${dropped} oldest message(s) dropped to fit the context window.`);
  // keptIds drives the chat log's context-horizon marker (which messages the
  // last generation actually saw); the exact-count guard in runGeneration
  // shifts it when it drops more.
  manifest.layers.history = { tokens: histUsed, cap: historyCap, kept: kept.length, dropped, keptIds: kept.map(n => n.id) };

  // 6. chat-completions message array
  const messages = [{ role: 'system', content: staticText }];
  if (loreText) messages.push({ role: 'system', content: `[World Info]\n${loreText}` });
  if (memText) messages.push({ role: 'system', content: memText });
  if (greetingNode) messages.push({ role: 'assistant', content: histText(greetingNode) });
  for (const n of kept)
    messages.push({ role: n.role === 'assistant' ? 'assistant' : 'user', content: histText(n) });

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
const IMAGE_CALL_CAP = 1;  // per generation; at most one generated image per reply
const TOOL_NAME_MAX = 60;
const TOOL_TEXT_MAX = 2000;

// The opener must be exactly ```tool — a word char or dash right after
// (```tools, ```tool-call in prose) is not a tool fence.
const TOOL_BLOCK_RE = /```tool(?![\w-])[ \t]*\r?\n?([\s\S]*?)```/g;
const TOOL_OPEN_RE = /```tool(?![\w-])/g; // bare opener, for trailing-fence scans

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
  let p = -1, om;
  TOOL_OPEN_RE.lastIndex = scanFrom;
  while ((om = TOOL_OPEN_RE.exec(s))) p = om.index; // last opener ≥ scanFrom
  if (p !== -1) cut = p;
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
  let open = -1, om;
  TOOL_OPEN_RE.lastIndex = 0;
  while ((om = TOOL_OPEN_RE.exec(out))) open = om.index;
  if (open !== -1) out = out.slice(0, open);
  return out;
}

// Partition parsed tool calls: generate_image calls go to the image pipeline
// (IMAGE_CALL_CAP applies there), everything else — lore tools, malformed
// calls (error set), unknown names — flows to applyToolCalls as before.
const splitImageCalls = (calls) => {
  const imageCalls = [], loreCalls = [];
  for (const c of calls ?? [])
    (c && !c.error && c.name === 'generate_image' ? imageCalls : loreCalls).push(c);
  return { imageCalls, loreCalls };
};

// Prompt prefix (settings.imagePrefix): style/quality boilerplate prepended
// to every image prompt — comma-join is the image-prompt convention (quality
// tags first). A blank prefix passes the prompt through untouched.
const imagePromptWithPrefix = (prefix, prompt) => {
  const p = String(prefix ?? '').trim();
  return p ? `${p}, ${prompt}` : prompt;
};

// ---- ComfyUI backend (settings.imageBackend === 'comfyui') ----
// ComfyUI has no OpenAI images endpoint: POST /prompt queues an API-format
// workflow graph (web UI → "Save (API Format)"), the run is polled on
// /history/{prompt_id}, and the finished image downloads from /view.
// The user-supplied workflow JSON carries placeholders, substituted in ANY
// string value: {{prompt}} (prefix already folded in), {{negative}},
// {{width}}/{{height}} (parsed from settings.imageSize), {{seed}} (one random
// int per render — regen/takes must produce different images). Any NUMERIC
// input key named seed/noise_seed is randomized too — a fixed seed in the
// graph would make every take identical. Pure: the graph is never mutated.
const COMFY_SEED_KEYS = /^(seed|noise_seed)$/i;
const comfyRandomSeed = (rng = Math.random) => Math.floor(rng() * 2 ** 32);
function substituteComfyWorkflow(workflow, { prompt = '', negative = '', width = 1024, height = 1024, seed } = {}) {
  const useSeed = Number.isFinite(seed) ? seed : comfyRandomSeed();
  const sub = (v) => String(v)
    .replaceAll('{{prompt}}', prompt)
    .replaceAll('{{negative}}', negative)
    .replaceAll('{{width}}', String(width))
    .replaceAll('{{height}}', String(height))
    .replaceAll('{{seed}}', String(useSeed));
  const walk = (node) => {
    if (typeof node === 'string') return sub(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(node))
        out[k] = typeof v === 'number' && COMFY_SEED_KEYS.test(k) ? useSeed : walk(v);
      return out;
    }
    return node;
  };
  return walk(workflow);
}
// "1024x768" → { width: 1024, height: 768 }; junk/absent → square 1024.
const parseImageSize = (size) => {
  const m = String(size ?? '').trim().match(/^(\d+)\s*x\s*(\d+)$/i);
  return m ? { width: +m[1], height: +m[2] } : { width: 1024, height: 1024 };
};
// Read a /history/{prompt_id} record: {} while queued/running → not done;
// status_str 'error' → done + message; otherwise the first output image
// ({filename, subfolder, type}) across all node outputs wins.
function comfyHistoryResult(history, promptId) {
  const rec = (promptId ? history?.[promptId] : null) ?? Object.values(history ?? {})[0];
  if (!rec) return { done: false, error: null, image: null };
  const statusStr = rec?.status?.status_str;
  if (statusStr === 'error') {
    const msgs = (rec?.status?.messages ?? [])
      .map((m) => Array.isArray(m) ? m.filter(x => typeof x === 'string').join(' ') : String(m))
      .filter(Boolean).join('; ');
    return { done: true, error: msgs || 'ComfyUI run failed', image: null };
  }
  if (statusStr !== 'success' && rec?.status?.completed !== true)
    return { done: false, error: null, image: null };
  for (const nodeOut of Object.values(rec?.outputs ?? {})) {
    const img = (nodeOut?.images ?? []).find((i) => i?.filename);
    if (img) return { done: true, error: null, image: img };
  }
  return { done: true, error: 'ComfyUI run finished with no image output', image: null };
}

// Execute parsed calls against the chat's lore overlay. Returns
// { chat, results: [{ name, args, ok, note }] }; same chat object when
// nothing applied. Unknown tools / validation failures are notes, not throws.
// New pieces are tagged { createdAt, createdBy, createdSwipe } (plus atLen
// for position context) — the provenance the assembler's branch/swipe
// derivation scopes by (rewind/regenerate never delete world state).
// Updates keep the original piece's provenance.
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

// ---- emergent lore review queue ---------------------------------------------
// Proposals (add_lore tool calls under a 'queue'-mode scenario, or the
// extraction pipeline) wait in chat.loreQueue for user review. Accept moves a
// proposal into lorePieces as USER-OWNED — provenance stripped, so the piece
// is global (branch derivation never hides it) like a hand-authored one.
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

function applyToolCall(chat, call, { nodeId = null, now = Date.now(), queueLore = false, allPieces = null, atLen = null, createdSwipe = null } = {}) {
  const fail = (note) => ({ ok: false, note, chat });
  const args = call?.args ?? {};
  const pieces = Array.isArray(chat?.lorePieces) ? chat.lorePieces : [];
  const base = {
    pinned: false, weight: 0, links: [], enabled: true, searchDepth: null,
    wholeWord: false, caseSensitive: false, smart: false,
  };
  const save = (lorePieces, note) => ({ ok: true, note, chat: { ...chat, lorePieces } });
  // createdSwipe: the active swipe of nodeId at write time — scopes the write
  // to that take of the reply (a regenerate's new swipe starts clean, the
  // replaced swipe keeps its own state; derivation, never deletion).
  const provenance = { createdAt: now, ...(Number.isFinite(atLen) ? { atLen } : {}), createdBy: nodeId,
    ...(Number.isInteger(createdSwipe) ? { createdSwipe } : {}) };
  // Revision log for EVERY tool-driven content mutation (universal rollback
  // rule): piece.content/keys always mirror the LAST revision, and the
  // assembler views the piece at the last revision on view for the active
  // branch/swipe (pieceAtPath). The first revision is the pre-update
  // original — null-stamped for scenario/global/hand-authored pieces, so it
  // is visible on every branch and the original is never lost.
  const revOf = (p) => ({ content: p.content ?? '', keys: Array.isArray(p.keys) ? p.keys : [],
    atLen: Number.isFinite(p.atLen) ? p.atLen : null,
    createdAt: Number.isFinite(p.createdAt) ? p.createdAt : null,
    createdBy: p.createdBy ?? null,
    createdSwipe: Number.isInteger(p.createdSwipe) ? p.createdSwipe : null });
  // p = piece to write (already provenance-stamped for shadows); seed = the
  // piece rev 0 is taken from when no log exists yet; keys null = keep current.
  const withRevision = (p, seed, content, keys) => ({
    ...p, content, ...(keys ? { keys } : {}),
    revisions: [...(Array.isArray(p.revisions) ? p.revisions : [revOf(seed)]),
      { content, keys: keys ?? p.keys ?? [], ...provenance }],
  });
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
      return save(pieces.map(p => p.id === existing.id ? withRevision(p, p, desc, null) : p),
        `updated character "${cname}"`);
    if (existing)
      // Match lives outside the chat overlay (scenario/global): shadow it via
      // the overlay instead of duplicating the name (characterNamesOf would
      // report it twice). Fresh provenance → rewind drops the shadow again;
      // rev 0 is seeded from the UNPROVENANCED original.
      return save([...pieces, withRevision({ ...existing, ...provenance }, existing, desc, null)],
        `updated character "${cname}"`);
    return save([...pieces, { ...base, ...provenance, id: uid(), type: 'character', title: cname, content: desc, keys: [cname] }],
      `registered character "${cname}"`);
  }
  if (call.name === 'update_character') {
    const cname = String(args.name ?? '').trim().slice(0, TOOL_NAME_MAX);
    const content = String(args.content ?? '').trim().slice(0, TOOL_TEXT_MAX);
    if (!cname) return fail('update_character: name required');
    if (!content) return fail('update_character: content required (the full updated card)');
    const keys = Array.isArray(args.keys)
      ? args.keys.map(k => String(k).trim()).filter(k => k.length >= MIN_KEY_LENGTH).slice(0, 5)
      : null; // omitted → keep the current keys
    const haystack = Array.isArray(allPieces) ? allPieces : pieces;
    const existing = haystack.find(p => p.type === 'character'
      && (p.title ?? '').trim().toLowerCase() === cname.toLowerCase());
    // Strict: updates never invent characters — the model must register first.
    if (!existing)
      return fail(`update_character: no character named "${cname}" — register it first`);
    if (pieces.some(p => p.id === existing.id))
      return save(pieces.map(p => p.id === existing.id ? withRevision(p, p, content, keys) : p),
        `updated character "${cname}"`);
    // Match lives outside the chat overlay (scenario/global): shadow it — the
    // original entity never mutates. rev 0 is seeded from the UNPROVENANCED
    // original; the shadow itself carries fresh provenance, so rewind drops
    // the whole shadow and the original resurfaces.
    return save([...pieces, withRevision({ ...existing, ...provenance }, existing, content, keys)],
      `updated character "${cname}"`);
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
      return save(pieces.map(p => p.id === existing.id ? withRevision(p, p, content, keys.length ? keys : null) : p),
        `updated lore "${title}"`);
    if (existing)
      // Match lives outside the chat overlay: shadow it via an overlay copy
      // (fresh provenance → rewind drops the shadow again; rev 0 = original).
      return save([...pieces, withRevision({ ...existing, ...provenance }, existing, content, keys.length ? keys : null)],
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
- register_character(name, description): a NEW named character enters the story who may recur. description: appearance, personality, motives in a few sentences.
- update_character(name, content, keys?): rewrite an EXISTING character's reference card when their lasting traits, appearance, relationships, or knowledge change. content is the character's FULL updated card with the change folded in, never a fragment or a diff. Only for characters the app already knows; a newcomer is registered first. Past versions are kept and can be rolled back, so update freely when the story genuinely changes someone.
- add_lore(title, content, keys?): record a lasting fact about the world, a place, or an object. keys: up to 5 optional trigger words.
Rules: the JSON field for the tool is "tool", never "name"; emit a block at the moment the character or thing enters the narrative, then continue the story; never register {{user}}; a character you speak for with a Name: prefix must be known to the app, so register a newcomer BEFORE their first prefixed line, in the same reply; at most one tool block per reply unless several newcomers appear at once; never mention tool blocks in the prose.`;

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
// Each segment also carries `start`/`end`: offsets into the INPUT text
// delimiting where the segment's visible content begins and ends (used to
// place generated images between segment bubbles). The split runs on the
// DEDUPED string, so when dedupe dropped characters the offsets are mapped
// back line-anchored (dedupe deletes chars only, newlines survive 1:1):
// a segment's content start always precedes any removal on its line, so
// `start` stays exact; `end` is best-effort when a mid-line removal precedes
// it on the same line (greedy char match — segment granularity is all the
// image placement needs).

// Weak models often repeat a speaker prefix INSIDE the same speaker's stretch
// ("Mia: … Mia: …" mid-paragraph, or several "Narrator:" parts in a row).
// Strip the redundant prefixes: a prefix is dropped only when it names the
// CURRENT speaker — a line-start repeat, or a mid-line " Mia: " occurrence in
// that speaker's stretch. A different character still splits (line start) or
// stays literal (mid-line). Applied before the display split AND in the
// prompt assembler, so the stored swipe keeps the raw text (logprobs stay
// aligned) but fed-back history shows the clean form — the model doesn't
// learn the repeat habit from its own output.
// Line-start speaker prefix matcher, shared by dedupe + split below. The name
// class allows digit-leading names ("2B", "7 of 9") and caps at TOOL_NAME_MAX
// (60 chars) so every registrable name can split; matches are always verified
// against the known-names list (or "narrator"), so the loose class can't
// false-split prose like "2024: a recap".
const SPEAKER_LINE_RE = /^\s*\*{0,2}\s*([\p{L}\p{N}][\p{L}\p{M}\p{N}'. \-]{0,59}?)\s*\*{0,2}\s*:(?:[ \t]*\*{1,2}(?=\s|$))?\s*/u;
function dedupeSpeakerPrefixes(text, names) {
  const s = String(text ?? '');
  if (!s || !names?.length) return s;
  const byLower = new Map(names.map(n => [String(n).toLowerCase(), n]));
  const lineRe = SPEAKER_LINE_RE;
  const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const midReFor = (spk) => new RegExp(`(\\s)\\*{0,2}${escRe(spk)}\\*{0,2}:[ \\t]+`, 'giu');
  let cur = 'Narrator'; // leading text is narration
  let midRe = midReFor(cur);
  const out = [];
  for (const line of s.split('\n')) {
    let l = line;
    const m = lineRe.exec(l);
    const key = m?.[1].trim().toLowerCase();
    const name = m && key !== 'narrator' ? byLower.get(key) : null;
    if (name || key === 'narrator') {
      const spk = name ?? 'Narrator';
      if (spk === cur) {
        l = l.slice(m[0].length); // repeat of the current speaker — drop the prefix
      } else {
        cur = spk; midRe = midReFor(spk);
        // New speaker starts here — keep this prefix, dedupe only the rest.
        out.push(l.slice(0, m[0].length) + l.slice(m[0].length).replace(midRe, '$1'));
        continue;
      }
    }
    out.push(l.replace(midRe, '$1'));
  }
  return out.join('\n');
}

function splitSpeakerSegments(text, names) {
  const input = String(text ?? '');
  const s = dedupeSpeakerPrefixes(input, names);
  if (!s || !names?.length) return [{ speaker: null, text: s, start: 0, end: s.length }];
  const byLower = new Map(names.map(n => [String(n).toLowerCase(), n]));
  // Stars after the colon only close a bold prefix (`**Name:**` — stars
  // followed by whitespace/EOL); an action's opening star (`Mira: *nods*`)
  // must survive or the emphasis is left unpaired.
  const re = SPEAKER_LINE_RE;
  // Deduped-offset → input-offset map, built only when dedupe changed the
  // string (otherwise they coincide). Line-anchored: line k of s derives
  // from line k of the input by deletions, so walk each pair, skipping the
  // dropped chars; newlines map to newlines.
  let d2i = null;
  if (s !== input) {
    d2i = new Array(s.length);
    const iLines = input.split('\n'), dLines = s.split('\n');
    let iBase = 0, dBase = 0;
    for (let k = 0; k < dLines.length; k++) {
      const iL = iLines[k] ?? '', dL = dLines[k];
      let ti = 0;
      for (let d = 0; d < dL.length; d++) {
        while (ti < iL.length && iL[ti] !== dL[d]) ti++;
        d2i[dBase + d] = iBase + Math.min(ti, iL.length);
        if (ti < iL.length) ti++;
      }
      if (dBase + dL.length < s.length) d2i[dBase + dL.length] = iBase + iL.length; // '\n' ↔ '\n'
      iBase += iL.length + 1; dBase += dL.length + 1;
    }
  }
  const off = (d) => (d2i ? (d2i[d] ?? input.length) : d);
  const segments = [];
  // start/end: deduped offsets of the segment's visible content, pending
  // (-1) until the first non-whitespace contribution arrives.
  let cur = { speaker: null, text: '', start: -1, end: -1 };
  let lineStart = 0; // offset of the current line in the deduped string
  const push = () => {
    if (cur.text.trim())
      segments.push({ speaker: cur.speaker, text: cur.text.trim(), start: off(cur.start), end: off(cur.end) });
  };
  for (const line of s.split('\n')) {
    const m = re.exec(line);
    const key = m?.[1].trim().toLowerCase();
    const name = m && key !== 'narrator' ? byLower.get(key) : null;
    const splits = !!(name || key === 'narrator');
    if (splits) {
      push();
      cur = { speaker: name ?? null, text: line.slice(m[0].length), start: -1, end: -1 };
    } else {
      cur.text += (cur.text ? '\n' : '') + line;
    }
    // The line's visible contribution (prefix stripped on split lines) moves
    // the pending start at its first non-space char, the end past its last.
    const cl = line.slice(splits ? m[0].length : 0);
    const first = cl.search(/\S/);
    if (first !== -1) {
      if (cur.start === -1) cur.start = lineStart + (splits ? m[0].length : 0) + first;
      cur.end = lineStart + (splits ? m[0].length : 0) + cl.trimEnd().length;
    }
    lineStart += line.length + 1;
  }
  push();
  return segments.length ? segments : [{ speaker: null, text: s, start: 0, end: s.length }];
}

// Default platform-prompt addition permitting multi-speaker replies.
// Appended when settings.multiSpeaker !== false; user-editable
// (settings.speakerPrompt, this is the default).
const SPEAKER_PROMPT = `When several named characters share the scene, you may reply for more than one of them in a single turn: start each character's part with their FULL registered name and a colon on its own line ("The Auctioneer: …"; shortenings like "Auctioneer:" are not recognized), in the order they speak or act, at most one part per character. One prefix starts the whole part; never repeat it for the same character; the following lines belong to that character until another name or "Narrator:" appears. Narration needs no prefix at the start of the reply; after a character's part, resume it with a single "Narrator:" on its own line, never several "Narrator:" parts in a row, and only for genuine scene-level narration that belongs to no character (unprefixed lines simply continue the current part). In a scene with only one character, write everything in that character's own voice, action and description included; do not use "Narrator:" at all. Use a prefix only for a character the app already knows, whether from the scenario lore or an earlier registration; a prefix for an unknown name is not recognized and is shown to the reader as plain text.`;

// Prose formatting conventions — single source of truth, woven into the
// platform prompt (src/83-settings.js) and both generator prompts below, so
// the RP reply format and generated greetings/lore can't drift apart.
const PROSE_FORMAT_RULES = 'Prose format: wrap spoken dialogue in double quotation marks ("like this") and actions or non-verbal beats in single asterisks (*like this*). When a specific character speaks or acts, begin that part with the character\'s FULL name exactly as registered, followed by a colon ("The Auctioneer:", never a shortening like "Auctioneer:"; a partial name is not recognized and shows to the reader as plain text). One prefix starts the whole part; never repeat it for the same character; the following lines belong to that character until another name or "Narrator:" appears. The app labels the message with the prefix and hides it from the reader; resume scene-level narration with a single "Narrator:" line, never several "Narrator:" parts in a row. Narration without a speaker needs no prefix.';

// Default aux-task prompts (user-editable in Settings → Prompts). {{user}} is
// substituted with the persona name at call time; the suggestions prompt also
// takes {{count}} and {{words}}.
const DEFAULT_SUGGESTIONS_PROMPT = 'You suggest what the user\'s character ({{user}}) might say or do next in this roleplay. Reply with exactly {{count}} options as a numbered list, one per line, at most {{words}} words each, written in first person as {{user}}. In-character; do not narrate other characters\' actions; no commentary.';
const DEFAULT_MEMORY_PROMPT = 'You keep memory notes for an ongoing roleplay. Summarize the key recent events, revealed facts, and relationship changes as compact plain prose of at most {{chars}} characters. When earlier notes are provided, record only new developments; do not repeat what they already cover. Past events only; no speculation; no lists; no formatting.';
const DEFAULT_LORE_EXTRACT_PROMPT = 'You maintain the lorebook of an ongoing roleplay. Extract up to {{max}} NEW lasting facts about the world, places, objects, or factions from the recent conversation: long-term reference material, not momentary events, and never facts already in the existing lore. Reply with a JSON array only: [{"title":"…","content":"…","keys":["…"]}], or [] if nothing qualifies.';
const DEFAULT_IMPROVE_PROMPT = 'Rewrite the user\'s draft in first person as {{user}}, matching the roleplay\'s tone. Output only the rewritten text.';
const DEFAULT_IMPERSONATE_PROMPT = 'You write the next message for the user\'s character ({{user}}) in this roleplay, in their place. Reply with only the message text, in first person as {{user}}, matching the roleplay\'s tone and prose format (actions in *asterisks*, speech in "double quotes"). One to three paragraphs; stay in character; do not narrate other characters\' actions or dialogue; no commentary.';
const DEFAULT_RECAP_PROMPT = 'Summarize the following roleplay excerpt into a cohesive recap in third person, past tense, at most {{words}} words. Output only the recap.';
// Generator prompts (✦ Generate in the scenario/character editors) take no
// runtime placeholders — {{user}} stays literal so the generated text keeps
// the macro. The reply contract is one JSON object; parsing is tolerant
// (first { to last } — see extractGenJSON in src/97-generator.js).
const DEFAULT_SCENARIO_GEN_PROMPT = 'You design roleplay scenarios for a chat app. Given the user\'s request (and an optional current draft to extend), reply with a single JSON object only, no commentary: {"name":"…","description":"…","tags":["…"],"scenarioInstructions":"…","backstory":"…","greeting":"…","lorePieces":[{"type":"lore|character","title":"…","content":"…","keys":["…"],"pinned":false}]}. name, description and tags are metadata never sent to the AI; description is a one-line teaser. scenarioInstructions steer the AI\'s style and behavior; backstory is the world setup the AI always sees. The greeting is the first assistant message of every new chat; write it in scene as narrative prose in the app\'s format. Each lore piece covers ONE entity (a character, location, faction or item): content is compact reference prose, keys are trigger words that inject the piece when mentioned; every character piece needs its name as a key. Every character who speaks or acts in the greeting needs a character lore piece; the app attributes Name: speech only to characters in the lore. At most 5 character pieces. {{user}} in any field is a literal macro for the user\'s character; keep it as-is. Omit lorePieces if none are needed; always return the complete object. ' + PROSE_FORMAT_RULES;
const DEFAULT_CHARACTER_GEN_PROMPT = 'You design character cards for a roleplay chat app. Given the user\'s request (and an optional current draft to extend), reply with a single JSON object only, no commentary: {"name":"…","content":"…","keys":["…"],"greeting":"…","color":"#rrggbb"}. content is the card sent to the AI when the character is active: compact reference prose covering appearance, personality and motives. keys are trigger words that activate the card when mentioned; include the character\'s name. The greeting is the first assistant message of a chat with this character; write it in scene from that character, in the app\'s prose format. color is optional: a hex colour suiting the character, used for their name in the chat UI; omit it when nothing fits. {{user}} in any field is a literal macro for the user\'s character; keep it as-is. ' + PROSE_FORMAT_RULES;
const DEFAULT_PIECE_GEN_PROMPT = 'You write lorebook entries for a roleplay chat app. Given the user\'s request (and an optional current draft to extend), reply with a single JSON object only, no commentary: {"type":"lore|character","title":"…","content":"…","keys":["…"],"pinned":false}. One entry covers ONE entity (a character, location, faction or item). content is compact reference prose sent to the AI when the entry activates; for characters cover appearance, personality and motives. keys are trigger words that inject the entry when mentioned; every character entry needs its name as a key. pinned entries are always injected; use sparingly. {{user}} in any field is a literal macro for the user\'s character; keep it as-is.';
// Image prompts (v4.10): the first teaches the chat model the generate_image
// tool (platform-prompt addition, user-editable like TOOLS_PROMPT); the
// second is the system prompt for the avatar-generation aux call (the user
// message supplies the character's name + card).
const DEFAULT_IMAGE_PROMPT = `You can attach ONE generated image to a reply by ending it with a tool block in this exact format:
\`\`\`tool
{"tool": "generate_image", "args": {"prompt": "Vex, a wiry dock informant with a copper eye and a patched oilskin coat, leaning on a rain-slick railing in a floating city's sky docks at dusk, warm lantern light, painterly style", "caption": "Vex at the sky docks"}}
\`\`\`
Rules: attach an image only for visually significant moments: a new location, a character's first appearance, a dramatic reveal; never for ordinary exchanges; the prompt must be a complete, self-contained visual description (subjects, clothing, setting, lighting, style) because the image generator sees nothing else; the caption is at most 12 words; the image block goes at the very end of the reply, after any other tool block; never mention the image block in the prose.`;
const DEFAULT_AVATAR_GEN_PROMPT = 'You condense character cards into image-generation prompts. Given a character\'s name and card, write a single prompt for a square portrait of that character: face and distinguishing features, expression, and a simple background that fits them. The portrait shows this one character only, with no text and no watermark. Output only the prompt text, no commentary, no quotes.';
// ---- import normalization ----
// Imports (sidebar files, bundles, full backups) upsert JSON nearly verbatim —
// a hand-edited or third-party file can lack fields the editors and the
// message UI assume (the `draft.lorePieces.length` crash class). These coerce
// just the shape and pass unknown fields through; applied at every import
// path AND at editor draft init, so already-stored malformed entities heal
// on open. Idempotent — a well-formed entity passes through unchanged.
const asStr = (v) => (v == null ? '' : String(v));
const asArr = (v) => (Array.isArray(v) ? v : []);
function normalizeLorePiece(p) {
  const o = (p && typeof p === 'object') ? p : {};
  // Timed-activation fields: positive ints or absent (0 = off = absent);
  // prob is a 0–100 percent (0 = never fires — a real value, not "off").
  const posInt = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : undefined);
  const pct = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(100, Number(v))) : undefined);
  return { ...o, id: o.id ?? uid(), title: asStr(o.title), content: asStr(o.content),
    keys: asArr(o.keys).map(String),
    // Character-type pieces may carry an avatar like a global card (same
    // idiom as normalizeCharacter; '' = none).
    avatar: typeof o.avatar === 'string' ? o.avatar : '',
    avatarFull: typeof o.avatarFull === 'string' ? o.avatarFull : '',
    sticky: posInt(o.sticky), cooldown: posInt(o.cooldown), delay: posInt(o.delay),
    prob: pct(o.prob), group: asStr(o.group).trim() || undefined,
    // Swipe-scoped provenance (v4.10.1): integer or absent.
    createdSwipe: Number.isInteger(o.createdSwipe) ? o.createdSwipe : undefined,
    // update_character version log — shape-only heal; absent stays absent
    // (undefined keys serialize away).
    revisions: o.revisions === undefined ? undefined : asArr(o.revisions).map(r => ({
      content: asStr(r?.content), keys: asArr(r?.keys).map(String),
      atLen: Number.isFinite(r?.atLen) ? r.atLen : null,
      createdAt: Number.isFinite(r?.createdAt) ? r.createdAt : null,
      createdBy: r?.createdBy != null ? String(r.createdBy) : null,
      createdSwipe: Number.isInteger(r?.createdSwipe) ? r.createdSwipe : null })) };
}
function normalizeScenario(s) {
  const o = (s && typeof s === 'object') ? s : {};
  return { ...o,
    name: asStr(o.name), description: asStr(o.description),
    tags: asArr(o.tags).map(String),
    avatar: typeof o.avatar === 'string' ? o.avatar : '',
    // Uncropped ≤1024 companion to the 256² avatar thumb — the chat lightbox
    // and PNG card export read avatarFull || avatar; '' falls back to the thumb.
    avatarFull: typeof o.avatarFull === 'string' ? o.avatarFull : '',
    backstory: asStr(o.backstory), greeting: asStr(o.greeting),
    scenarioInstructions: asStr(o.scenarioInstructions),
    // Alternate first messages (card imports): new chats offer them as extra
    // greeting swipes on the root node. Shape-only coercion.
    alternateGreetings: asArr(o.alternateGreetings).map(String),
    // Generation defaults for NEW chats (snapshotted into chat.settings at
    // creation): a model override and a sparse sampler set. Coerced to
    // shape-only; undefined keys serialize away.
    model: asStr(o.model).trim() || undefined,
    samplers: (o.samplers && typeof o.samplers === 'object' && !Array.isArray(o.samplers)) ? o.samplers : undefined,
    lorePieces: asArr(o.lorePieces).map(normalizeLorePiece),
    characterIds: asArr(o.characterIds).map(String) };
}
function normalizeCharacter(c) {
  const o = (c && typeof c === 'object') ? c : {};
  return { ...o, name: asStr(o.name), content: asStr(o.content),
    keys: asArr(o.keys).map(String), greeting: asStr(o.greeting), color: asStr(o.color),
    avatar: typeof o.avatar === 'string' ? o.avatar : '',
    // Uncropped ≤1024 companion to the 256² avatar thumb (see normalizeScenario).
    avatarFull: typeof o.avatarFull === 'string' ? o.avatarFull : '',
    // Alternate first messages (card imports) — greeting swipes in new direct chats.
    alternateGreetings: asArr(o.alternateGreetings).map(String),
    // Generation defaults for NEW direct chats — same shape as the scenario's
    // (snapshotted into chat.settings at creation; applied only when the chat
    // is rooted in this character, never when it's merely linked into one).
    model: asStr(o.model).trim() || undefined,
    samplers: (o.samplers && typeof o.samplers === 'object' && !Array.isArray(o.samplers)) ? o.samplers : undefined };
}
// Export a character-type lore piece (chat-registered or scenario-owned) as a
// global character card. Content/keys are taken as stored — they mirror the
// piece's latest revision, which is what the piece editor shows. Provenance
// (createdBy/atLen/createdSwipe, revisions) and lore-only fields (links,
// timed activation, search flags) are stripped: a global card is branch-global
// by construction. Fresh id — a same-named card never clobbers (the single-
// character JSON import precedent). Run the result through normalizeCharacter.
function characterFromPiece(p) {
  const o = (p && typeof p === 'object') ? p : {};
  const now = Date.now();
  return {
    id: uid(), name: asStr(o.title), content: asStr(o.content),
    keys: asArr(o.keys).map(String),
    pinned: !!o.pinned, weight: Number.isFinite(o.weight) ? o.weight : 0,
    smart: !!o.smart, enabled: o.enabled !== false,
    avatar: typeof o.avatar === 'string' ? o.avatar : '',
    avatarFull: typeof o.avatarFull === 'string' ? o.avatarFull : '',
    color: '', greeting: '', alternateGreetings: [],
    createdAt: now, updatedAt: now,
  };
}
// activeSwipe — the message UI reads node.swipes[node.activeSwipe] unguarded.
function normalizeChat(c) {
  const o = (c && typeof c === 'object') ? c : {};
  const messages = {};
  for (const [id, n] of Object.entries((o.messages && typeof o.messages === 'object') ? o.messages : {})) {
    if (!n || typeof n !== 'object') continue;
    const swipes = asArr(n.swipes).filter(s => s && typeof s === 'object');
    if (!swipes.length) swipes.push({ text: '', createdAt: Date.now(), modelId: null });
    const activeSwipe = Number.isInteger(n.activeSwipe)
      ? Math.min(Math.max(n.activeSwipe, 0), swipes.length - 1) : 0;
    messages[id] = { ...n, id: n.id ?? id, swipes, activeSwipe };
  }
  return normalizeBranchSwipes({ ...o, messages });
}
// ---- character card import (chara_card v1/v2/v3, JSON or PNG-embedded) ----
// Card trigger keys are plain text; FictionPad keys are regex — escape to
// literal so "Dr. Strange" can't mean "DrX Strange".
const escapeRxKey = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Cards use {{char}}; FictionPad has {{user}} only (multi-character scenarios
// make {{char}} ambiguous) — bind it to the card's own name at import time.
const subCardMacros = (text, name) => asStr(text).replace(/\{\{char\}\}/gi, name);
// Bytes → ASCII without spreading (a large tEXt chunk would overflow the
// argument limit of a single String.fromCharCode(...bytes) call).
const u8ToAscii = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 32768)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
  return s;
};
// Bytes → base64, via the same chunked binary-string route (never spread a
// large array into String.fromCharCode).
const u8ToBase64 = (bytes) => btoa(u8ToAscii(bytes));
// PNG chunk CRC32 (over the chunk's type + data bytes), table-based.
const PNG_CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function pngCrc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = PNG_CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
// Extract the embedded card JSON text from PNG bytes (tEXt chunk keyword
// "chara" = v1/v2, "ccv3" = v3; base64 payload). Returns null when the file
// carries no card. CRCs are not verified (display data, not a trust boundary);
// zTXt/iTXt compression is unsupported — SillyTavern writes plain tEXt.
function extractPngCardJson(u8) {
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if (!u8 || u8.length < 8 || sig.some((b, i) => u8[i] !== b)) return null;
  let off = 8;
  while (off + 8 <= u8.length) {
    const len = (((u8[off] << 24) | (u8[off + 1] << 16) | (u8[off + 2] << 8) | u8[off + 3]) >>> 0);
    const type = u8ToAscii(u8.subarray(off + 4, off + 8));
    const end = off + 8 + len; // + 4 CRC bytes after the data
    if (end + 4 > u8.length) return null; // truncated
    if (type === 'tEXt') {
      let nul = off + 8;
      while (nul < end && u8[nul] !== 0) nul++;
      const keyword = u8ToAscii(u8.subarray(off + 8, nul));
      if (keyword === 'chara' || keyword === 'ccv3') {
        const bin = atob(u8ToAscii(u8.subarray(nul + 1, end)).trim());
        return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
      }
    }
    if (type === 'IEND') return null;
    off = end + 4;
  }
  return null;
}
// Inverse of extractPngCardJson (card EXPORT to PNG): returns a new
// Uint8Array with a tEXt chunk (keyword "chara", base64 UTF-8 JSON payload)
// inserted immediately before IEND. The input bytes are untouched. Throws on
// non-PNG input or a PNG with no IEND chunk.
function embedPngCardJson(u8, jsonStr) {
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if (!u8 || u8.length < 8 || sig.some((b, i) => u8[i] !== b)) throw new Error('not a PNG');
  let off = 8, iend = -1;
  while (off + 8 <= u8.length) {
    const len = (((u8[off] << 24) | (u8[off + 1] << 16) | (u8[off + 2] << 8) | u8[off + 3]) >>> 0);
    const type = u8ToAscii(u8.subarray(off + 4, off + 8));
    const end = off + 8 + len; // + 4 CRC bytes after the data
    if (end + 4 > u8.length) break; // truncated — no usable IEND
    if (type === 'IEND') { iend = off; break; }
    off = end + 4;
  }
  if (iend === -1) throw new Error('PNG has no IEND chunk');
  // type + data (all ASCII: 'tEXt' + 'chara' + NUL + base64), then the CRC
  // over exactly those bytes.
  const td = Uint8Array.from('tEXt' + 'chara\0' + u8ToBase64(new TextEncoder().encode(String(jsonStr))),
    c => c.charCodeAt(0));
  const chunk = new Uint8Array(4 + td.length + 4); // length + type+data + CRC
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, td.length - 4); // data length excludes the type bytes
  chunk.set(td, 4);
  dv.setUint32(4 + td.length, pngCrc32(td));
  const out = new Uint8Array(u8.length + chunk.length);
  out.set(u8.subarray(0, iend), 0);
  out.set(chunk, iend);
  out.set(u8.subarray(iend), iend + chunk.length);
  return out;
}
// Map a character card onto a linked scenario + global character pair, or
// return null when the object isn't a card. v2/v3 are detected by spec/data,
// v1 by its flat shape (never an object with a `type` — FictionPad exports
// are checked by the caller first anyway). Field mapping: description +
// personality + mes_example → character content; scenario → backstory;
// system_prompt + post_history_instructions → scenario instructions;
// first_mes → BOTH greetings (direct chats read the character's, scenario
// chats the scenario's); creator_notes/tags → scenario metadata;
// character_book entries → lore pieces (constant → pinned; keys escaped;
// secondary keys/positions/recursion dropped — see the deferred list).
// alternate_greetings → `alternateGreetings` on BOTH entities (new chats offer
// them as greeting swipes on the root node; the scenario's win in scenario
// chats, so a linked character's never leak in).
function parseCharacterCard(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (typeof obj.type === 'string' && obj.type.startsWith('fictionpad-')) return null; // own exports, never cards
  const d = (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) ? obj.data : null;
  let raw;
  if ((typeof obj.spec === 'string' && obj.spec.startsWith('chara_card')) || (d && asStr(d.name).trim()))
    raw = d ?? {};
  else if (!obj.type && asStr(obj.name).trim() &&
    [obj.description, obj.personality, obj.scenario, obj.first_mes, obj.mes_example].some(v => asStr(v).trim()))
    raw = obj; // v1 flat
  else return null;
  const name = asStr(raw.name).trim();
  if (!name) return null;
  const card = (v) => subCardMacros(v, name).trim();
  const content = [
    card(raw.description),
    card(raw.personality) && `Personality: ${card(raw.personality)}`,
    card(raw.mes_example) && `Example dialogue:\n${card(raw.mes_example)}`,
  ].filter(Boolean).join('\n\n');
  const now = Date.now();
  const alternateGreetings = asArr(raw.alternate_greetings)
    .filter(g => typeof g === 'string').map(g => card(g)).filter(Boolean);
  const character = {
    id: uid(), name, content, keys: [], // blank → the card name itself triggers
    pinned: false, weight: 0, smart: false, enabled: true, color: '',
    greeting: card(raw.first_mes), alternateGreetings, createdAt: now, updatedAt: now,
  };
  const lorePieces = asArr(raw.character_book?.entries).map(e => normalizeLorePiece({
    id: uid(), type: 'lore',
    title: asStr(e?.comment).trim() || asStr(e?.name).trim() || asStr(asArr(e?.keys)[0]).trim() || '(imported)',
    content: card(e?.content),
    keys: asArr(e?.keys).map(k => escapeRxKey(asStr(k).trim())).filter(k => k.length >= 2),
    pinned: !!e?.constant, caseSensitive: !!e?.case_sensitive,
    enabled: e?.enabled !== false,
  }));
  const scenario = normalizeScenario({
    id: uid(), name,
    description: card(raw.creator_notes) || 'Imported from a character card.',
    tags: asArr(raw.tags).map(String),
    backstory: card(raw.scenario),
    greeting: card(raw.first_mes), alternateGreetings,
    scenarioInstructions: [card(raw.system_prompt), card(raw.post_history_instructions)].filter(Boolean).join('\n\n'),
    lorePieces, characterIds: [character.id],
    emergentLore: 'queue', createdAt: now,
  });
  return { scenario, character };
}
// Inverse of parseCharacterCard (card EXPORT): a scenario + character pair →
// chara_card v2 object. Only fields parseCharacterCard reads are mapped, so
// parse(build(s, c)) round-trips name / description / greeting / backstory /
// scenarioInstructions / tags / alternateGreetings. The pair's extra fields
// (lore pieces, colors, generation defaults, avatar) have no card slot and
// are dropped by design — in the PNG export (onExportCharacterPng) the avatar
// instead doubles as the card's image bytes, with this JSON embedded via
// embedPngCardJson. `scenario` may be null (a character linked nowhere) — the
// card then carries the character only, scenario fields empty. A card holds
// ONE greeting set — the character's wins, falling back to the scenario's (on
// re-import both entities get it).
function buildCharacterCard(scenario, character) {
  const s = (scenario && typeof scenario === 'object') ? scenario : {};
  const c = (character && typeof character === 'object') ? character : {};
  const alts = asArr(c.alternateGreetings).length ? c.alternateGreetings : asArr(s.alternateGreetings);
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: asStr(c.name).trim() || asStr(s.name).trim(),
      description: asStr(c.content),
      personality: '',
      scenario: asStr(s.backstory),
      first_mes: asStr(c.greeting) || asStr(s.greeting),
      mes_example: '',
      creator_notes: asStr(s.description),
      system_prompt: asStr(s.scenarioInstructions),
      post_history_instructions: '',
      tags: asArr(s.tags).map(String),
      alternate_greetings: alts.map(String),
    },
  };
}
// ---- image externalization (used by the storage layer, 40-storage.js) ----
// Persisted entities carry `imgref:<id>` sentinels in place of `data:image/…`
// data URLs; image payloads live in a separate Images store (one row per
// distinct image) and are rehydrated back into entities on load. The app data
// model never sees a sentinel — extraction/rehydration happen only at the
// persistence boundary. Ids are content hashes, so forks/copies/takes that
// share a data URL share ONE stored image (dedupe by construction).
const IMGREF_PREFIX = 'imgref:';
const IMGREF_RE = /^imgref:([0-9a-f]{16}(?:-[0-9]+)?)$/;
// cyrb53-style 64-bit string hash — sync, no crypto dependency, avalanche is
// ample for content dedupe (not a security boundary).
function hashImageId(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}
// Replace every data:image/ string in `value` with its imgref sentinel.
// `known` (id → dataUrl) = images already stored: a hit with identical
// content is dedupe (no row re-written); a hit with different content is a
// hash collision and the id is salted (-2, -3…). Structural sharing:
// unchanged subtrees are returned by reference, input is never mutated.
function extractImages(value, known = new Map()) {
  const images = [];
  const assigned = new Map(); // id -> dataUrl, this pass (catches in-entity collisions)
  const byUrl = new Map();    // dataUrl -> id, this pass
  const walk = (v) => {
    if (typeof v === 'string') {
      if (!v.startsWith('data:image/')) return v;
      let id = byUrl.get(v);
      if (!id) {
        const base = hashImageId(v);
        id = base;
        for (let n = 2; ; n++) {
          const owner = assigned.has(id) ? assigned.get(id) : known.get(id);
          if (owner === undefined || owner === v) break;
          id = `${base}-${n}`;
        }
        assigned.set(id, v);
        byUrl.set(v, id);
        if (!known.has(id)) images.push([id, v]);
      }
      return IMGREF_PREFIX + id;
    }
    if (Array.isArray(v)) {
      let out = null;
      for (let i = 0; i < v.length; i++) {
        const w = walk(v[i]);
        if (w !== v[i] && !out) out = v.slice();
        if (out) out[i] = w;
      }
      return out ?? v;
    }
    if (v && typeof v === 'object') {
      let out = null;
      for (const k of Object.keys(v)) {
        const w = walk(v[k]);
        if (w !== v[k] && !out) out = { ...v };
        if (out) out[k] = w;
      }
      return out ?? v;
    }
    return v;
  };
  return { entity: walk(value), images };
}
// Reverse of extractImages: sentinels whose id exists in `images` (id →
// dataUrl) are replaced by the stored data URL (shared string instance);
// unknown refs and ref-shaped user text pass through untouched.
function rehydrateImages(value, images = new Map()) {
  const walk = (v) => {
    if (typeof v === 'string') {
      if (!v.startsWith(IMGREF_PREFIX)) return v;
      const m = IMGREF_RE.exec(v);
      if (!m) return v;
      const hit = images.get(m[1]);
      return hit !== undefined ? hit : v;
    }
    if (Array.isArray(v)) {
      let out = null;
      for (let i = 0; i < v.length; i++) {
        const w = walk(v[i]);
        if (w !== v[i] && !out) out = v.slice();
        if (out) out[i] = w;
      }
      return out ?? v;
    }
    if (v && typeof v === 'object') {
      let out = null;
      for (const k of Object.keys(v)) {
        const w = walk(v[k]);
        if (w !== v[k] && !out) out = { ...v };
        if (out) out[k] = w;
      }
      return out ?? v;
    }
    return v;
  };
  return walk(value);
}
// GC reference scan: collect every data:image/ string reachable in `value`
// (references into a Set, no copies). The storage layer compares rows by URL
// — NOT by re-hashing — so salted collision ids stay exact.
function collectImageUrls(value, into = new Set()) {
  const walk = (v) => {
    if (typeof v === 'string') { if (v.startsWith('data:image/')) into.add(v); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k]);
  };
  walk(value);
  return into;
}

// ---- connection profiles ---------------------------------------------------
// Named bundles of connection + model + sampler settings (Settings →
// Connection → Profiles). PROFILE_FIELDS is the exact allowlist copied both
// ways (draft → profile on save, profile → draft on apply), so unrelated
// settings never hitchhike and serverToken (per-device) is never stored.
const PROFILE_FIELDS = [
  'endpoint', 'apiKey',
  'auxEndpoint', 'auxApiKey', 'genEndpoint', 'genApiKey',
  'embedEndpoint', 'embedApiKey', 'imageEndpoint', 'imageApiKey',
  'model', 'auxModel', 'genModel', 'imageModel', 'embeddingModel',
  'samplers', 'disabledSamplers', 'customSamplers',
];
// Snapshot the profiled fields out of a settings object (draft or live).
function profileFromSettings(st) {
  const fields = {};
  for (const k of PROFILE_FIELDS) if (st?.[k] !== undefined) fields[k] = st[k];
  return fields;
}
// Overlay a profile's fields onto a settings object; unknown keys in the
// profile are ignored. Returns a new object — the input is never mutated.
function applyProfile(st, profile) {
  const out = { ...st };
  for (const k of PROFILE_FIELDS) if (profile?.fields?.[k] !== undefined) out[k] = profile.fields[k];
  return out;
}
// === PURE CORE END ===
