
import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { html } from 'htm/react';
import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

// ============================================================================
// THEMES — variable→value maps applied to documentElement (mikupad-style
// dynamic theming). Every theme sets the same keys; derived vars (--c-dim,
// --c-faint, --c-accent-dim, --c-border) are computed in static CSS from
// these, so adding a theme is just a new entry here.
// ============================================================================
const THEMES = {
  miku: {
    name: 'Dark (default)',
    vars: {
      'color-scheme': 'dark',
      '--c-bg-0': 'oklch(0.18 0.020 60)',
      '--c-bg-1': 'oklch(0.22 0.020 60)',
      '--c-bg-2': 'oklch(0.29 0.025 60)',
      '--c-bg-3': 'oklch(0.36 0.030 60)',
      '--c-chrome': 'oklch(0.22 0.020 60)',
      '--c-text': 'oklch(0.95 0.040 70)',
      '--c-accent': 'oklch(0.75 0.120 70)',
      '--c-danger': 'oklch(0.65 0.20 25)',
      '--c-warning': 'oklch(0.80 0.15 80)',
      '--c-pin': 'oklch(0.80 0.15 80)',
      '--c-user': 'oklch(0.78 0.10 65)',
      '--c-action': 'oklch(0.74 0.05 75)',
      '--c-dialogue': 'oklch(0.95 0.040 70)',
      '--c-good': 'oklch(0.78 0.12 155)',
      '--c-ooc': 'oklch(0.70 0.04 75)',
      '--c-speaker-s': '65%',
      '--c-speaker-l': '72%',
      '--font-prose': 'system-ui, sans-serif',
    },
  },
  'ctp-mocha': {
    name: 'Catppuccin Mocha', accentable: true,
    vars: {
      'color-scheme': 'dark',
      '--c-bg-0': '#181825', '--c-bg-1': '#1e1e2e', '--c-bg-2': '#313244', '--c-bg-3': '#45475a', '--c-chrome': '#1e1e2e',
      '--c-text': '#cdd6f4',
      '--c-danger': '#f38ba8',
      '--c-warning': '#f9e2af',
      '--c-pin': '#f9e2af',
      '--c-action': '#a6adc8',
      '--c-ooc': '#a6adc8',
      '--c-speaker-s': '60%',
      '--c-speaker-l': '72%',
      '--font-prose': 'system-ui, sans-serif',
    },
  },
  'ctp-macchiato': {
    name: 'Catppuccin Macchiato', accentable: true,
    vars: {
      'color-scheme': 'dark',
      '--c-bg-0': '#1e2030', '--c-bg-1': '#24273a', '--c-bg-2': '#363a4f', '--c-bg-3': '#494d64', '--c-chrome': '#24273a',
      '--c-text': '#cad3f5',
      '--c-danger': '#ed8796',
      '--c-warning': '#eed49f',
      '--c-pin': '#eed49f',
      '--c-action': '#a5adcb',
      '--c-ooc': '#a5adcb',
      '--c-speaker-s': '60%',
      '--c-speaker-l': '72%',
      '--font-prose': 'system-ui, sans-serif',
    },
  },
  'ctp-frappe': {
    name: 'Catppuccin Frappé', accentable: true,
    vars: {
      'color-scheme': 'dark',
      '--c-bg-0': '#292c3c', '--c-bg-1': '#303446', '--c-bg-2': '#414559', '--c-bg-3': '#51576d', '--c-chrome': '#303446',
      '--c-text': '#c6d0f5',
      '--c-danger': '#e78284',
      '--c-warning': '#e5c890',
      '--c-pin': '#e5c890',
      '--c-action': '#a5adce',
      '--c-ooc': '#a5adce',
      '--c-speaker-s': '60%',
      '--c-speaker-l': '72%',
      '--font-prose': 'system-ui, sans-serif',
    },
  },
};

// Official Catppuccin accent colors per flavor (https://catppuccin.com/palette).
// On accentable themes the chosen accent drives --c-accent / --c-user /
// --c-dialogue (quotes, names on bubbles, buttons/highlights). Default: mauve
// (the pink/lavender of the palette).
const CTP_ACCENTS = {
  'ctp-mocha': {
    rosewater: '#f5e0dc', flamingo: '#f2cdcd', pink: '#f5c2e7', mauve: '#cba6f7',
    red: '#f38ba8', maroon: '#eba0ac', peach: '#fab387', yellow: '#f9e2af',
    green: '#a6e3a1', teal: '#94e2d5', sky: '#89dceb', sapphire: '#74c7ec',
    blue: '#89b4fa', lavender: '#b4befe',
  },
  'ctp-macchiato': {
    rosewater: '#f4dbd6', flamingo: '#f0c6c6', pink: '#f5bde6', mauve: '#c6a0f6',
    red: '#ed8796', maroon: '#ee99a0', peach: '#f5a97f', yellow: '#eed49f',
    green: '#a6da95', teal: '#8bd5ca', sky: '#91d7e3', sapphire: '#7dc4e4',
    blue: '#8aadf4', lavender: '#b7bdf8',
  },
  'ctp-frappe': {
    rosewater: '#f2d5cf', flamingo: '#eebebe', pink: '#f4b8e4', mauve: '#ca9ee6',
    red: '#e78284', maroon: '#ea999c', peach: '#ef9f76', yellow: '#e5c890',
    green: '#a6d189', teal: '#81c8be', sky: '#99d1db', sapphire: '#85c1dc',
    blue: '#8caaee', lavender: '#babbf1',
  },
};
const DEFAULT_ACCENT = 'mauve';

function applyTheme(id, accentId = DEFAULT_ACCENT) {
  const theme = THEMES[id] ?? THEMES.miku;
  const style = document.documentElement.style;
  for (const [k, v] of Object.entries(theme.vars)) style.setProperty(k, v);
  if (theme.accentable) {
    const palette = CTP_ACCENTS[id] ?? {};
    const hex = palette[accentId] ?? palette[DEFAULT_ACCENT];
    for (const v of ['--c-accent', '--c-user', '--c-dialogue']) style.setProperty(v, hex);
    style.setProperty('--c-good', palette.green ?? '#a6e3a1');
  } else {
    // restore the theme's own values if an accentable theme set them before
    for (const v of ['--c-accent', '--c-user', '--c-dialogue', '--c-good']) style.removeProperty(v);
    for (const [k, v2] of Object.entries(theme.vars)) style.setProperty(k, v2);
  }
}

// ============================================================================
// RP PROSE + SPEAKER helpers.
// ============================================================================
// Wrap quoted dialogue in <span class="dialogue"> before markdown parsing
// (marked passes inline HTML through). Skips fenced code blocks; quotes inside
// inline `code` spans still get wrapped (accepted limitation).
// A straight quote only OPENS dialogue when it looks like one: not after a
// letter/digit (5ft8", rock"in') and not before whitespace/end — otherwise a
// stray inch-mark would pair with the next real quote and eat the text in
// between. Unterminated quotes are left raw — except with closeOpen (live
// streaming), where an opener with no closer yet wraps to end-of-line so the
// partial sentence colours as it arrives; the final render shows the raw truth.
// Curly “…” pairs unambiguously.
function wrapDialogue(md, closeOpen = false) {
  let inFence = false;
  return String(md ?? '').split('\n').map(line => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return line; }
    if (inFence) return line;
    let out = '', i = 0;
    while (i < line.length) {
      const ch = line[i];
      const opens = ch === '“' || (ch === '"'
        && !/[\p{L}\p{N}]/u.test(line[i - 1] ?? '')
        && !/[\s"“]/.test(line[i + 1] ?? ' '));
      if (!opens) { out += ch; i++; continue; }
      const end = line.indexOf(ch === '“' ? '”' : '"', i + 1);
      if (end === -1) {
        if (closeOpen) { out += `<span class="dialogue">${line.slice(i)}</span>`; break; }
        out += ch; i++; continue;
      }
      out += `<span class="dialogue">${line.slice(i, end + 1)}</span>`;
      i = end + 1;
    }
    return out;
  }).join('\n');
}

// Streaming-only display tweak: tentatively close unterminated emphasis so a
// partial reply formats as it grows (`*she wav` renders italic immediately).
// Only closes when real content follows the opener — a lone trailing `*` stays
// literal instead of flickering into an empty `**`. The final (non-streaming)
// render uses the raw text, so if the model never closes the marker the
// formatting simply snaps back off.
function autoCloseProse(text) {
  const s = String(text ?? '');
  const scan = s.replace(/\\./g, 'x'); // escaped chars can't delimit emphasis
  let out = s;
  if ((scan.match(/\*\*/g) ?? []).length % 2 === 1
    && /[^\s*]/.test(scan.slice(scan.lastIndexOf('**') + 2))) out += '**';
  if ((scan.replace(/\*\*/g, '').match(/\*/g) ?? []).length % 2 === 1
    && /[^\s*]/.test(scan.slice(scan.lastIndexOf('*') + 1))) out += '*';
  return out;
}

// Heuristic speaker attribution: does the text start with a known character
// name (titles of enabled character-type lore pieces) as `Name:`, `**Name:**`,
// `*Name*:`, `**Name**` or `*Name*`? Returns the matching name, or null.
// Unreliable when the model doesn't prefix names — purely cosmetic.
function detectSpeaker(text, names) {
  if (!text || !names?.length) return null;
  const m = /^\s*\*{0,2}\s*([\p{L}][\p{L}\p{M}'. \-]{0,39}?)\s*\*{0,2}\s*:/u.exec(text)
        ?? /^\s*\*{1,2}\s*([\p{L}][\p{L}\p{M}'. \-]{0,39}?)\s*\*{1,2}/u.exec(text);
  if (!m) return null;
  const candidate = m[1].trim().toLowerCase();
  return names.find(n => n.toLowerCase() === candidate) ?? null;
}

const characterNamesOf = (scenario, chat = null, characters = null) =>
  mergedLorePieces(scenario, chat, characters)
    .filter(p => p.type === 'character' && p.enabled !== false)
    .map(p => p.title?.trim())
    .filter(Boolean);

// Remove the leading `Name:` / `**Name:**` / `*Name*` speaker prefix for
// display — the meta row already labels who is speaking, so showing the
// prefix in the bubble too breaks immersion. Stars AFTER the colon are only
// stripped when they close a bold prefix (`**Name:**` — stars followed by
// whitespace/EOL), never an action's opening star: in `Mia:\n*does a thing*`
// or `Mia: *waves*` the old `\s*\*{0,2}\s*` crossed the newline / ate the `*`
// and left the emphasis unpaired.
function stripSpeakerPrefix(text, name) {
  if (!text || !name) return text;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`^\\s*\\*{0,2}\\s*${esc}\\s*\\*{0,2}\\s*:(?:[ \\t]*\\*{1,2}(?=\\s|$))?\\s*`, 'i').exec(text)
        ?? new RegExp(`^\\s*\\*{1,2}\\s*${esc}\\s*\\*{1,2}\\s*`, 'i').exec(text);
  return m ? text.slice(m[0].length) : text;
}

const hueForName = (name) => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
};

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
const subUser = (text, personaName) =>
  String(text ?? '').replace(/\{\{user\}\}/gi, personaName || 'User');
// {{var:name}} story variables (v2.0d): per-chat key/value store written by the
// set_var tool action; unknown variables substitute to empty.
const subVars = (text, vars) =>
  String(text ?? '').replace(/\{\{var:([^}]+)\}\}/gi, (_, k) => String(vars?.[k.trim()] ?? ''));

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
// Tool-written lore (createdAt-tagged, v2.0b) rolls back with the same cutoff;
// hand-authored pieces (no createdAt) always survive.
function rewindChat(chat, nodeId) {
  const node = chat.messages[nodeId];
  if (!node) return chat;
  const cutoff = node.swipes[node.activeSwipe]?.createdAt ?? Date.now();
  const memories = (chat.memoryStore?.memories ?? []).filter(m => m.createdAt <= cutoff);
  const lorePieces = Array.isArray(chat.lorePieces)
    ? chat.lorePieces.filter(p => (p.createdAt ?? 0) <= cutoff) : chat.lorePieces;
  const next = {
    ...chat, activeLeafId: nodeId, memoryStore: { memories, cursor: 0 },
    ...(lorePieces !== chat.lorePieces ? { lorePieces } : {}),
  };
  next.memoryStore.cursor = getActivePath(next.messages, nodeId).length;
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
function selectLore(lorePieces, conversationText, budgetTokens, preActivated = null, opts = {}) {
  const candidates = [...scanLore(lorePieces, conversationText, preActivated, opts).values()].map(a => ({
    id: a.piece.id,
    title: a.piece.title ?? '',
    content: a.piece.content ?? '',
    type: a.piece.type ?? 'lore',
    reason: a.reason,
    boost: a.boost,
    effWeight: (Number(a.piece.weight) || 0) + a.boost,
    tokens: estimateTokens(`${a.piece.title ?? ''}\n${a.piece.content ?? ''}`, opts.chars),
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

// Per-chat scenario overlay (v2.0a): chat.lorePieces merge over the
// scenario's by id — the chat wins, including enabled:false to switch a
// scenario piece off for one chat only; chat-only pieces append after the
// scenario's. This is where model-generated characters/lore land (v2.0b+)
// and the "edit the scenario of this chat" surface. Branches inherit a copy
// via branchChat's deepClone. Linked global characters (v2.1) slot in after
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
  // Author's note: per-chat sticky steering, appended to by the note tool
  // action (v2.0d), editable in chat settings.
  const authorsNote = sub(chat?.authorsNote ?? '').trim();
  if (authorsNote) tailParts.push(`Author's note: ${authorsNote}`);
  // Length directive: user-editable in settings; falls back to the preset's
  // default text when unset (existing installs keep current behavior).
  const directive = (settings.lengthDirective ?? LENGTH_PRESETS[settings.responseLength ?? 'medium']?.directive)?.trim();
  if (directive) tailParts.push(directive);
  // /pov reframe: one generation written from another character's perspective.
  const povName = String(pov?.name ?? '').trim();
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
  //    overlay, chat wins on id)
  const loreCap = Math.floor(budget * caps.lore);
  const lorePieces = mergedLorePieces(scenario, chat, characters);
  const chatPieceIds = new Set(
    (Array.isArray(chat?.lorePieces) ? chat.lorePieces : []).map(p => p?.id).filter(Boolean));
  // Resolved global-character ids — selectLore strips extra piece fields, so
  // origin is recovered by id, not from the selected candidate. A chat overlay
  // piece shadowing a global character still reports 'chat'.
  const charPieceIds = new Set(resolveCharacters(scenario, chat, characters).map(p => p.id));
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
  const loreScanned = scanLore(lorePieces, conversationText, preAct, loreOpts);
  const loreSel = selectLore(lorePieces, conversationText, loreCap, preAct, loreOpts);
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
      tokens: est(`${p.title ?? ''}\n${p.content ?? ''}`),
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

  // 4. memory layer: pinned first (oldest→newest), then recent unpinned
  const memCap = Math.floor(budget * caps.memory);
  const memAll = Array.isArray(chat?.memoryStore?.memories) ? chat.memoryStore.memories : [];
  const memOrdered = [
    ...memAll.filter(m => m.pinned).sort((a, b) => a.createdAt - b.createdAt),
    ...memAll.filter(m => !m.pinned).sort((a, b) => b.createdAt - a.createdAt),
  ];
  const memSel = [];
  let memUsed = 0;
  for (const m of memOrdered) {
    const cost = est(m.text);
    if (memUsed + cost > memCap) continue;
    memSel.push(m);
    memUsed += cost;
  }
  const memText = memSel.length ? `[Memories]\n${memSel.map(m => `- ${m.text}`).join('\n')}` : '';
  const memTokens = memText ? est(memText) : 0;
  manifest.layers.memory = {
    tokens: memTokens, cap: memCap,
    memories: memSel.map(m => ({ id: m.id, pinned: !!m.pinned, tokens: est(m.text), preview: toPreview(m.text), text: m.text ?? '' })),
  };

  // 5. history fills the remainder; oldest messages dropped first
  const historyCap = Math.max(0, budget - staticTokens - loreTokens - memTokens - greetingTokens);
  const kept = [];
  let histUsed = 0;
  for (let i = historyNodes.length - 1; i >= 0; i--) {
    const cost = est(activeText(historyNodes[i]));
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

// ---- tool calls (v2.0b) ---------------------------------------------------
// Prompt-based protocol: the platform prompt teaches the model to emit
//   ```tool
//   {"name": "…", "args": {…}}
//   ```
// blocks mid-reply. Works on any OpenAI-compatible endpoint — no tools param,
// no extra round-trip, middleware-transparent. Blocks are stripped from
// display text and executed app-side against the per-chat lore overlay
// (v2.0a). An unterminated fence is never a call (partial stream or model
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
  // Trailing unterminated fence: last ```tool occurrence that doesn't start a
  // complete (removed) block.
  let cut = s.length;
  let p = s.lastIndexOf('```tool');
  while (p !== -1) {
    if (!removed.some(([a]) => a === p)) { cut = p; break; }
    p = p > 0 ? s.lastIndexOf('```tool', p - 1) : -1;
  }
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
// New pieces are tagged { createdAt: now, createdBy: nodeId } — provenance for
// rewind rollback (timestamp cutoff, like memories) and regenerate pruning
// (pruneToolPieces). Updates keep the original piece's provenance.
// opts.queueLore: add_lore calls for NEW titles go to the review queue
// (emergent-lore 'queue' mode) instead of straight into lorePieces.
// opts.customTools: user-defined tools (Settings) — action aliases for the
// built-ins plus 'note' (author's note) and 'set_var' (story variable).
function applyToolCalls(chat, calls, { cap = TOOL_CALL_CAP, ...opts } = {}) {
  let work = chat;
  const results = [];
  let applied = 0;
  for (const c of calls ?? []) {
    if (c.error) { results.push({ name: '(unparsed)', args: {}, ok: false, note: `${c.error}: ${c.raw ?? ''}` }); continue; }
    if (applied >= cap) { results.push({ name: c.name, args: c.args, ok: false, note: 'call cap reached' }); continue; }
    const r = applyToolCall(work, c, opts);
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

// ---- emergent lore review queue (v2.0d) ------------------------------------
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
    wholeWord: false, caseSensitive: false, smart: false, hidden: false, playable: false,
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

function applyToolCall(chat, call, { nodeId = null, now = Date.now(), queueLore = false, customTools = [] } = {}) {
  const fail = (note) => ({ ok: false, note, chat });
  const args = call?.args ?? {};
  const pieces = Array.isArray(chat?.lorePieces) ? chat.lorePieces : [];
  const base = {
    pinned: false, weight: 0, links: [], enabled: true, searchDepth: null,
    wholeWord: false, caseSensitive: false, smart: false, hidden: false, playable: false,
  };
  const save = (lorePieces, note) => ({ ok: true, note, chat: { ...chat, lorePieces } });
  const provenance = { createdAt: now, createdBy: nodeId };
  if (call.name === 'register_character') {
    const cname = String(args.name ?? '').trim().slice(0, TOOL_NAME_MAX);
    const desc = String(args.description ?? args.content ?? '').trim().slice(0, TOOL_TEXT_MAX);
    if (!cname) return fail('register_character: name required');
    if (!desc) return fail('register_character: description required');
    const existing = pieces.find(p => p.type === 'character'
      && (p.title ?? '').trim().toLowerCase() === cname.toLowerCase());
    if (existing)
      return save(pieces.map(p => p.id === existing.id ? { ...p, content: desc } : p),
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
    const existing = pieces.find(p => (p.type ?? 'lore') === 'lore'
      && (p.title ?? '').trim().toLowerCase() === title.toLowerCase());
    if (existing)
      return save(pieces.map(p => p.id === existing.id ? { ...p, content, ...(keys.length ? { keys } : {}) } : p),
        `updated lore "${title}"`);
    // Emergent-lore 'queue' mode: new titles wait for user review.
    if (queueLore)
      return { ok: true, note: `queued lore "${title}" for review`,
        chat: queueLorePiece(chat, { title, content, keys, source: 'tool', createdAt: now }) };
    return save([...pieces, { ...base, ...provenance, id: uid(), type: 'lore', title, content, keys }],
      `added lore "${title}"`);
  }
  // User-defined custom tools (Settings → custom tools). Built-in names are
  // reserved — a custom def can never shadow register_character / add_lore.
  const def = customTools.find(t => t?.name?.trim() === call.name);
  if (def) {
    if (def.action === 'register_character' || def.action === 'add_lore')
      return applyToolCall(chat, { name: def.action, args: call.args }, { nodeId, now, queueLore, customTools });
    if (def.action === 'note') {
      const text = String(args.text ?? '').trim().slice(0, TOOL_TEXT_MAX);
      if (!text) return fail(`${def.name}: text required`);
      const authorsNote = [String(chat?.authorsNote ?? '').trim(), text].filter(Boolean).join('\n');
      return { ok: true, note: 'author\'s note updated', chat: { ...chat, authorsNote } };
    }
    if (def.action === 'set_var') {
      const vname = String(args.name ?? '').trim().slice(0, TOOL_NAME_MAX);
      if (!vname) return fail(`${def.name}: name required`);
      const value = String(args.value ?? '').slice(0, TOOL_TEXT_MAX);
      return { ok: true, note: `set {{var:${vname}}}`, chat: { ...chat, vars: { ...(chat?.vars ?? {}), [vname]: value } } };
    }
    return fail(`tool "${def.name}" has unknown action "${def.action}"`);
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
Rules: the JSON field for the tool is "tool", never "name"; emit a block at the moment the character or thing enters the narrative, then continue the story; never register {{user}}; at most one tool block per reply unless several newcomers appear at once; never mention tool blocks in the prose.`;

// ---- multi-speaker segments (v2.0c) ----------------------------------------
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
  const re = /^\s*\*{0,2}\s*([\p{L}][\p{L}\p{M}'. \-]{0,39}?)\s*\*{0,2}\s*:(?:[ \t]*\*{1,2}(?=\s|$))?\s*/u;
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
const SPEAKER_PROMPT = `When several named characters are in the scene, you may reply for more than one of them in a single turn: start each character's part with their name and a colon on its own line ("Vex: …"), in the order they speak or act. Narration needs no prefix at the start of the reply; after a character's part, resume it with "Narrator:" on its own line. Give each character at most one part per reply.`;

// Default aux-task prompts (user-editable in Settings → Prompts). {{user}} is
// substituted with the persona name at call time; the suggestions prompt also
// takes {{count}} and {{words}}.
const DEFAULT_SUGGESTIONS_PROMPT = 'You suggest what the user\'s character ({{user}}) might say or do next in this roleplay. Reply with exactly {{count}} options as a numbered list, one per line, at most {{words}} words each, written in first person as {{user}}. In-character; do not narrate other characters\' actions; no commentary.';
const DEFAULT_MEMORY_PROMPT = 'You keep memory notes for an ongoing roleplay. Summarize the key recent events, revealed facts, and relationship changes as compact plain prose of at most 500 characters. Past events only; no speculation; no lists; no formatting.';
const DEFAULT_LORE_EXTRACT_PROMPT = 'You maintain the lorebook of an ongoing roleplay. Extract up to 3 NEW lasting facts about the world, places, objects, or factions from the recent conversation — long-term reference material, not momentary events, and never facts already in the existing lore. Reply with a JSON array only: [{"title":"…","content":"…","keys":["…"]}] — or [] if nothing qualifies.';
const DEFAULT_IMPROVE_PROMPT = 'Rewrite the user\'s draft in first person as {{user}}, matching the roleplay\'s tone. Output only the rewritten text.';
const DEFAULT_RECAP_PROMPT = 'Summarize the following roleplay excerpt into a cohesive recap in third person, past tense, at most 400 words. Output only the recap.';
// === PURE CORE END ===

// ============================================================================
// STORAGE — AbstractStorage (EventTarget + 500 ms debounced save queue) with
// an IndexedDB adapter. Entities are stored one-key-per-entity; the adapter
// keeps an in-memory cache that React reads synchronously.
// ============================================================================
const STORES = ['Scenarios', 'Personas', 'Chats', 'Meta', 'Characters'];

class AbstractStorage extends EventTarget {
  constructor() {
    super();
    this.cache = Object.fromEntries(STORES.map(s => [s, {}]));
    this.saveQueue = new Map();
    this.saveTimer = null;
    this.retryTimer = null;
    // Connectivity restored → flush any re-queued writes immediately.
    if (typeof window !== 'undefined')
      window.addEventListener('online', () => this.flush());
  }
  async init() {}
  getAll(store) { return this.cache[store] ?? {}; }
  get(store, key) { return this.cache[store]?.[key]; }
  set(store, key, value) {
    this.cache[store][key] = value;
    this.saveQueue.set(`${store}/${key}`, { op: 'put', store, key, value });
    this.#schedule();
    this.dispatchEvent(new CustomEvent('storechange', { detail: { store, key } }));
  }
  remove(store, key) {
    delete this.cache[store][key];
    this.saveQueue.set(`${store}/${key}`, { op: 'delete', store, key });
    this.#schedule();
    this.dispatchEvent(new CustomEvent('storechange', { detail: { store, key } }));
  }
  #schedule() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 500);
  }
  async flush() {
    clearTimeout(this.saveTimer);
    clearTimeout(this.retryTimer);
    const items = [...this.saveQueue.values()];
    this.saveQueue.clear();
    let failed = false;
    for (const item of items) {
      try {
        if (item.op === 'put') await this.persistPut(item.store, item.key, item.value);
        else await this.persistDelete(item.store, item.key);
      } catch (e) {
        console.error('FictionPad: persist failed', e);
        // Re-queue instead of dropping — edits made while the server is
        // unreachable must survive. Keyed by store/key, so re-adding an item
        // that was re-set while we were flushing never duplicates work.
        if (!this.saveQueue.has(`${item.store}/${item.key}`))
          this.saveQueue.set(`${item.store}/${item.key}`, item);
        failed = true;
      }
    }
    if (failed !== (this._retrying ?? false)) {
      this._retrying = failed;
      this.dispatchEvent(new CustomEvent('savestate', { detail: { retrying: failed } }));
    }
    if (failed) this.retryTimer = setTimeout(() => this.flush(), 5000); // backoff retry (also retried on 'online')
  }
  async persistPut() {}
  async persistDelete() {}
}

class IndexedDBAdapter extends AbstractStorage {
  constructor(dbName = 'FictionPad') {
    super();
    this.dbName = dbName;
    this.db = null;
  }
  async init() {
    this.db = await new Promise((resolve, reject) => {
      // v2 added the Characters store; onupgradeneeded creates any missing
      // store idempotently, so old v1 databases upgrade cleanly.
      const req = indexedDB.open(this.dbName, 2);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        for (const s of STORES)
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
    });
    for (const s of STORES) this.cache[s] = await this.#readAll(s);
    try {
      if (navigator.storage?.persist && !(await navigator.storage.persisted()))
        await navigator.storage.persist();
    } catch {}
  }
  #readAll(store) {
    return new Promise((resolve, reject) => {
      const out = {};
      const req = this.db.transaction(store, 'readonly').objectStore(store).openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { out[cursor.key] = cursor.value; cursor.continue(); }
        else resolve(out);
      };
      req.onerror = () => reject(req.error);
    });
  }
  persistPut(store, key, value) {
    if (!this.db) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const req = this.db.transaction(store, 'readwrite').objectStore(store).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
  persistDelete(store, key) {
    if (!this.db) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const req = this.db.transaction(store, 'readwrite').objectStore(store).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

// Server storage adapter (mikupad ServerDBAdapter pattern): same interface as
// IndexedDBAdapter — the debounced save queue and synchronous cache reads in
// AbstractStorage are shared, so React never knows which backend is active.
// init() throws when the server doesn't speak the storage protocol → boot
// falls back to IndexedDB (fresh browsers) or shows the blocking server gate
// (browsers that were previously on server storage — see App).
class ServerDBAdapter extends AbstractStorage {
  constructor(serverToken = '') {
    super();
    this.serverToken = serverToken;
  }
  #headers() {
    return {
      'Content-Type': 'application/json',
      ...(this.serverToken ? { 'Authorization': `Bearer ${this.serverToken}` } : {}),
    };
  }
  // A Bearer token the server doesn't actually require (e.g. a stale token on
  // a Basic-auth deployment) earns a 401; retry bare once so the browser's
  // cached Basic creds take over before we give up.
  async #fetch(route, opts = {}) {
    const headers = this.#headers();
    let res = await fetch(route, { ...opts, headers });
    if (res.status === 401 && headers.Authorization) {
      const { Authorization, ...bare } = headers;
      res = await fetch(route, { ...opts, headers: bare });
    }
    return res;
  }
  async #post(route, body) {
    const res = await this.#fetch(route, { method: 'POST', body: JSON.stringify(body ?? {}) });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = (await res.json())?.error ?? msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  }
  async init() {
    const res = await this.#fetch('/version');
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status; // 401 → wrong/missing FICTIONPAD_TOKEN (boot gate shows a token field)
      throw err;
    }
    const info = await res.json();
    if (info?.version !== 1 || info?.storage !== true) throw new Error('not a FictionPad storage server');
    for (const s of STORES) this.cache[s] = await this.remoteAll(s);
  }
  async persistPut(store, key, value) { await this.#post('/save', { store, key, data: value }); }
  async persistDelete(store, key) { await this.#post('/delete', { store, key }); }
  // Used by the settings migration helpers.
  async remoteAll(store) { return (await this.#post('/all', { store })).entries ?? {}; }
  async remoteSave(store, key, data) { await this.#post('/save', { store, key, data }); }
}

// ============================================================================
// BACKEND — OpenAI-compatible chat completions only. Endpoint normalization,
// hand-rolled SSE parser, AbortController cancel, normalized { content } chunks.
// ============================================================================
function normalizeEndpoint(url) {
  return String(url ?? '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1\/(chat\/completions|models)$/i, '')
    .replace(/\/v1$/i, '');
}
const chatCompletionsURL = (ep) => `${normalizeEndpoint(ep)}/v1/chat/completions`;
const modelsURL = (ep) => `${normalizeEndpoint(ep)}/v1/models`;
// True when the endpoint goes through OUR server's /proxy/ (same-origin).
// Relative '/proxy/…' is same-origin by construction; absolute URLs must match.
function isServerProxy(endpoint) {
  const ep = String(endpoint ?? '');
  if (ep.startsWith('/proxy/')) return true;
  try {
    const u = new URL(ep, location.href);
    return u.origin === location.origin && u.pathname.startsWith('/proxy/');
  } catch { return false; }
}

// "Route API requests through the server": rewrite the configured endpoint to
// a relative /proxy/ URL at request time (never persisted). Only when server
// storage is active AND the toggle is on; empty and hand-written /proxy/
// endpoints pass through unchanged.
function effectiveEndpoint(settings, serverStorageActive) {
  const ep = String(settings?.endpoint ?? '');
  if (!ep || ep.startsWith('/proxy/')) return ep;
  return serverStorageActive && settings?.routeViaServer !== false ? `/proxy/${ep}` : ep;
}

// LLM credential header. Through our own (possibly Basic-authed) proxy the
// browser already attaches the server's Basic creds to same-origin fetches —
// so the LLM key travels as X-Real-Authorization, which the proxy maps to the
// upstream Authorization header (and never leaks the Basic creds upstream).
// When the server instead gates with FICTIONPAD_TOKEN (Bearer, no Basic), the
// proxy requires that token too — send serverToken as Authorization, exactly
// like the storage routes do.
const authHeaders = (apiKey, endpoint, serverToken = '') => {
  if (!isServerProxy(endpoint)) return apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};
  return {
    ...(apiKey ? { 'X-Real-Authorization': `Bearer ${apiKey}` } : {}),
    ...(serverToken ? { 'Authorization': `Bearer ${serverToken}` } : {}),
  };
};

// Same-origin /proxy requests carry the serverToken as Bearer; on a
// Basic-auth deployment (or with a stale token) that Bearer 401s — retry
// once without it so the browser's cached Basic creds take over. Direct
// (non-proxy) endpoints never retry: their Authorization is the LLM key.
async function fetchAPI(endpoint, url, opts = {}) {
  let res = await fetch(url, opts);
  if (res.status === 401 && isServerProxy(endpoint) && opts.headers?.Authorization) {
    const headers = { ...opts.headers };
    delete headers.Authorization;
    res = await fetch(url, { ...opts, headers });
  }
  return res;
}

async function listModels({ endpoint, apiKey, serverToken, signal } = {}) {
  const res = await fetchAPI(endpoint, modelsURL(endpoint), { headers: { ...authHeaders(apiKey, endpoint, serverToken) }, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return (json.data ?? []).map(m => m.id).filter(Boolean).sort();
}

// Minimal SSE parser: line-based, only data: fields, JSON payloads.
// getReader()+TextDecoder instead of pipeThrough(TextDecoderStream): some
// mobile WebKit builds lack ReadableStream.pipeThrough / TextDecoderStream.
async function* parseEventStream(body) {
  let buf = '';
  const take = function* (line) {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    const json = JSON.parse(data);
    if (json.error?.message) throw new Error(json.error.message);
    yield json;
  };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = (buf + decoder.decode(value, { stream: true })).split(/\r\n|\r|\n/);
      buf = lines.pop();
      for (const line of lines) yield* take(line);
    }
    buf += decoder.decode();
    if (buf) yield* take(buf);
  } finally {
    reader.releaseLock();
  }
}

// Normalized async-generator chunk stream. Two separate streams, because a
// chunk's delta text and its logprob tokens are NOT reliably related (a
// middleware may re-chunk deltas into arbitrary byte windows and attach
// logprob entries off by one position — observed in the wild):
//   { content }  — display text; delta.content is the sole authority
//   { lp: [{ token, logprob, top }] } — raw logprob tape entries, no content
// Consumers display/accumulate content and collect the lp tape separately;
// alignment against the text happens ONCE, globally, via alignTokensToSpans.
async function* openaiChatStream({ endpoint, apiKey, serverToken, model, messages, samplers = {}, maxTokens, signal, tokenProbs = false, topLogprobs = 10, logitBias = null, stop = null }) {
  const stopSet = Array.isArray(stop) && stop.length ? new Set(stop) : null;
  const res = await fetchAPI(endpoint, chatCompletionsURL(endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint, serverToken) },
    body: JSON.stringify({
      model, messages, stream: true, max_tokens: maxTokens, ...samplers,
      ...(tokenProbs ? { logprobs: true, top_logprobs: Math.max(1, Math.min(20, topLogprobs | 0 || 10)) } : {}),
      ...(logitBias && Object.keys(logitBias).length ? { logit_bias: logitBias } : {}),
      ...(stopSet ? { stop } : {}),
    }),
    signal,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const json = await res.json();
      msg = json?.error?.message ?? json?.message ?? msg;
    } catch {}
    throw new Error(msg);
  }
  for await (const json of parseEventStream(res.body)) {
    const choice = json.choices?.[0];
    // Chunks with no choices (e.g. a trailing usage-only chunk with
    // choices: []) carry nothing to yield — skip them.
    if (!choice) continue;
    // delta.content is the text authority — logprobs never alter it.
    const deltaText = choice?.delta?.content ?? choice?.message?.content;
    // Terminal chunk: report the finish reason so the caller can tell a clean
    // finish from a dropped connection (stream that just ends). A finish
    // chunk with empty/missing delta carries the sampled EOS in logprobs —
    // yield neither text nor tape for it.
    if (choice.finish_reason) {
      yield { done: true, finishReason: choice.finish_reason };
      if (!deltaText) continue;
    }
    if (deltaText && !stopSet?.has(deltaText)) yield { content: deltaText };
    // vLLM/OpenAI put logprobs at choice level; tolerate delta-nested too.
    const lpContent = choice?.logprobs?.content ?? choice?.delta?.logprobs?.content;
    if (Array.isArray(lpContent) && lpContent.length) {
      const tape = lpContent.filter(t => t?.token && !stopSet?.has(t.token)).map(t => ({
        token: t.token,
        logprob: t.logprob ?? null,
        top: (t.top_logprobs ?? []).slice(0, Math.max(1, Math.min(20, topLogprobs | 0 || 10)))
          .map(x => ({ token: x.token, logprob: x.logprob ?? null })),
      }));
      if (tape.length) yield { lp: tape };
    }
  }
}

// Global alignment of the raw lp tape against the finished message text.
// Returns ProbsView spans [{ text, logprob, top }] covering `text` exactly,
// in order; spans without prob data get logprob: null. Runs once per
// generation (or abort), when both tapes are complete and alignment is
// unambiguous for the anchored cases:
//   exact  — tape tiles the text (healthy per-token streams)
//   suffix — tape covers the tail (middleware dropped leading entries, or
//            attached them off-by-one: tape = text minus a leading span)
//   prefix — tape covers the head only
//   greedy — anything else: match tokens in order, plain text in the gaps
function alignTokensToSpans(text, lpTape) {
  const toks = (lpTape ?? []).filter(t => t?.token);
  if (!text) return [];
  if (!toks.length) return [{ text, logprob: null, top: [] }];
  const plain = (text) => ({ text, logprob: null, top: [] });
  const span = (t) => ({ text: t.token, logprob: t.logprob ?? null, top: t.top ?? [] });
  const joined = toks.map(t => t.token).join('');
  if (joined === text) return toks.map(span);
  if (text.endsWith(joined)) {
    const pre = text.slice(0, text.length - joined.length);
    return [...(pre ? [plain(pre)] : []), ...toks.map(span)];
  }
  if (text.startsWith(joined)) return [...toks.map(span), plain(text.slice(joined.length))];
  const spans = [];
  let pos = 0, i = 0, gap = '';
  const flush = () => { if (gap) { spans.push(plain(gap)); gap = ''; } };
  while (pos < text.length) {
    if (i < toks.length && text.startsWith(toks[i].token, pos)) {
      flush();
      const t = toks[i++];
      spans.push(span(t));
      pos += t.token.length;
    } else {
      // Resync: find the best next match over a small lookahead, scored by
      // text gap + a cost per skipped tape entry. Without the skip cost a
      // dropped lp entry lets a DISTANT token (e.g. an "I" 100 tokens later)
      // match the current position and misaligns the rest of the message.
      let bestK = -1, bestJ = -1, bestScore = Infinity;
      for (let j = i; j < Math.min(toks.length, i + 5); j++) {
        let k = -1;
        if (j > i && text.startsWith(toks[j].token, pos)) k = pos; // drop tape entr(ies)
        else k = text.indexOf(toks[j].token, pos + 1);             // text gap, then match
        if (k === -1) continue;
        const score = (k - pos) + 4 * (j - i);
        if (score < bestScore) { bestScore = score; bestK = k; bestJ = j; }
      }
      const end = bestK === -1 ? text.length : bestK;
      gap += text.slice(pos, end);
      pos = end;
      if (bestK === -1) break;
      i = bestJ;
    }
  }
  flush();
  return spans;
}

// Tool replies: align the raw lp tape against the RAW text (which it tiles
// exactly), then project the spans through stripToolBlocksMapped's char map
// onto the stripped display text. Protocol-text spans vanish; a token that
// straddles a strip boundary keeps its prob on the surviving fragment(s)
// (approximation — fences almost always tokenize separately).
//   rawText  — the raw streamed text being aligned (may be a slice)
//   map      — map[strippedIdx] = rawIdx, absolute in the FULL raw reply
//   rawOffset — absolute raw index of rawText[0] (continuation base length)
// Returns spans tiling the stripped text, or null when they don't (map
// mismatch — caller falls back to plain alignment).
function alignStrippedToolSpans(rawText, lpTape, map, rawOffset, strippedText) {
  const rawSpans = alignTokensToSpans(rawText, lpTape);
  const inv = new Int32Array(rawOffset + rawText.length).fill(-1); // rawIdx → strippedIdx
  for (let i = 0; i < map.length; i++) inv[map[i]] = i;
  const spans = [];
  const pushPlain = (t) => {
    if (!t) return;
    const last = spans[spans.length - 1];
    if (last && last.logprob == null) last.text += t;
    else spans.push({ text: t, logprob: null, top: [] });
  };
  let pos = 0;
  for (const s of rawSpans) {
    const a = pos, b = pos + s.text.length;
    pos = b;
    let frag = '';
    const flushFrag = () => {
      if (!frag) return;
      if (s.logprob == null) pushPlain(frag);
      else spans.push({ text: frag, logprob: s.logprob, top: s.top });
      frag = '';
    };
    for (let i = a; i < b; i++) {
      if (inv[rawOffset + i] !== -1) frag += rawText[i];
      else flushFrag();
    }
    flushFrag();
  }
  return spans.map(s => s.text).join('') === strippedText ? spans : null;
}

// ---- /tokenize (vLLM; degrade to null when unavailable) ----
// Defensive about response shapes: {tokens:[ids]}, {tokens:["str"]},
// count-only {count}, or OpenAI-ish {data:{tokens}}. Cached per endpoint+model+text.
const tokenizeCache = new Map();
async function tokenize({ endpoint, apiKey, serverToken, model, prompt }) {
  const key = `${endpoint}|${model}|${prompt}`;
  if (tokenizeCache.has(key)) return tokenizeCache.get(key);
  if (tokenizeCache.size > 500) tokenizeCache.clear();
  let out = null;
  try {
    const res = await fetchAPI(endpoint, `${normalizeEndpoint(endpoint)}/tokenize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint, serverToken) },
      body: JSON.stringify({ model, prompt }),
    });
    if (res.ok) {
      const json = await res.json();
      const raw = json?.tokens ?? json?.data?.tokens ?? null;
      let ids = null, strings = null, count = null;
      if (Array.isArray(raw)) {
        count = raw.length;
        if (raw.every(t => Number.isInteger(t))) ids = raw;
        else if (raw.every(t => typeof t === 'string')) strings = raw;
      }
      if (Number.isFinite(json?.count)) count = json.count;
      if (count != null || ids || strings) out = { ids, strings, count };
    }
  } catch {}
  tokenizeCache.set(key, out);
  return out;
}

async function getTokenCount({ endpoint, apiKey, serverToken, model, text }) {
  const r = await tokenize({ endpoint, apiKey, serverToken, model, prompt: text });
  return r?.count ?? null;
}

// ---- /embeddings (OpenAI-style; semantic lore activation) ----
// Similarity threshold for smart lore activation — tune in one place.
const SEMANTIC_THRESHOLD = 0.55;
// Session-lifetime cache for piece embeddings: model|hash(text) → vector.
const embedCache = new Map();
const textHash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h.toString(36);
};

async function embed({ endpoint, apiKey, serverToken, model, inputs }) {
  const res = await fetchAPI(endpoint, `${normalizeEndpoint(endpoint)}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint, serverToken) },
    body: JSON.stringify({ model, input: inputs }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const json = await res.json();
      msg = json?.error?.message ?? json?.message ?? msg;
    } catch {}
    throw new Error(msg);
  }
  const json = await res.json();
  if (!Array.isArray(json?.data)) throw new Error('Malformed embeddings response');
  return [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(d => d.embedding);
}

// Cached single-text embedding (piece match texts change rarely).
async function embedCached({ endpoint, apiKey, serverToken, model, text }) {
  const key = `${model}|${textHash(text)}`;
  if (embedCache.has(key)) return embedCache.get(key);
  if (embedCache.size > 500) embedCache.clear();
  const [vec] = await embed({ endpoint, apiKey, serverToken, model, inputs: [text] });
  embedCache.set(key, vec);
  return vec;
}

const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a?.length ?? 0, b?.length ?? 0);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
};

// Single NON-streaming chat completion for auxiliary tasks (memory, recap,
// suggestions, /improve). Returns trimmed text; throws on HTTP/API errors.
async function auxCall({ endpoint, apiKey, serverToken, model, system, user, maxTokens = 300, temperature = 0.7, stop = null }) {
  const res = await fetchAPI(endpoint, chatCompletionsURL(endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint, serverToken) },
    body: JSON.stringify({
      model,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: user },
      ],
      stream: false,
      max_tokens: maxTokens,
      temperature,
      ...(Array.isArray(stop) && stop.length ? { stop } : {}),
    }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const json = await res.json();
      msg = json?.error?.message ?? json?.message ?? msg;
    } catch {}
    throw new Error(msg);
  }
  const json = await res.json();
  if (json?.error?.message) throw new Error(json.error.message);
  return String(json.choices?.[0]?.message?.content ?? '').trim();
}

// ============================================================================
// HOOKS — localStorage UI prefs + per-collection state over the storage layer.
// ============================================================================
function usePersistentState(name, initialState) {
  const [value, setValue] = useState(() => {
    if (typeof localStorage === 'undefined')
      return typeof initialState === 'function' ? initialState() : initialState;
    try {
      const raw = localStorage.getItem(name);
      if (raw != null) return JSON.parse(raw);
    } catch (e) { console.error(e); }
    return typeof initialState === 'function' ? initialState() : initialState;
  });
  const update = useCallback((next) => {
    setValue(prev => {
      const v = typeof next === 'function' ? next(prev) : next;
      if (typeof localStorage !== 'undefined')
        try { localStorage.setItem(name, JSON.stringify(v)); } catch (e) { console.error(e); }
      return v;
    });
  }, [name]);
  return [value, update];
}

function useStoredMap(storage, store) {
  const [map, setMap] = useState(() => storage.getAll(store));
  useEffect(() => {
    setMap({ ...storage.getAll(store) });
    const onChange = (e) => {
      if (e.detail?.store === store) setMap({ ...storage.getAll(store) });
    };
    storage.addEventListener('storechange', onChange);
    return () => storage.removeEventListener('storechange', onChange);
  }, [storage, store]);
  const upsert = useCallback((id, value) => {
    setMap(m => ({ ...m, [id]: value }));
    storage.set(store, id, value);
  }, [storage, store]);
  const remove = useCallback((id) => {
    setMap(m => { const c = { ...m }; delete c[id]; return c; });
    storage.remove(store, id);
  }, [storage, store]);
  return [map, upsert, remove];
}

// ============================================================================
// HELPERS — export/import, misc UI utilities.
// ============================================================================
function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function pickJSONFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try { resolve(JSON.parse(await file.text())); }
      catch (e) { resolve({ __error: String(e) }); }
    };
    input.click();
  });
}

// Date order is a user setting (settings.dateFormat), not locale-dependent.
const DATE_FORMATS = {
  'dd/mm/yyyy': (d, p) => `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`,
  'mm/dd/yyyy': (d, p) => `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()}`,
  'yyyy-mm-dd': (d, p) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
};
const fmtDate = (ts, fmt = 'dd/mm/yyyy') => {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${(DATE_FORMATS[fmt] ?? DATE_FORMATS['dd/mm/yyyy'])(d, p)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// ============================================================================
// ERROR BOUNDARY — a pane/dialog crash shows an inline box instead of React
// unmounting the whole root (which blanked the page before this existed).
// ============================================================================
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('FictionPad render error:', error, info); }
  render() {
    if (this.state.error) return html`
      <div class="errbox">
        <div><b>Render error${this.props.name ? ` — ${this.props.name}` : ''}</b></div>
        <pre>${String(this.state.error?.message ?? this.state.error)}</pre>
        <button class="btn small" onClick=${() => this.setState({ error: null })}>Dismiss</button>
      </div>`;
    return this.props.children;
  }
}

function Markdown({ text, prose = false, streaming = false }) {
  const rendered = useMemo(() => {
    // Live stream: tentatively close unterminated emphasis/dialogue so the
    // partial reply formats as it grows; the final render uses the raw text.
    const t = prose && streaming ? autoCloseProse(text ?? '') : (text ?? '');
    return marked.parse(prose ? wrapDialogue(t, streaming) : t);
  }, [text, prose, streaming]);
  return html`<div class="md" dangerouslySetInnerHTML=${{ __html: rendered }} />`;
}

function Modal({ title, onClose, wide, cls, children, footer }) {
  return html`
    <div class="modal-overlay" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal ${wide ? 'wide' : ''} ${cls ?? ''}">
        <div class="m-head">
          <h2>${title}</h2>
          <button class="btn ghost" onClick=${onClose}>✕</button>
        </div>
        <div class="m-body">${children}</div>
        ${footer && html`<div class="m-foot">${footer}</div>`}
      </div>
    </div>`;
}

// Number input that allows free typing and commits a clamped value on
// blur/Enter — clamping on every keystroke fights mid-edit input (typing "3"
// into a min-5 field would snap to 5 before the "0" for "30" arrives).
// While focused, the text is authoritative; unfocused, it follows the prop.
function NumInput({ value, min, max, step, fallback, onCommit }) {
  const [text, setText] = useState(String(value ?? ''));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(String(value ?? '')); }, [value, focused]);
  const commit = () => {
    const raw = text.trim();
    let n = raw === '' ? NaN : Number(raw);
    if (!Number.isFinite(n)) n = fallback ?? value ?? 0;
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    if (n !== value) onCommit(n);
    setText(String(n));
  };
  return html`<input type="number" min=${min} max=${max} step=${step} value=${text}
    onFocus=${() => setFocused(true)}
    onInput=${(e) => setText(e.target.value)}
    onBlur=${() => { setFocused(false); commit(); }}
    onKeyDown=${(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />`;
}

// ============================================================================
// COMPONENTS: SCENARIO EDITOR — full CRUD incl. lore piece editor.
// ============================================================================
function newLorePiece() {
  return {
    id: uid(), type: 'lore', title: '', content: '', keys: [],
    pinned: false, weight: 0, links: [], enabled: true, searchDepth: null,
    wholeWord: false, caseSensitive: false, // trigger key matching options
    smart: false, // semantic (embedding) activation — needs settings.embeddingModel
    hidden: false, playable: false,
  };
}

// Text field for string-array values (lore keys, tags). Keeps the raw text
// locally so in-progress typing (trailing newlines, ", " before the next
// item) isn't destroyed by the parse→join roundtrip; only re-syncs from the
// parent when the value genuinely changed externally (piece switch, import).
function ListInput({ values, onChange, textarea, delim, ...rest }) {
  const joiner = delim === '\n' ? '\n' : ', ';
  const parse = (raw) => String(raw).split(delim).map(s => s.trim()).filter(Boolean);
  const [text, setText] = useState(() => (values ?? []).join(joiner));
  useEffect(() => {
    const parsed = parse(text);
    const v = values ?? [];
    const same = parsed.length === v.length && parsed.every((x, i) => x === v[i]);
    if (!same) setText(v.join(joiner));
  }, [values]);
  const handle = (e) => { setText(e.target.value); onChange(parse(e.target.value)); };
  return textarea
    ? html`<textarea value=${text} onInput=${handle} ...${rest} />`
    : html`<input type="text" value=${text} onInput=${handle} ...${rest} />`;
}

function LorePieceCard({ piece, allPieces, onChange, onRemove }) {
  const [open, setOpen] = useState(false);
  const set = (patch) => onChange({ ...piece, ...patch });
  const others = allPieces.filter(p => p.id !== piece.id);
  return html`
    <div class="lore-card">
      <div class="lc-head" onClick=${() => setOpen(!open)}>
        <span>${open ? '▾' : '▸'}</span>
        <span class="t">${piece.title || '(untitled)'}</span>
        ${piece.type === 'character' && html`<span class="pill">character</span>`}
        ${piece.pinned && html`<span class="pill pinned">pinned</span>`}
        ${piece.enabled === false && html`<span class="pill">disabled</span>`}
        <button class="btn small danger" onClick=${(e) => { e.stopPropagation(); onRemove(); }}>✕</button>
      </div>
      ${open && html`
        <div class="lc-body">
          <div class="grid2">
            <label class="field"><span>Title</span>
              <input type="text" value=${piece.title} onInput=${(e) => set({ title: e.target.value })} /></label>
            <label class="field"><span>Type</span>
              <select value=${piece.type} onChange=${(e) => set({ type: e.target.value })}>
                <option value="lore">lore</option>
                <option value="character">character</option>
              </select></label>
          </div>
          <label class="field"><span>Content — sent to the AI when active. {{user}} works here.</span>
            <textarea rows=${4} value=${piece.content} onInput=${(e) => set({ content: e.target.value })} /></label>
          <label class="field"><span>Trigger keys — one per line, regex; keys under 2 chars never fire</span>
            <${ListInput} textarea=${true} delim=${'\n'} rows=${3} values=${piece.keys}
              onChange=${(keys) => set({ keys })} /></label>
          <div class="field"><span>Key matching</span>
            <label class="check" title="Keys only match at word boundaries — 'cat' won't match 'cathedral'">
              <input type="checkbox" checked=${!!piece.wholeWord} onChange=${(e) => set({ wholeWord: e.target.checked })} /> whole word</label>
            <label class="check" title="Keys match with exact letter case (default is case-insensitive)">
              <input type="checkbox" checked=${!!piece.caseSensitive} onChange=${(e) => set({ caseSensitive: e.target.checked })} /> case sensitive</label>
          </div>
          <label class="check" title="Embed this piece + the recent conversation each generation; activates on similarity even without keyword overlap">
            <input type="checkbox" checked=${!!piece.smart} onChange=${(e) => set({ smart: e.target.checked })} />
            Smart activation (semantic) — requires an embeddings model in Settings
          </label>
          <div class="grid3">
            <label class="field"><span>Weight</span>
              <input type="number" value=${piece.weight ?? 0} onInput=${(e) => set({ weight: Number(e.target.value) })} /></label>
            <label class="field"><span>Search depth (est. tokens)</span>
              <input type="number" placeholder="2048" value=${piece.searchDepth ?? ''}
                onInput=${(e) => set({ searchDepth: e.target.value === '' ? null : Number(e.target.value) })} /></label>
            <div class="field"><span>Flags</span>
              <label class="check"><input type="checkbox" checked=${!!piece.pinned} onChange=${(e) => set({ pinned: e.target.checked })} /> pinned</label>
              <label class="check"><input type="checkbox" checked=${piece.enabled !== false} onChange=${(e) => set({ enabled: e.target.checked })} /> enabled</label>
            </div>
          </div>
          ${piece.type === 'character' && html`
            <div class="field"><span>Character flags</span>
              <label class="check"><input type="checkbox" checked=${!!piece.hidden} onChange=${(e) => set({ hidden: e.target.checked })} /> hidden</label>
              <label class="check"><input type="checkbox" checked=${!!piece.playable} onChange=${(e) => set({ playable: e.target.checked })} /> playable</label>
            </div>`}
          ${others.length > 0 && html`
            <label class="field"><span>Links — these pieces get a weight boost when this piece is active</span>
              <div class="links-list">
                ${others.map(o => html`
                  <label class="check" key=${o.id}>
                    <input type="checkbox" checked=${(piece.links ?? []).includes(o.id)}
                      onChange=${(e) => set({ links: e.target.checked
                        ? [...(piece.links ?? []), o.id]
                        : (piece.links ?? []).filter(id => id !== o.id) })} />
                    ${o.title || '(untitled)'}
                  </label>`)}
              </div></label>`}
        </div>`}
    </div>`;
}

function newScenario() {
  return {
    id: uid(), name: 'New scenario', description: '', tags: [],
    backstory: '', greeting: '', scenarioInstructions: '', lorePieces: [],
    emergentLore: 'queue', // off | queue (review) | auto — model/extractor-proposed lore routing
    createdAt: Date.now(),
  };
}

function ScenarioEditor({ scenario, characters = {}, onSave, onClose }) {
  const [draft, setDraft] = useState(() => deepClone(scenario));
  const set = (patch) => setDraft(d => ({ ...d, ...patch }));
  const setPiece = (id, next) =>
    set({ lorePieces: draft.lorePieces.map(p => p.id === id ? next : p) });
  const charList = Object.values(characters).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  const linkedIds = Array.isArray(draft.characterIds) ? draft.characterIds : [];
  const toggleChar = (id, on) =>
    set({ characterIds: on ? [...linkedIds, id] : linkedIds.filter(x => x !== id) });
  return html`
    <${Modal} title="Scenario editor" wide onClose=${onClose}
      footer=${html`<button class="btn primary" onClick=${() => onSave(draft)}>Save scenario</button>`}>
      <div class="grid2">
        <label class="field"><span>Name</span>
          <input type="text" value=${draft.name} onInput=${(e) => set({ name: e.target.value })} /></label>
        <label class="field"><span>Tags (comma-separated)</span>
          <${ListInput} delim=',' values=${draft.tags} onChange=${(tags) => set({ tags })} /></label>
      </div>
      <label class="field"><span>Description — <b>metadata, not sent to the AI</b></span>
        <textarea rows=${2} value=${draft.description} onInput=${(e) => set({ description: e.target.value })} /></label>
      <label class="field"><span>Scenario instructions — sent to the AI, ranks above the platform prompt. {{user}} = persona name.</span>
        <textarea rows=${3} value=${draft.scenarioInstructions} onInput=${(e) => set({ scenarioInstructions: e.target.value })} /></label>
      <label class="field"><span>Backstory — sent to the AI (static layer, truncated first under budget pressure)</span>
        <textarea rows=${6} value=${draft.backstory} onInput=${(e) => set({ backstory: e.target.value })} /></label>
      <label class="field"><span>Greeting — first assistant message of every new chat</span>
        <textarea rows=${4} value=${draft.greeting} onInput=${(e) => set({ greeting: e.target.value })} /></label>
      <label class="field"><span>Emergent lore — where model-proposed lore (add_lore calls + periodic extraction) goes</span>
        <select value=${draft.emergentLore ?? 'queue'} onChange=${(e) => set({ emergentLore: e.target.value })}>
          <option value="off">off — no proposals, no extraction</option>
          <option value="queue">suggest for review (default) — proposals wait in chat settings</option>
          <option value="auto">auto-add — proposals go straight into chat lore</option>
        </select></label>
      <div class="field">
        <span>Linked characters (${linkedIds.length})</span>
        <div class="hint">Global character cards join this scenario's lore pipeline (activation, budgets, /pov, speaker colours). Card edits apply live to all linked scenarios and chats. For scenario-only characters, use a character-type lore piece below.</div>
        ${charList.length === 0 && html`<div class="hint">No global characters yet — create them from the sidebar's Characters section.</div>`}
        ${charList.length > 0 && html`
          <div class="links-list">
            ${charList.map(c => html`
              <label class="check" key=${c.id}>
                <input type="checkbox" checked=${linkedIds.includes(c.id)}
                  onChange=${(e) => toggleChar(c.id, e.target.checked)} />
                ${c.name}
              </label>`)}
          </div>`}
      </div>
      <div class="field">
        <span>Lore pieces (${draft.lorePieces.length})
          <button class="btn small" style=${{ marginLeft: '8px' }}
            onClick=${() => set({ lorePieces: [...draft.lorePieces, newLorePiece()] })}>+ add piece</button>
        </span>
        ${draft.lorePieces.map(p => html`
          <${LorePieceCard} key=${p.id} piece=${p} allPieces=${draft.lorePieces}
            onChange=${(next) => setPiece(p.id, next)}
            onRemove=${() => set({ lorePieces: draft.lorePieces.filter(q => q.id !== p.id) })} />`)}
      </div>
    <//>`;
}

// ============================================================================
// COMPONENTS: PERSONA MANAGER
// ============================================================================
function PersonaManager({ personas, onUpsert, onRemove, onClose }) {
  const [editing, setEditing] = useState(null); // draft persona or null
  const list = Object.values(personas).sort((a, b) => a.name.localeCompare(b.name));
  return html`
    <${Modal} title="Personas" onClose=${onClose}>
      ${editing ? html`
        <label class="field"><span>Name — replaces {{user}} everywhere</span>
          <input type="text" value=${editing.name} onInput=${(e) => setEditing({ ...editing, name: e.target.value })} /></label>
        <label class="field"><span>Description — sent to the AI as "{{user}} is …"</span>
          <textarea rows=${5} value=${editing.description} onInput=${(e) => setEditing({ ...editing, description: e.target.value })} /></label>
        <div style=${{ display: 'flex', gap: '8px' }}>
          <button class="btn primary" disabled=${!editing.name.trim()}
            onClick=${() => { onUpsert(editing.id, editing); setEditing(null); }}>Save</button>
          <button class="btn" onClick=${() => setEditing(null)}>Cancel</button>
        </div>` : html`
        <button class="btn" onClick=${() => setEditing({ id: uid(), name: '', description: '' })}>+ New persona</button>
        <div style=${{ marginTop: '10px' }}>
          ${list.length === 0 && html`<div class="hint">No personas yet. A persona feeds the {{user}} macro.</div>`}
          ${list.map(p => html`
            <div class="side-item" key=${p.id}>
              <span class="name">${p.name}</span>
              <span class="tools" style=${{ display: 'flex' }}>
                <button class="btn small" onClick=${() => setEditing(deepClone(p))}>edit</button>
                <button class="btn small danger" onClick=${() => confirm(`Delete persona "${p.name}"?`) && onRemove(p.id)}>✕</button>
              </span>
            </div>`)}
        </div>`}
    <//>`;
}

// ============================================================================
// COMPONENTS: SETTINGS MODAL
// ============================================================================
const DEFAULT_PLATFORM_PROMPT =
  'You are an AI collaborator in an immersive roleplay. Stay in character, write vivid, ' +
  'engaging prose, and respect the scenario, world info, and memories provided. Never break ' +
  'the fourth wall unless the user speaks out-of-character. Portray the world and its ' +
  'characters; leave the actions, words, and thoughts of {{user}} to the user. ' +
  'Format the reply as prose: wrap spoken dialogue in double quotation marks ' +
  '("like this") and actions or non-verbal beats in single asterisks (*like ' +
  'this*). ' +
  'When a specific character speaks or acts, begin the reply with that character\'s name ' +
  'followed by a colon (e.g. "Veyra:") — the app labels the message with it and hides the ' +
  'prefix from the reader. Narration without a speaker needs no prefix.';

const DEFAULT_SETTINGS = {
  endpoint: 'http://localhost:8080',
  apiKey: '',
  model: '',
  auxModel: '',
  embeddingModel: '', // semantic lore activation; empty = disabled
  semanticThreshold: 0.55, // cosine similarity needed for a smart piece to inject
  dateFormat: 'dd/mm/yyyy', // date order for stamps and chat names
  sidebarArrows: false, // desktop: «/» edge arrows instead of the brand/Inspector buttons as pane toggles (phones always use arrows)
  contextLength: 8192,
  maxTokens: LENGTH_PRESETS.medium.maxTokens,
  responseLength: 'medium',
  // Editable length instruction appended to the prompt tail; '' = no directive.
  // Follows the preset's default text until the user edits it.
  lengthDirective: LENGTH_PRESETS.medium.directive,
  samplers: { temperature: 0.8, top_p: 0.95, top_k: 40, min_p: 0.05, repetition_penalty: 1.1 },
  platformPrompt: DEFAULT_PLATFORM_PROMPT,
  tokenProbs: true, // request logprobs + top_logprobs on generations
  topLogprobs: 10, // how many alternative tokens to request/store per position
  suggestions: true, // response-suggestion chips after generations
  suggestionsCount: 2, // chips offered per reply (1–5)
  suggestionsWords: 20, // max words per suggestion (5–60)
  suggestionsPrompt: DEFAULT_SUGGESTIONS_PROMPT, // aux prompt; {{user}} {{count}} {{words}} work here
  suggestionsTemp: 0.9,
  suggestionsDepth: 6, // recent messages handed to the suggestions call
  auxShowSuggestions: false, // list suggestion calls in the Inspector's Aux calls (they fire per swipe — noisy)
  memoryEvery: MEMORY_EVERY, // messages between auto-summaries (and lore-extraction cadence)
  memoryPrompt: DEFAULT_MEMORY_PROMPT,
  memoryTemp: 0.3,
  memoryMaxTokens: 220, // aux response cap for a summary
  memoryMaxChars: 500, // stored note length cap
  memoryCap: MEMORY_CAP, // memory cards kept per chat (pinned exempt)
  loreExtractPrompt: DEFAULT_LORE_EXTRACT_PROMPT,
  loreExtractTemp: 0.3,
  loreExtractMaxTokens: 400,
  loreExtractMax: 3, // pieces proposed per extraction pass
  improvePrompt: DEFAULT_IMPROVE_PROMPT, // /improve
  improveTemp: 0.7,
  improveMaxTokens: 400,
  recapPrompt: DEFAULT_RECAP_PROMPT, // /recap
  recapTemp: 0.4,
  recapMaxTokens: 700,
  toolsEnabled: true, // prompt-based tool calling (register_character / add_lore → chat lore)
  toolsPrompt: TOOLS_PROMPT, // protocol instructions appended to the platform prompt; user-editable
  toolCallCap: TOOL_CALL_CAP, // tool calls executed per generation
  multiSpeaker: true, // model may reply for several characters per turn (split into per-speaker bubbles)
  speakerPrompt: SPEAKER_PROMPT, // multi-speaker instructions appended to the platform prompt; user-editable
  customTools: [], // user-defined tools: [{ id, name, argsHint, description, action: 'note'|'set_var'|'register_character'|'add_lore' }]
  stopStrings: [],  // sent as OpenAI `stop` when non-empty
  routeViaServer: true, // rewrite endpoint → /proxy/… at request time (server storage only)
  serverToken: '',  // optional Bearer token for server storage (FICTIONPAD_TOKEN)
  logitBias: {},    // { [inputString]: { ids: number[], strings: string[], power: -100..100 } }
  layerCaps: { ...LAYER_CAPS }, // fraction of context budget per layer; history = remainder
  tokenChars: TOKEN_CHARS, // chars/token estimate fallback (exact counts via /tokenize when available)
  loreSearchDepth: DEFAULT_SEARCH_DEPTH, // estimated tokens scanned for lore keys (per-piece override wins)
  loreLinkBoost: LINK_BOOST, // effective-weight bonus lent by one active linking piece
};

const SETTINGS_TABS = [
  ['appearance', 'Appearance'],
  ['connection', 'Connection'],
  ['models', 'Models'],
  ['generation', 'Generation'],
  ['features', 'Features'],
  ['prompts', 'Prompts'],
];

function SettingsModal({ settings, onSave, onClose, theme, onThemeChange, accent, onAccentChange, onOpenLogitBias,
                        storageKind, onUpload, onDownload }) {
  const [draft, setDraft] = useState(() => {
    const d = deepClone(settings);
    // Pre-fill from the active preset so saving an untouched form keeps the
    // current directive instead of blanking it.
    d.lengthDirective ??= LENGTH_PRESETS[d.responseLength ?? 'medium']?.directive ?? '';
    return d;
  });
  const [tab, setTab] = useState('appearance');
  const [models, setModels] = useState(null);
  const [modelsError, setModelsError] = useState(null);
  const [migBusy, setMigBusy] = useState(null);
  const [migNote, setMigNote] = useState(null);
  const set = (patch) => setDraft(d => ({ ...d, ...patch }));
  const setSampler = (k, v) => setDraft(d => ({ ...d, samplers: { ...d.samplers, [k]: v } }));
  const setCap = (k, pct) => setDraft(d => ({
    ...d, layerCaps: { ...LAYER_CAPS, ...(d.layerCaps ?? {}), [k]: Math.max(0, Math.min(90, pct || 0)) / 100 },
  }));

  const migrate = async (dir) => {
    const label = dir === 'up' ? 'Upload local data to the server' : 'Download server data to this browser';
    if (!confirm(`${label}? Rows with the same keys are overwritten (last write wins, no merging).`)) return;
    setMigBusy(dir); setMigNote(null);
    try {
      const n = await (dir === 'up' ? onUpload() : onDownload());
      setMigNote(`Done — ${n} entit${n === 1 ? 'y' : 'ies'} ${dir === 'up' ? 'uploaded' : 'downloaded'}.`);
    } catch (e) {
      setMigNote(`Failed: ${e.message ?? e}`);
    } finally { setMigBusy(null); }
  };

  const fetchModels = async () => {
    setModelsError(null);
    try { setModels(await listModels({ endpoint: effectiveEndpoint(draft, storageKind === 'server'), apiKey: draft.apiKey, serverToken: draft.serverToken })); }
    catch (e) { setModels(null); setModelsError(String(e.message ?? e)); }
  };

  // Shared prompt-textarea block for the Prompts tab.
  const promptField = (key, label, def, rows, hint) => html`
    <label class="field"><span>${label}</span>
      <textarea rows=${rows} value=${draft[key] ?? def} onInput=${(e) => set({ [key]: e.target.value })} /></label>
    ${hint && html`<div class="hint" style=${{ margin: '-6px 0 6px' }}>${hint}</div>`}
    <button class="btn small" style=${{ marginBottom: '10px' }} onClick=${() => set({ [key]: def })}>Reset to default</button>`;

  // Compact numeric field for the advanced knobs. NumInput lets the user type
  // freely and clamps on blur/Enter instead of fighting every keystroke.
  const numField = (key, label, def, { min, max, step } = {}) => html`
    <label class="field"><span>${label}</span>
      <${NumInput} value=${draft[key] ?? def} min=${min} max=${max} step=${step} fallback=${def}
        onCommit=${(n) => set({ [key]: n })} /></label>`;

  return html`
    <${Modal} title="Settings" wide onClose=${onClose}
      footer=${html`<button class="btn ghost" onClick=${onClose}>Cancel</button>
        <button class="btn primary" onClick=${() => onSave(draft)}>Save settings</button>`}>
      <div class="m-tabs">
        ${SETTINGS_TABS.map(([id, label]) => html`
          <button key=${id} class="m-tab ${tab === id ? 'active' : ''}" onClick=${() => setTab(id)}>${label}</button>`)}
      </div>

      ${tab === 'appearance' && html`
        <label class="field"><span>Theme — applies immediately, saved automatically</span>
          <select value=${theme} onChange=${(e) => onThemeChange(e.target.value)}>
            ${Object.entries(THEMES).map(([id, t]) => html`<option key=${id} value=${id}>${t.name}</option>`)}
          </select></label>
        ${THEMES[theme]?.accentable && html`
          <label class="field"><span>Accent — drives quotes, names on bubbles, buttons</span>
            <div style=${{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style=${{ width: '14px', height: '14px', borderRadius: '50%', flex: 'none',
                background: (CTP_ACCENTS[theme] ?? {})[accent] ?? 'transparent', border: '1px solid var(--c-border)' }}></span>
              <select value=${accent} onChange=${(e) => onAccentChange(e.target.value)} style=${{ flex: 1 }}>
                ${Object.keys(CTP_ACCENTS[theme] ?? {}).map(a => html`<option key=${a} value=${a}>${a}</option>`)}
              </select>
            </div></label>`}
        <label class="field"><span>Date format — message stamps, memories, chat names</span>
          <select value=${draft.dateFormat ?? 'dd/mm/yyyy'} onChange=${(e) => set({ dateFormat: e.target.value })}>
            ${Object.keys(DATE_FORMATS).map(f => html`<option key=${f} value=${f}>${f}</option>`)}
          </select></label>
        <label class="check">
          <input type="checkbox" checked=${!!draft.sidebarArrows} onChange=${(e) => set({ sidebarArrows: e.target.checked })} />
          Pane toggles as «/» edge arrows instead of the FictionPad brand / Inspector buttons (desktop — phones always use arrows)
        </label>`}

      ${tab === 'connection' && html`
        <div class="grid2">
          <label class="field"><span>Endpoint (OpenAI-compatible; with or without /v1)</span>
            <input type="text" value=${draft.endpoint} onInput=${(e) => set({ endpoint: e.target.value })} />
            ${storageKind === 'server' && draft.routeViaServer !== false && draft.endpoint?.trim() && !draft.endpoint.trim().startsWith('/proxy/') && html`
              <span class="hint">Requests will go via this server: /proxy/${draft.endpoint.trim()}</span>`}
          </label>
          <label class="field"><span>API key (sent as Bearer token; stored in localStorage)</span>
            <input type="password" value=${draft.apiKey} onInput=${(e) => set({ apiKey: e.target.value })} /></label>
        </div>
        ${storageKind === 'server' && html`
          <label class="check">
            <input type="checkbox" checked=${draft.routeViaServer !== false} onChange=${(e) => set({ routeViaServer: e.target.checked })} />
            Route API requests through this server (avoids CORS; the server calls the endpoint on your behalf)
          </label>`}
        <div class="field"><span>Storage</span>
          <div class="hint">${storageKind === 'server'
            ? 'Server storage active — scenarios, personas and chats are shared via this server. Settings synced via server.'
            : 'Local storage — data lives in this browser only.'}</div>
          <label class="field" style=${{ marginTop: '6px' }}>
            <span>Server token (only when the server sets FICTIONPAD_TOKEN; applies after reload)</span>
            <input type="password" value=${draft.serverToken ?? ''} onInput=${(e) => set({ serverToken: e.target.value })} /></label>
          ${storageKind === 'server' && html`
            <div style=${{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button class="btn small" disabled=${!!migBusy} onClick=${() => migrate('up')}>
                ${migBusy === 'up' ? 'Uploading…' : 'Upload local data to server'}</button>
              <button class="btn small" disabled=${!!migBusy} onClick=${() => migrate('down')}>
                ${migBusy === 'down' ? 'Downloading…' : 'Download server data to local'}</button>
            </div>
            ${migNote && html`<div class="hint" style=${{ marginTop: '4px' }}>${migNote}</div>`}`}
        </div>`}

      ${tab === 'models' && html`
        <div class="grid2">
          <label class="field"><span>Chat model</span>
            <div style=${{ display: 'flex', gap: '6px' }}>
              <input type="text" list="fp-models" value=${draft.model} onInput=${(e) => set({ model: e.target.value })} />
              <button class="btn" onClick=${fetchModels}>Fetch</button>
            </div>
            <datalist id="fp-models">${(models ?? []).map(m => html`<option key=${m} value=${m} />`)}</datalist>
            ${modelsError && html`<span class="warn">${modelsError}</span>`}
            ${models && html`<span class="hint">${models.length} model(s) found — pick one or type freely.</span>`}
          </label>
          <label class="field"><span>Aux model (memory summaries, suggestions, /improve, /recap; blank = chat model)</span>
            <input type="text" list="fp-models" value=${draft.auxModel} onInput=${(e) => set({ auxModel: e.target.value })} /></label>
        </div>
        <div class="grid2">
          <label class="field"><span>Embedding model (semantic lore activation; blank = off)</span>
            <input type="text" list="fp-models" placeholder="e.g. bge-m3" value=${draft.embeddingModel ?? ''}
              onInput=${(e) => set({ embeddingModel: e.target.value })} />
            <span class="hint">Often a separate model name from the chat model; Fetch above populates the list.</span>
          </label>
          ${numField('semanticThreshold', 'Semantic threshold (0–1)', 0.55, { min: 0, max: 1, step: 0.05 })}
          <div class="hint" style=${{ margin: '-6px 0 6px' }}>Cosine similarity a smart lore piece needs to inject. Near-misses show in the Inspector. Blank resets to 0.55.</div>
        </div>`}

      ${tab === 'generation' && html`
        <div class="grid3">
          <label class="field"><span>Context length (tokens)</span>
            <${NumInput} value=${draft.contextLength} min=${256} step=${512} fallback=${8192}
              onCommit=${(n) => set({ contextLength: n })} /></label>
          <label class="field"><span>Response length preset</span>
            <select value=${draft.responseLength}
              onChange=${(e) => set({
                responseLength: e.target.value,
                maxTokens: LENGTH_PRESETS[e.target.value]?.maxTokens ?? draft.maxTokens,
                lengthDirective: LENGTH_PRESETS[e.target.value]?.directive ?? draft.lengthDirective,
              })}>
              <option value="short">Short (~150 tokens)</option>
              <option value="medium">Medium (~400 tokens)</option>
              <option value="long">Long (~800 tokens)</option>
            </select></label>
          <label class="field"><span>Max tokens (response reserve)</span>
            <${NumInput} value=${draft.maxTokens} min=${1} fallback=${LENGTH_PRESETS.medium.maxTokens}
              onCommit=${(n) => set({ maxTokens: n })} /></label>
        </div>
        <label class="field"><span>Length directive — instruction appended to the prompt (blank = none)</span>
          <textarea rows=${2} value=${draft.lengthDirective ?? ''}
            onInput=${(e) => set({ lengthDirective: e.target.value })} /></label>
        <div class="grid3">
          ${['temperature', 'top_p', 'top_k', 'min_p', 'repetition_penalty'].map(k => html`
            <label class="field" key=${k}><span>${{ temperature: 'Temperature', repetition_penalty: 'Repetition penalty' }[k] ?? k}</span>
              <${NumInput} value=${draft.samplers[k]} step=${k === 'top_k' ? 1 : 0.05} fallback=${DEFAULT_SETTINGS.samplers[k]}
                onCommit=${(n) => setSampler(k, n)} /></label>`)}
        </div>
        <label class="field"><span>Stop strings — one per line; generation halts at these (server-side)</span>
          <${ListInput} textarea=${true} delim=${'\n'} rows=${3} values=${draft.stopStrings ?? []}
            placeholder="e.g. your EOS marker, if your model emits one"
            onChange=${(stopStrings) => set({ stopStrings })} /></label>
        <div class="grid3">
          <label class="field"><span>Top logprobs — alternatives stored per token</span>
            <${NumInput} value=${draft.topLogprobs ?? 10} min=${1} max=${20} fallback=${10}
              onCommit=${(n) => set({ topLogprobs: n })} />
            <span class="hint">Sent as top_logprobs when token probabilities are on (Features tab).</span></label>
        </div>
        <div class="field"><span>Context budget split (%) — static / lore / memory; chat history gets the remainder</span>
          <div class="grid3">
            <label class="field"><span>Static</span>
              <${NumInput} value=${Math.round(((draft.layerCaps ?? LAYER_CAPS).static ?? 0.3) * 100)} min=${0} max=${90}
                fallback=${Math.round(LAYER_CAPS.static * 100)} onCommit=${(n) => setCap('static', n)} /></label>
            <label class="field"><span>Lore</span>
              <${NumInput} value=${Math.round(((draft.layerCaps ?? LAYER_CAPS).lore ?? 0.2) * 100)} min=${0} max=${90}
                fallback=${Math.round(LAYER_CAPS.lore * 100)} onCommit=${(n) => setCap('lore', n)} /></label>
            <label class="field"><span>Memory</span>
              <${NumInput} value=${Math.round(((draft.layerCaps ?? LAYER_CAPS).memory ?? 0.1) * 100)} min=${0} max=${90}
                fallback=${Math.round(LAYER_CAPS.memory * 100)} onCommit=${(n) => setCap('memory', n)} /></label>
          </div>
          <button class="btn small" onClick=${() => set({ layerCaps: { ...LAYER_CAPS } })}>Reset split to default</button>
        </div>
        <div class="field"><span>Estimates & lore scanning</span>
          <div class="grid3">
            ${numField('tokenChars', 'Chars per token (estimate fallback)', TOKEN_CHARS, { min: 1, max: 8, step: 0.1 })}
            ${numField('loreSearchDepth', 'Lore search depth (est. tokens)', DEFAULT_SEARCH_DEPTH, { min: 0, step: 128 })}
            ${numField('loreLinkBoost', 'Lore link boost (weight bonus)', LINK_BOOST, { min: 0, max: 20 })}
          </div>
          <div class="hint">Chars/token drives estimated counts when /tokenize is unavailable — budgets, inspector "(est)" numbers, and the lore scan window all follow it. Search depth is the default scan window for keyword triggers (per-piece depth still wins); link boost is the weight an active piece lends its links.</div>
        </div>
        <div style=${{ marginTop: '4px' }}>
          <button class="btn small" onClick=${onOpenLogitBias}>Edit logit bias…</button>
          <span class="hint" style=${{ marginLeft: '8px' }}>${Object.keys(draft.logitBias ?? {}).length} entr(ies)</span>
        </div>`}

      ${tab === 'features' && html`
        <div class="field"><span>Enable features</span>
          <label class="check">
            <input type="checkbox" checked=${draft.tokenProbs !== false} onChange=${(e) => set({ tokenProbs: e.target.checked })} />
            Token probabilities (logprobs + alternatives per token; count in Generation tab)
          </label>
          <label class="check">
            <input type="checkbox" checked=${draft.suggestions !== false} onChange=${(e) => set({ suggestions: e.target.checked })} />
            Response suggestions ("what you might do next" chips after each AI reply)
          </label>
          <label class="check">
            <input type="checkbox" checked=${draft.toolsEnabled !== false} onChange=${(e) => set({ toolsEnabled: e.target.checked })} />
            Tool calling (model may register characters + lore mid-reply, into this chat's lore)
          </label>
          <label class="check">
            <input type="checkbox" checked=${draft.multiSpeaker !== false} onChange=${(e) => set({ multiSpeaker: e.target.checked })} />
            Multi-speaker replies (model may answer as several characters; each part gets its own bubble)
          </label>
        </div>
        ${draft.suggestions !== false && html`
          <div class="field"><span>Response suggestions</span>
            <div class="grid2">
              <label class="field"><span>Number of suggestions (1–5)</span>
                <${NumInput} value=${draft.suggestionsCount ?? 2} min=${1} max=${5} fallback=${2}
                  onCommit=${(n) => set({ suggestionsCount: n })} /></label>
              <label class="field"><span>Max words per suggestion</span>
                <${NumInput} value=${draft.suggestionsWords ?? 20} min=${5} max=${60} fallback=${20}
                  onCommit=${(n) => set({ suggestionsWords: n })} /></label>
            </div>
            <div class="grid2">
              ${numField('suggestionsTemp', 'Temperature', 0.9, { min: 0, max: 2, step: 0.05 })}
              ${numField('suggestionsDepth', 'Context messages sent', 6, { min: 1, max: 30 })}
            </div>
            <div class="hint">Uses the aux model; the prompt is editable in the Prompts tab.</div>
            <label class="check">
              <input type="checkbox" checked=${!!draft.auxShowSuggestions} onChange=${(e) => set({ auxShowSuggestions: e.target.checked })} />
              Show suggestion calls in the Inspector's Aux calls log
            </label>
          </div>`}
        <div class="field"><span>Memory</span>
          <label class="field"><span>Auto-summarize every N messages (also the lore-extraction cadence)</span>
            <${NumInput} value=${draft.memoryEvery ?? MEMORY_EVERY} min=${5} max=${200} fallback=${MEMORY_EVERY}
              onCommit=${(n) => set({ memoryEvery: n })} /></label>
          <div class="grid3">
            ${numField('memoryTemp', 'Summary temperature', 0.3, { min: 0, max: 2, step: 0.05 })}
            ${numField('memoryMaxTokens', 'Summary max tokens', 220, { min: 50, max: 2000, step: 10 })}
            ${numField('memoryMaxChars', 'Note max characters', 500, { min: 100, max: 5000, step: 50 })}
          </div>
          <div class="grid3">
            ${numField('memoryCap', 'Memory cards kept per chat', MEMORY_CAP, { min: 5, max: 1000 })}
          </div>
          <div class="hint">Summarize / extraction prompts are editable in the Prompts tab. Pinned cards are exempt from the card cap.</div>
        </div>
        <div class="field"><span>Lore extraction (runs on the memory cadence)</span>
          <div class="grid3">
            ${numField('loreExtractTemp', 'Temperature', 0.3, { min: 0, max: 2, step: 0.05 })}
            ${numField('loreExtractMaxTokens', 'Max tokens', 400, { min: 50, max: 2000, step: 10 })}
            ${numField('loreExtractMax', 'Max pieces per pass', 3, { min: 1, max: 10 })}
          </div>
          <div class="hint">If you raise max pieces, also raise the "up to 3" in the extraction prompt (Prompts tab).</div>
        </div>
        <div class="field"><span>Slash commands (aux model)</span>
          <div class="grid3">
            ${numField('improveTemp', '/improve temperature', 0.7, { min: 0, max: 2, step: 0.05 })}
            ${numField('improveMaxTokens', '/improve max tokens', 400, { min: 50, max: 4000, step: 10 })}
          </div>
          <div class="grid3">
            ${numField('recapTemp', '/recap temperature', 0.4, { min: 0, max: 2, step: 0.05 })}
            ${numField('recapMaxTokens', '/recap max tokens', 700, { min: 50, max: 4000, step: 10 })}
          </div>
        </div>
        <div class="field"><span>Tool calling</span>
          ${draft.toolsEnabled === false
            ? html`<div class="hint">Off — enable it above.</div>`
            : html`
            <div class="hint" style=${{ margin: '4px 0' }}>Protocol instructions are editable in the Prompts tab.</div>
            <div class="grid3">
              ${numField('toolCallCap', 'Max tool calls per generation', TOOL_CALL_CAP, { min: 1, max: 25 })}
            </div>
            <div class="field"><span>Custom tools (${(draft.customTools ?? []).length})
              <button class="btn small" style=${{ marginLeft: '8px' }}
                onClick=${() => set({ customTools: [...(draft.customTools ?? []), { id: uid(), name: '', argsHint: '', description: '', action: 'note' }] })}>+ add tool</button></span>
              <div class="hint">Your own tools, listed to the model after the built-ins. Name + description are what the model sees; the action is what the app does when it's called. Built-in names (register_character, add_lore) are reserved.</div>
              ${(draft.customTools ?? []).map((t, i) => {
                const setTool = (patch) => set({ customTools: draft.customTools.map(q => q.id === t.id ? { ...q, ...patch } : q) });
                return html`
                  <div class="lore-card" key=${t.id} style=${{ padding: '8px' }}>
                    <div class="grid2">
                      <label class="field"><span>Tool name (no spaces)</span>
                        <input type="text" value=${t.name} placeholder="roll_dice"
                          onInput=${(e) => setTool({ name: e.target.value.replace(/\s+/g, '_') })} /></label>
                      <label class="field"><span>Action</span>
                        <select value=${t.action} onChange=${(e) => setTool({ action: e.target.value })}>
                          <option value="note">author's note (append steering text)</option>
                          <option value="set_var">set story variable ({{var:name}})</option>
                          <option value="register_character">register character</option>
                          <option value="add_lore">add lore piece</option>
                        </select></label>
                    </div>
                    <label class="field"><span>Args hint — shown to the model, e.g. "text" or "name, value"</span>
                      <input type="text" value=${t.argsHint ?? ''} placeholder=${t.action === 'set_var' ? 'name, value' : 'text'}
                        onInput=${(e) => setTool({ argsHint: e.target.value })} /></label>
                    <label class="field"><span>Description — when/why the model should call it</span>
                      <textarea rows=${2} value=${t.description ?? ''} onInput=${(e) => setTool({ description: e.target.value })} /></label>
                    <button class="btn small danger"
                      onClick=${() => set({ customTools: draft.customTools.filter(q => q.id !== t.id) })}>Remove tool</button>
                  </div>`;
              })}
            </div>`}
        </div>`}

      ${tab === 'prompts' && html`
        ${promptField('platformPrompt', 'Platform system prompt — lowest instruction rank; {{user}} works here', DEFAULT_PLATFORM_PROMPT, 5)}
        ${promptField('suggestionsPrompt', 'Suggestions prompt — asks the aux model for reply options', DEFAULT_SUGGESTIONS_PROMPT, 3,
          '{{user}} = persona name, {{count}} and {{words}} = the values from the Features tab. Used when suggestions are on.')}
        ${promptField('memoryPrompt', 'Memory summary prompt — auto-summaries and /memory', DEFAULT_MEMORY_PROMPT, 3)}
        ${promptField('loreExtractPrompt', 'Lore extraction prompt — proposes new lore pieces on the memory cadence', DEFAULT_LORE_EXTRACT_PROMPT, 4)}
        ${promptField('improvePrompt', '/improve prompt — rewrites your draft in character', DEFAULT_IMPROVE_PROMPT, 2,
          '{{user}} = persona name (+ description, when set).')}
        ${promptField('recapPrompt', '/recap prompt — third-person recap of recent messages', DEFAULT_RECAP_PROMPT, 2)}
        ${draft.toolsEnabled !== false
          ? promptField('toolsPrompt', 'Tool protocol instructions — appended to the platform prompt; teaches the model the format. {{user}} works here.', TOOLS_PROMPT, 9)
          : html`<div class="hint">Tool protocol prompt hidden — tool calling is off (Features tab).</div>`}
        ${draft.multiSpeaker !== false
          ? promptField('speakerPrompt', 'Multi-speaker instructions — appended to the platform prompt.', SPEAKER_PROMPT, 4)
          : html`<div class="hint">Multi-speaker prompt hidden — multi-speaker is off (Features tab).</div>`}`}
    <//>`;
}
// ============================================================================
// COMPONENTS: LOGIT BIAS EDITOR — { [inputString]: { ids, strings, power } }.
// Literal strings are tokenized via /tokenize ("!==" + s, prefix tokens sliced
// off to dodge the leading-space artifact); raw "/id,id/" syntax always works.
// ============================================================================
function LogitBiasModal({ logitBias, onChange, onTokenize, onClose }) {
  const [text, setText] = useState('');
  const [power, setPower] = useState(-10);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState(null);
  const entries = Object.entries(logitBias ?? {});
  const remove = (key) => onChange(Object.fromEntries(entries.filter(([k]) => k !== key)));

  const add = async () => {
    const s = text.trim();
    if (!s) return;
    setBusy(true); setHint(null);
    try {
      let ids = null, strings = null;
      const raw = /^\/([\d,\s]+)\/$/.exec(s);
      if (raw) {
        ids = raw[1].split(',').map(x => parseInt(x.trim(), 10)).filter(Number.isFinite);
        strings = ids.map(String);
      } else {
        const full = await onTokenize(`!==${s}`);
        const pre = await onTokenize('!==');
        if (full?.ids) {
          ids = full.ids.slice(pre?.ids?.length ?? 0);
          strings = full.strings ? full.strings.slice((full.strings.length ?? 0) - ids.length) : ids.map(String);
        }
        if (!ids?.length) {
          setHint('Tokenizer endpoint unavailable for literal strings — use raw /id,id/ syntax (e.g. /123,456/).');
          return;
        }
      }
      const p = Math.max(-100, Math.min(100, Number(power) || 0));
      if (p === 0) remove(s); // power 0 deletes
      else onChange({ ...(logitBias ?? {}), [s]: { ids, strings, power: p } });
      setText('');
    } finally { setBusy(false); }
  };

  const Row = ({ k, e }) => html`
    <div class="kv" key=${k}>
      <span class="k" style=${{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '55%' }}
        title=${(e.strings ?? []).join('')}>${k} <span class="hint">[${(e.ids ?? []).join(',')}]</span></span>
      <span>${e.power > 0 ? '+' : ''}${e.power}
        <button class="btn small ghost" style=${{ marginLeft: '6px' }} onClick=${() => remove(k)}>✕</button></span>
    </div>`;
  const pos = entries.filter(([, e]) => e.power > 0).sort((a, b) => b[1].power - a[1].power);
  const neg = entries.filter(([, e]) => e.power < 0).sort((a, b) => a[1].power - b[1].power);

  return html`
    <${Modal} title="Logit bias" onClose=${onClose}>
      <div class="hint" style=${{ marginBottom: '8px' }}>
        Applied to every generation as OpenAI logit_bias (first token of each entry). −100…100; 0 deletes.
      </div>
      <div style=${{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' }}>
        <input type="text" style=${{ flex: 1 }} placeholder='Literal string, or /id,id/' value=${text}
          onInput=${(e) => setText(e.target.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter' && !busy) add(); }} />
        <input type="number" style=${{ width: '80px' }} min="-100" max="100" value=${power}
          onInput=${(e) => setPower(Number(e.target.value))} title="Bias −100…100" />
        <button class="btn primary" disabled=${busy || !text.trim()} onClick=${add}>${busy ? '…' : 'Add'}</button>
      </div>
      ${hint && html`<div class="hint warn">${hint}</div>`}
      ${entries.length === 0 && html`<div class="hint">No entries.</div>`}
      ${pos.length > 0 && html`<h4>Encouraged</h4>${pos.map(([k, e]) => html`<${Row} k=${k} e=${e} />`)}`}
      ${neg.length > 0 && html`<h4>Discouraged</h4>${neg.map(([k, e]) => html`<${Row} k=${k} e=${e} />`)}`}
    <//>`;
}

// ============================================================================
// COMPONENTS: CONTEXT INSPECTOR — renders the assembler manifest. This is the
// activation-observability surface: exactly what was injected, and why.
// ============================================================================
// Expandable row: one-line preview collapsed, full content on click, native
// tooltip with a longer excerpt on hover.
function InspectorRow({ pills = [], title, meta, preview, content, dimmed = false }) {
  const [open, setOpen] = useState(false);
  return html`
    <div class="lore-item-row ${dimmed ? 'dimmed' : ''}" title=${content ? String(content).slice(0, 500) : null}>
      <div class="row" style=${{ cursor: 'pointer' }} onClick=${() => setOpen(!open)}>
        <span class="hint">${open ? '▾' : '▸'}</span>
        ${pills.map((p, i) => html`<span key=${i} class="pill ${p.cls}">${p.text}</span>`)}
        <span style=${{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${title}</span>
        ${meta && html`<span class="hint">${meta}</span>`}
      </div>
      ${!open && preview && html`<div class="ir-preview">${preview}</div>`}
      ${open && content && html`<div class="ir-content">${content}</div>`}
    </div>`;
}

// Collapsible section header (Context / Lore / Memories) — open by default,
// collapse state persisted per section. `meta` renders dim after the title.
function InspectorSection({ title, count, meta, children }) {
  const [open, setOpen] = usePersistentState(`fictionpad.inspector.section.${title}`, true);
  return html`
    <div>
      <h4 class="ir-toggle" onClick=${() => setOpen(o => !o)}>
        ${open ? '▾' : '▸'} ${title}${count != null ? ` (${count})` : ''}${meta && html` <span class="hint">${meta}</span>`}</h4>
      ${open && children}
    </div>`;
}

// One budget layer as a lore-row-style card: name + tokens/cap, a usage meter
// (warning-colored past 90%), a one-line note collapsed, context on expand.
// Expanded by default; open state persisted per card.
function LayerCard({ name, tokens, cap, note, about }) {
  const [open, setOpen] = usePersistentState(`fictionpad.inspector.layer.${name}`, true);
  const pct = cap > 0 ? Math.min(100, Math.round((tokens / cap) * 100)) : 0;
  return html`
    <div class="lore-item-row">
      <div class="row" style=${{ cursor: 'pointer' }} onClick=${() => setOpen(o => !o)}>
        <span class="hint">${open ? '▾' : '▸'}</span>
        <span style=${{ flex: 1 }}>${name} <span class="hint">(${pct}%)</span></span>
        <span class="hint" style=${{ fontVariantNumeric: 'tabular-nums' }}>${tokens} / ${cap}t</span>
      </div>
      <div class="lt-meter">
        <div class="lt-fill ${pct > 90 ? 'lt-hot' : ''}"
          style=${{ width: (tokens > 0 ? Math.max(pct, 1) : 0) + '%' }} />
      </div>
      ${!open && note && html`<div class="ir-preview">${note}</div>`}
      ${open && about && html`<div class="ir-content">${about}</div>`}
    </div>`;
}

function ContextInspector({ manifest, onPreview, hasChat, realCounts, auxLog = [] }) {
  const [showInactive, setShowInactive] = useState(false);
  // Aux calls (memory summaries, lore extraction, suggestions, /improve,
  // /recap) are separate requests that never enter the main context, so the
  // manifest can't show them. Session log (last 12), newest first.
  const auxSection = (auxLog ?? []).length > 0 && html`
    <${InspectorSection} title="Aux calls" count=${auxLog.length}>
      ${[...auxLog].reverse().map((a, i) => html`
        <${InspectorRow} key=${`${a.at}-${i}`} dimmed=${!a.ok}
          pills=${[{ text: a.ok ? 'ok' : 'failed', cls: a.ok ? 'chat' : 'pinned' }]}
          title=${a.kind} meta=${`${new Date(a.at).toLocaleTimeString()} · ~${estimateTokens(`${a.system}\n${a.user}`)}t in`}
          preview=${toPreview(a.out, 140)}
          content=${`[system]\n${a.system}\n\n[user]\n${a.user}\n\n[${a.ok ? 'response' : 'error'}]\n${a.out}`} />`)}
    <//>`;
  if (!manifest?.layers) return html`
    <div>
      <div class="hint">No generation recorded yet. Send a message, or preview the context that would be sent right now.</div>
      ${hasChat && html`<button class="btn" style=${{ marginTop: '8px' }} onClick=${onPreview}>Preview current context</button>`}
      ${auxSection}
    </div>`;
  const L = manifest.layers;
  // One number per card, one source per panel: when /tokenize gave us a real
  // total, every card shows its real count (est fallback for empty blocks);
  // otherwise all cards are estimates. The greeting is the first chat message,
  // so it counts toward History here — tokens AND cap both include it (it's
  // budget-pinned), keeping the card's % honest.
  const exact = realCounts?.total != null;
  const tok = (est, real) => (exact ? (real ?? est) : est);
  const total = tok(manifest.totalTokens, realCounts?.total);
  const src = exact ? 'exact' : 'estimated';
  const hasGreeting = (L.greeting?.tokens ?? 0) > 0;
  const histTok = tok(L.history.tokens + (L.greeting?.tokens ?? 0),
    exact ? (realCounts?.history ?? 0) + (realCounts?.greeting ?? 0) : null);
  const histCap = L.history.cap + (L.greeting?.tokens ?? 0);
  const keptNote = L.history.dropped
    ? `${L.history.kept} of ${L.history.kept + L.history.dropped} messages kept — oldest dropped to fit`
    : `all ${L.history.kept} message${L.history.kept === 1 ? '' : 's'} kept`;
  const memPinned = L.memory.memories.filter(m => m.pinned).length;
  // Semantic activation observability: per-piece cosine scores from the last
  // generation (only present when an embedding model ran). Injected smart
  // pieces show their score; inactive ones show score vs threshold so
  // near-misses answer "why didn't this trigger?".
  const sem = manifest.semantic ?? null;
  const semScore = new Map((sem?.scores ?? []).map(s => [s.id, s.score]));
  const semPill = (id, injected) => {
    if (!semScore.has(id)) return [];
    const score = semScore.get(id);
    if (injected) return [{ text: `sim ${score.toFixed(2)}`, cls: 'semantic' }];
    const near = score >= (sem.threshold - 0.10);
    return [{ text: `sim ${score.toFixed(2)} < ${sem.threshold.toFixed(2)}`, cls: near ? 'link-boosted' : '' }];
  };
  return html`
    <div>
      <${InspectorSection} title="Context"
        meta=${`(${manifest.budget > 0 ? Math.round((total / manifest.budget) * 100) : 0}%)`}>
        <${LayerCard} name="Static"
          tokens=${tok(L.static.tokens, realCounts?.static)} cap=${L.static.cap}
          note="platform + speaker/tools prompts · scenario · persona · directives"
          about="Platform system prompt, multi-speaker and tool-calling instructions, scenario instructions and backstory, persona, per-chat custom instructions, author's note, and the length directive — always sent in full." />
        <${LayerCard} name="Lore"
          tokens=${tok(L.lore.tokens, realCounts?.lore)} cap=${L.lore.cap}
          note=${`${L.lore.pieces.length} injected${(L.lore.inactive ?? []).length ? ` · ${L.lore.inactive.length} not` : ''}`}
          about="Lore pieces pinned or triggered by recent messages, ordered by weight and trimmed to budget." />
        <${LayerCard} name="Memory"
          tokens=${tok(L.memory.tokens, realCounts?.memory)} cap=${L.memory.cap}
          note=${L.memory.memories.length
            ? `${L.memory.memories.length} injected · ${memPinned} pinned` : 'no memories yet'}
          about="Pinned memories first, then recent ones, trimmed to budget; new summaries are written as the chat grows." />
        <${LayerCard} name="History"
          tokens=${histTok} cap=${histCap}
          note=${hasGreeting ? `greeting + ${keptNote}` : keptNote}
          about="Chat messages, oldest dropped first under pressure; the greeting is pinned and always sent — its tokens count toward both sides of this card." />
        <${LayerCard} name="Total"
          tokens=${total} cap=${manifest.budget}
          about="Everything sent to the model. Budget = context length minus the response reserve." />
        <div class="hint" style=${{ margin: '2px 0 8px' }}>
          ${src} counts · ctx ${manifest.contextLength} − ${manifest.reserve} reserve
        </div>
        ${manifest.warnings.map((w, i) => html`<div class="warn" key=${i}>⚠\uFE0E ${w}</div>`)}
      <//>
      <${InspectorSection} title="Lore injected" count=${L.lore.pieces.length}>
        ${L.lore.pieces.length === 0 && html`<div class="hint">No lore pieces active.</div>`}
        ${L.lore.pieces.map(p => html`
          <${InspectorRow} key=${p.id}
            pills=${[{ text: p.reason, cls: p.reason },
              ...(p.origin === 'chat' ? [{ text: 'chat', cls: 'chat' }] : []),
              ...(p.origin === 'character' ? [{ text: 'character', cls: 'character' }] : []),
              ...(p.boost > 0 && p.reason !== 'link-boosted' ? [{ text: `+${p.boost} boost`, cls: 'link-boosted' }] : []),
              ...semPill(p.id, true)]}
            title=${p.title} meta=${`w${p.weight} · ${p.tokens}t`}
            preview=${p.preview} content=${p.content} />`)}
        ${(L.lore.inactive ?? []).length > 0 && html`
          <div class="hint ir-toggle" onClick=${() => setShowInactive(!showInactive)}>
            Not injected (${L.lore.inactive.length}) ${showInactive ? '▾' : '▸'}
          </div>
          ${showInactive && L.lore.inactive.map((p, i) => html`
            <${InspectorRow} key=${p.id ?? i} dimmed
              pills=${[{ text: p.reason, cls: p.reason === 'over-budget' ? 'pinned' : '' },
                ...(p.origin === 'chat' ? [{ text: 'chat', cls: 'chat' }] : []),
                ...(p.origin === 'character' ? [{ text: 'character', cls: 'character' }] : []),
                ...semPill(p.id, false)]}
              title=${p.title} meta=${`${p.tokens}t`}
              preview=${p.preview} content=${p.content} />`)}`}
      <//>
      <${InspectorSection} title="Memories injected" count=${L.memory.memories.length}>
        ${L.memory.memories.length === 0 && html`<div class="hint">No memories injected.</div>`}
        ${L.memory.memories.map((m, i) => html`
          <${InspectorRow} key=${m.id ?? i}
            pills=${m.pinned ? [{ text: 'pinned', cls: 'pinned' }] : []}
            title=${`memory ${String(m.id ?? '').slice(-6)}`} meta=${`${m.tokens}t`}
            preview=${m.preview} content=${m.text} />`)}
      <//>
      ${auxSection}
      ${(manifest.toolCalls ?? []).length > 0 && html`
        <${InspectorSection} title="Tool calls" count=${manifest.toolCalls.length}>
          ${manifest.toolCalls.map((t, i) => html`
            <${InspectorRow} key=${i} dimmed=${!t.ok}
              pills=${[{ text: t.ok ? 'ok' : 'failed', cls: t.ok ? 'chat' : 'pinned' }]}
              title=${t.name || '(unparsed)'} meta=${t.note}
              preview=${t.args} content=${t.args} />`)}
        <//>`}
      ${hasChat && html`<button class="btn" style=${{ marginTop: '8px' }} onClick=${onPreview}>Re-run assembler on current chat</button>`}
    </div>`;
}

// ============================================================================
// COMPONENTS: MEMORY PANEL — view / pin / delete memories, manual summarize.
// ============================================================================
function MemoryPanel({ chat, onUpdateChat, onSummarize, summarizing, dateFormat, memoryEvery }) {
  if (!chat) return html`<div class="hint">Select a chat to see its memories.</div>`;
  const memories = [...(chat.memoryStore?.memories ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const setStore = (mems) => onUpdateChat({ ...chat, memoryStore: { ...chat.memoryStore, memories: mems } });
  return html`
    <div>
      <div style=${{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' }}>
        <span class="hint" style=${{ flex: 1 }}>
          ${memories.length}/${MEMORY_CAP} memories · auto-summary every ${memoryEvery ?? MEMORY_EVERY} messages
        </span>
        <button class="btn small" disabled=${summarizing} onClick=${onSummarize}>
          ${summarizing ? 'Summarizing…' : 'Summarize now'}</button>
      </div>
      ${memories.length === 0 && html`<div class="hint">No memories yet. They are created automatically as the chat grows, and are versioned with the chat (branches fork them, rewinds roll them back).</div>`}
      ${memories.map(m => html`
        <div class="mem-item" key=${m.id}>
          <div class="row">
            ${m.pinned && html`<span class="pill pinned">pinned</span>`}
            <span class="hint" style=${{ flex: 1 }}>${fmtDate(m.createdAt, dateFormat)}</span>
            <button class="btn small" onClick=${() => setStore(chat.memoryStore.memories.map(x => x.id === m.id ? { ...x, pinned: !x.pinned } : x))}>
              ${m.pinned ? 'unpin' : 'pin'}</button>
            <button class="btn small danger" onClick=${() => setStore(chat.memoryStore.memories.filter(x => x.id !== m.id))}>✕</button>
          </div>
          <div class="text">${m.text}</div>
        </div>`)}
    </div>`;
}

// ============================================================================
// COMPONENTS: CHAT OPTIONS TAB — per-chat settings.
// ============================================================================
function ChatOptions({ chat, personas, scenario, characters, onUpdateChat, onExport, onDelete }) {
  if (!chat) return html`<div class="hint">Select a chat first.</div>`;
  const pieces = Array.isArray(chat.lorePieces) ? chat.lorePieces : [];
  const allPieces = mergedLorePieces(scenario, chat, characters);
  const linkedChars = resolveCharacters(scenario, chat, characters);
  const setPieces = (lorePieces) => onUpdateChat({ ...chat, lorePieces });
  return html`
    <div>
      <label class="field"><span>Chat name</span>
        <input type="text" value=${chat.name} onInput=${(e) => onUpdateChat({ ...chat, name: e.target.value })} /></label>
      <label class="field"><span>Persona ({{user}})</span>
        <select value=${chat.personaId ?? ''} onChange=${(e) => onUpdateChat({ ...chat, personaId: e.target.value || null })}>
          <option value="">— none ({{user}} → "User") —</option>
          ${Object.values(personas).map(p => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}
        </select></label>
      <label class="field"><span>Model override (this chat only; blank = global chat model)</span>
        <input type="text" value=${chat.settings?.model ?? ''} placeholder="(global)"
          onInput=${(e) => onUpdateChat({ ...chat, settings: { ...(chat.settings ?? {}), model: e.target.value.trim() || undefined } })} /></label>
      ${linkedChars.length > 0 && html`
        <div class="hint">Linked characters (global cards — edits apply live everywhere): ${linkedChars.map(p => p.title).join(', ')}</div>`}
      <label class="field"><span>Custom instructions — appended to the system layer for this chat only</span>
        <textarea rows=${4} value=${chat.customInstructions ?? ''}
          onInput=${(e) => onUpdateChat({ ...chat, customInstructions: e.target.value })} /></label>
      <label class="field"><span>Author's note — sticky steering injected after custom instructions; "note"-action tools append here</span>
        <textarea rows=${2} value=${chat.authorsNote ?? ''}
          onInput=${(e) => onUpdateChat({ ...chat, authorsNote: e.target.value })} /></label>
      ${Object.keys(chat.vars ?? {}).length > 0 && html`
        <div class="hint">Story variables (usable as {{var:name}}): ${Object.entries(chat.vars).map(([k, v]) => `${k} = ${v}`).join(' · ')}</div>`}
      ${(chat.loreQueue ?? []).length > 0 && html`
        <div class="field">
          <span>Suggested lore — awaiting review (${chat.loreQueue.length})</span>
          <div class="hint">Proposed by the model or the extraction pass. Accept moves it into this chat's lore as yours; dismiss discards it.</div>
          ${chat.loreQueue.map(q => html`
            <div class="lore-card" key=${q.id}>
              <div class="lc-head">
                <span class="t">${q.title || '(untitled)'}</span>
                <span class="pill">${q.source === 'extract' ? 'extracted' : 'tool'}</span>
                <button class="btn small" onClick=${() => onUpdateChat(acceptQueuedLore(chat, q.id))}>accept</button>
                <button class="btn small danger" onClick=${() => onUpdateChat(dismissQueuedLore(chat, q.id))}>✕</button>
              </div>
              <div class="hint" style=${{ padding: '2px 8px 6px' }}>${toPreview(q.content, 160)}</div>
            </div>`)}
        </div>`}
      <div class="field">
        <span>Lore — this chat only (${pieces.length})
          <button class="btn small" style=${{ marginLeft: '8px' }}
            onClick=${() => setPieces([...pieces, newLorePiece()])}>+ add piece</button>
        </span>
        <div class="hint">Merged over the scenario's lore at generation time (chat wins on a shared id). Characters added here join speaker colours, /pov, and smart activation for this chat only.</div>
        ${pieces.map(p => html`
          <${LorePieceCard} key=${p.id} piece=${p} allPieces=${allPieces}
            onChange=${(next) => setPieces(pieces.map(q => q.id === p.id ? next : q))}
            onRemove=${() => setPieces(pieces.filter(q => q.id !== p.id))} />`)}
      </div>
      <div style=${{ display: 'flex', gap: '6px' }}>
        <button class="btn small" onClick=${onExport}>Export chat JSON</button>
        <button class="btn small danger" onClick=${onDelete}>Delete chat</button>
      </div>
    </div>`;
}

// ============================================================================
// COMPONENTS: MESSAGE + COMPOSER + CHAT PANE
// ============================================================================
// ============================================================================
// COMPONENTS: PROBS VIEW — per-token spans with probability tint + hover
// popover (top-10 alternatives, click to branch generation from that token).
// ============================================================================
const visibleTok = (t) => String(t ?? '').replace(/ /g, '␣').replace(/\t/g, '⇥').replace(/\n/g, '↵\n');
const probPct = (lp) => lp == null ? null : Math.exp(lp) * 100;

function ProbsView({ tokens, onPick }) {
  return html`
    <div class="probs-view">
      ${tokens.map((t, i) => {
        if (t.logprob == null) // no prob data for this chunk: plain span, no popover
          return html`<span key=${i}>${t.text}</span>`;
        const pct = probPct(t.logprob);
        const bg = pct == null ? 'transparent'
          : `color-mix(in oklch, color-mix(in oklch, var(--c-good) ${Math.round(pct)}%, var(--c-danger)) 30%, transparent)`;
        return html`
          <span key=${i} class="tok" style=${{ background: bg }}>${t.text}<span class="pop">
            <div class="pop-row head"><span class="tt">${visibleTok(t.text) || '∅'}</span>
              <span class="pc">${pct == null ? 'n/a' : pct.toFixed(1) + '%'}</span></div>
            ${(t.top ?? []).map((alt, j) => {
              const ap = probPct(alt.logprob);
              return html`<div key=${j} class="pop-row alt" onClick=${() => onPick(i, alt.token)}>
                <span class="rank">#${j + 1}</span><span class="tt">${visibleTok(alt.token)}</span>
                <span class="pc">${ap == null ? '' : ap.toFixed(1) + '%'}</span></div>`;
            })}
            <div class="pop-row alt" onClick=${() => onPick(i, null)}><span class="tt">↻ from here</span></div>
          </span></span>`;
      })}
    </div>`;
}

function MessageItem({ node, index, isRoot, isLeaf, personaName, characterNames, streaming, generating, dateFormat, onEdit, onRegenerate, onSwipe, onSwipeTo, onBranch, onRewind, onDelete, onReply, onRegenFromToken }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [showProbs, setShowProbs] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false); // mobile: actions collapsed behind ›
  const [metaOpen, setMetaOpen] = useState(false); // mobile: meta details collapsed behind ›
  const [toolsOpen, setToolsOpen] = useState(false); // gear pill: per-swipe tool-call popover
  // Auto-hide the actions/meta/tools popovers when tapping anywhere else.
  useEffect(() => {
    if (!actionsOpen && !metaOpen && !toolsOpen) return;
    const onDown = (e) => {
      if (!e.target.closest?.('.actions, .actions-toggle')) setActionsOpen(false);
      if (!e.target.closest?.('.meta-details, .meta-toggle')) setMetaOpen(false);
      if (!e.target.closest?.('.tools-pop, .tools-toggle')) setToolsOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [actionsOpen, metaOpen, toolsOpen]);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y } — right-click on the message
  const swipe = node.swipes[node.activeSwipe] ?? { text: '' };
  // Fit-based meta collapse (phones): the row renders fully expanded and steps
  // down one level at a time until it fits — each level drops one more detail
  // from the inline row, right to left (model, edited, gen time, date, #),
  // then the action icons (t6). Never measured mid-stream (the row is widest
  // while generating); re-probes from t0 on swipe change and row resizes.
  // Pre-paint, so no flash.
  const metaRef = useRef(null);
  const [metaLevel, setMetaLevel] = useState(0);
  useEffect(() => {
    const el = metaRef.current; if (!el) return;
    let seen = false; // RO fires once on observe — skip that, react only to real resizes
    const ro = new ResizeObserver(() => { if (seen) setMetaLevel(0); seen = true; });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const prevSwipeRef = useRef(swipe);
  useLayoutEffect(() => {
    if (prevSwipeRef.current !== swipe) { // swipe switched → re-probe from t0
      prevSwipeRef.current = swipe;
      if (metaLevel) { setMetaLevel(0); return; }
    }
    const el = metaRef.current;
    if (!el || streaming) return;
    if (el.scrollWidth > el.clientWidth + 1 && metaLevel < 6) setMetaLevel(l => l + 1);
  }, [metaLevel, streaming, swipe]);
  const text = subUser(swipe.text, personaName);
  const isUser = node.role === 'user';
  const isOOC = /^\[OOC:/i.test(text.trim());
  const hasProbs = !isUser && Array.isArray(swipe.tokens) && swipe.tokens.length > 0;
  const speaker = isUser ? null : (swipe.speaker ?? detectSpeaker(text, characterNames) ?? 'Narrator');
  const isCharacter = !!speaker && speaker !== 'Narrator';
  // The speaker is already labeled in the meta row — hide the `Name:` prefix.
  const displayText = isCharacter ? stripSpeakerPrefix(text, speaker) : text;
  const n = node.activeSwipe + 1, m = node.swipes.length;
  const isLeafAssistant = isLeaf && !isUser;
  const showNav = m > 1 || isLeafAssistant;
  const usedIdx = Number.isInteger(node.usedSwipe) ? node.usedSwipe : null;
  const atUsed = usedIdx === node.activeSwipe;

  // Horizontal swipe gesture (touch/pen only) mirroring the swipe navigator:
  // left = next swipe / ▶⁺ on the leaf, right = previous swipe.
  const [dragX, setDragX] = useState(0);
  const gestureRef = useRef(null);
  const gestureHandlers = (isUser || generating) ? {} : {
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse' || editing) return;
      gestureRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, consumed: false };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    },
    onPointerMove: (e) => {
      const g = gestureRef.current;
      if (!g || g.id !== e.pointerId) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (g.consumed) return; // one action per gesture
      if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) {
        g.consumed = true;
        setDragX(0);
        if (dx < 0) { // swipe left: next swipe, or generate on the leaf's last
          if (n < m) onSwipe(node.id, 1);
          else if (isLeafAssistant) onRegenerate(node.id);
        } else if (n > 1) { // swipe right: back
          onSwipe(node.id, -1);
        }
        return;
      }
      // sub-threshold feedback, only while clearly horizontal-dominant
      setDragX(Math.abs(dx) > 2 * Math.abs(dy) ? Math.max(-30, Math.min(30, dx * 0.3)) : 0);
    },
    onPointerUp: () => { gestureRef.current = null; setDragX(0); },
    onPointerCancel: () => { gestureRef.current = null; setDragX(0); },
  };
  // Multi-speaker split (v2.0c): one swipe, several `Name:` parts → one
  // bubble per part. Rendering only; storage/swipes/probs are untouched.
  const segments = (isUser || isOOC) ? null : splitSpeakerSegments(text, characterNames);
  const multi = (segments?.length ?? 0) > 1;
  // Multi-speaker swipe: the header names everyone who spoke, in speaking
  // order (first appearance), each with its own colour.
  const multiSpeakers = multi ? [...new Set(segments.map((s) => s.speaker ?? 'Narrator'))] : null;
  // #, date, gen time, edited, model collapse behind the › toggle on phones
  // (desktop shows them inline via .meta-details { display: contents }).
  const hasMetaDetails = !!(index != null || swipe.createdAt || Number.isFinite(swipe.genMs) || node.edited || swipe.modelId);
  return html`
    <div class="msg ${isUser ? 'user' : 'assistant'} ${isOOC ? 'ooc' : ''}"
      onContextMenu=${(e) => {
        // Keep the native menu when the user has text selected (copy etc.).
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}>
      <div class="meta ${metaLevel ? `t${metaLevel}` : ''}" ref=${metaRef}>
        ${isUser ? html`<span class="who">${personaName}</span>`
          : multiSpeakers ? multiSpeakers.map((name, i) => html`${i > 0 ? ', ' : ''}<span key=${name}
              class="who ${name !== 'Narrator' ? 'speaker' : ''}"
              style=${name !== 'Narrator' ? { '--speaker-h': hueForName(name) } : null}>${name}</span>`)
          : html`<span class="who ${isCharacter ? 'speaker' : ''}"
              style=${isCharacter ? { '--speaker-h': hueForName(speaker) } : null}>${speaker}</span>`}
        ${swipe.interrupted && html`<span class="warn" title="The connection ended before the model finished — this reply is partial. Regenerate to replace it.">⚠\uFE0E interrupted</span>`}
        ${(swipe.toolCalls ?? []).length > 0 && html`
          <button class="pill tools-toggle" title="Tool calls made during this generation — click to view"
            onClick=${() => setToolsOpen(!toolsOpen)}>⚙\uFE0E ${swipe.toolCalls.length}</button>
          ${toolsOpen && html`
            <span class="tools-pop">
              ${swipe.toolCalls.map((t, i) => html`
                <span key=${i} class="tools-row ${t.ok ? '' : 'failed'}">
                  <span>${t.ok ? '✓' : '✕'} <b>${t.name || '(unparsed)'}</b>${t.note ? html`<span class="tools-note"> — ${t.note}</span>` : null}</span>
                  ${t.args && t.args !== '{}' && html`<span class="tools-args">${t.args}</span>`}
                </span>`)}
            </span>`}`}
        ${hasMetaDetails && html`
          <button class="btn small ghost meta-toggle" title="Message info"
            onClick=${() => setMetaOpen(!metaOpen)}>${metaOpen ? '⌄' : '›'}</button>`}
        <span class="meta-details ${metaOpen ? 'open' : ''}" onClick=${() => setMetaOpen(false)}>
          ${index != null && html`<span class="md-index">#${index}</span>`}
          ${swipe.createdAt && html`<span class="md-date">${fmtDate(swipe.createdAt, dateFormat)}</span>`}
          ${Number.isFinite(swipe.genMs) && html`<span class="md-gentime" title="Generation time, prompt to completion">${(swipe.genMs / 1000).toFixed(1)}s</span>`}
          ${node.edited && html`<span class="md-edited">(edited)</span>`}
          ${swipe.modelId && html`<span class="md-model">${swipe.modelId}</span>`}
        </span>
        <span class="grow" style=${{ flex: 1 }}></span>
        <span class="actions ${streaming ? 'always' : ''} ${actionsOpen ? 'open' : ''}"
          onClick=${() => setActionsOpen(false)}>
          ${hasProbs && html`<button class="btn small ghost ${showProbs ? 'primary' : ''}" title="Token probabilities"
            onClick=${() => setShowProbs(!showProbs)}>▦</button>`}
          <button class="btn small ghost" title="Edit" disabled=${generating}
            onClick=${() => { setDraft(swipe.text); setEditing(true); }}>✎</button>
          ${!isUser && html`<button class="btn small ghost" title="Regenerate (new swipe)" disabled=${generating}
            onClick=${() => onRegenerate(node.id)}>↻</button>`}
          ${isUser && html`<button class="btn small ghost" title="Reply from here (generate assistant response)" disabled=${generating}
            onClick=${() => onReply(node.id)}>↻</button>`}
          <button class="btn small ghost" title="Branch from here" disabled=${generating}
            onClick=${() => onBranch(node.id)}>⑂</button>
          ${!isRoot && html`<button class="btn small ghost" title="Rewind to here" disabled=${generating}
            onClick=${() => confirm('Rewind the chat to this message? Later messages stay in the tree but leave the active branch; memories are rolled back.') && onRewind(node.id)}>⏮\uFE0E</button>`}
          ${!isRoot && html`<button class="btn small ghost" title="Delete message (and its branch)" disabled=${generating}
            onClick=${() => confirm('Delete this message and everything after it in its branch?') && onDelete(node.id)}>✕</button>`}
        </span>
        <button class="btn small ghost actions-toggle" title="Message actions"
          onClick=${() => setActionsOpen(!actionsOpen)}>${actionsOpen ? '‹' : '›'}</button>
${showNav && html`
          <span class="swipes">
            <button class="btn small ghost" disabled=${generating || n <= 1} onClick=${() => onSwipe(node.id, -1)}>◀\uFE0E</button>
            <span>${n}/${m}</span>
            ${usedIdx != null && html`
              <span class="used-dot ${atUsed ? '' : 'jump'}"
                title=${atUsed ? 'This is the version the conversation continued from' : `The conversation continued from swipe ${usedIdx + 1} — click to view`}
                onClick=${() => !atUsed && onSwipeTo(node.id, usedIdx)}>${atUsed ? '●' : '○'}</span>`}
            ${n < m
              ? html`<button class="btn small ghost" disabled=${generating} onClick=${() => onSwipe(node.id, 1)}>▶\uFE0E</button>`
              : isLeafAssistant
                ? html`<button class="btn small ghost gen" title="Generate a new version" disabled=${generating}
                    onClick=${() => onRegenerate(node.id)}>▶\uFE0E⁺</button>`
                : html`<button class="btn small ghost" disabled>▶\uFE0E</button>`}
          </span>`}
        
      </div>
      ${multi && !editing && !(showProbs && hasProbs) ? segments.map((seg, si) => html`
        <div key=${si} class="bubble seg ${dragX !== 0 ? 'dragging' : ''}"
          style=${{ transform: dragX ? `translateX(${dragX}px)` : null }}
          ...${gestureHandlers}>
          <div class="seg-who ${seg.speaker ? 'speaker' : ''}"
            style=${seg.speaker ? { '--speaker-h': hueForName(seg.speaker) } : null}>${seg.speaker ?? 'Narrator'}</div>
          <div class=${streaming && si === segments.length - 1 ? 'streaming-cursor' : ''}><${Markdown} text=${seg.text} prose streaming=${streaming && si === segments.length - 1} /></div>
        </div>`) : html`
      <div class="bubble ${dragX !== 0 ? 'dragging' : ''}"
        style=${{ transform: dragX ? `translateX(${dragX}px)` : null }}
        ...${gestureHandlers}>
        ${editing ? html`
          <textarea class="edit" value=${draft} onInput=${(e) => setDraft(e.target.value)} />
          <div style=${{ display: 'flex', gap: '6px' }}>
            <button class="btn small primary" onClick=${() => { onEdit(node.id, draft); setEditing(false); }}>Save</button>
            <button class="btn small" onClick=${() => setEditing(false)}>Cancel</button>
          </div>` :
          streaming && !displayText
            // Generating but no first token yet (slow backend waking up, model
            // loading, middleware holding the connection) — don't look dead.
            ? html`<div class="waiting" title="Waiting for the first token…"><span>●\uFE0E</span><span>●\uFE0E</span><span>●\uFE0E</span></div>` :
          showProbs && hasProbs
            ? html`<${ProbsView} tokens=${swipe.tokens} onPick=${(i, alt) => onRegenFromToken(node.id, i, alt)} />` :
          isOOC
            ? html`<div class="plain ${streaming ? 'streaming-cursor' : ''}">${displayText}</div>`
            : html`<div class=${streaming ? 'streaming-cursor' : ''}><${Markdown} text=${displayText} prose streaming=${streaming} /></div>`}
      </div>`}
      ${ctxMenu && html`
        <${ContextMenu} x=${ctxMenu.x} y=${ctxMenu.y} onClose=${() => setCtxMenu(null)}
          items=${[
            ...(hasProbs ? [{ label: 'Token probabilities', fn: () => setShowProbs(!showProbs) }] : []),
            { label: 'Edit', fn: () => { setDraft(swipe.text); setEditing(true); } },
            isUser
              ? { label: 'Reply from here', fn: () => onReply(node.id) }
              : { label: 'Regenerate (new swipe)', fn: () => onRegenerate(node.id) },
            { label: 'Branch from here', fn: () => onBranch(node.id) },
            ...(!isRoot ? [
              '-',
              { label: 'Rewind to here', fn: () => confirm('Rewind the chat to this message? Later messages stay in the tree but leave the active branch; memories are rolled back.') && onRewind(node.id) },
              { label: 'Delete message (and its branch)', fn: () => confirm('Delete this message and everything after it in its branch?') && onDelete(node.id), danger: true },
            ] : []),
          ]} />`}
    </div>`;
}

const COMPOSER_COMMANDS = [
  ['/ooc', 'speak out of character'],
  ['/continue', 'continue the last reply'],
  ['/pov', 'reply from another character’s view'],
  ['/improve', 'rewrite your draft in persona voice'],
  ['/recap N', 'summarize the last N messages'],
  ['/memory N', 'save a memory from the last N messages'],
  ['/model NAME', 'set this chat’s model'],
  ['/theme NAME', 'switch the UI theme'],
];

function Composer({ generating, busy, onSubmit, onStop, inject }) {
  const [text, setText] = useState('');
  const [hint, setHint] = useState(null);
  useEffect(() => {
    if (!inject) return;
    if ('text' in inject) setText(inject.text ?? '');
    if ('hint' in inject) setHint(inject.hint ?? null);
  }, [inject]);
  const send = () => {
    const t = text.trim();
    if (!t) return;
    const res = onSubmit(t); // returns an error hint string, or null when consumed
    if (res) setHint(res);
    else { setText(''); setHint(null); }
  };
  // Touch devices (coarse pointer) have no Shift on the soft keyboard, so
  // Enter is always a newline there — sending is the Send button's job.
  // Desktop keeps Enter-to-send, Shift+Enter for newline.
  const coarseEnter = window.matchMedia?.('(pointer: coarse)').matches;
  // Slash-command hints: while the first token is a / prefix, offer matching
  // commands (click/tap completes the command word into the draft).
  const cmdHints = text.startsWith('/') && !/[\s]/.test(text)
    ? COMPOSER_COMMANDS.filter(([c]) => c.split(' ')[0].startsWith(text) && c.split(' ')[0] !== text)
    : [];
  // Auto-grow the textarea with the draft, capped (CSS max-height) so long
  // messages scroll internally instead of eating the screen. Resting state
  // (empty draft) is a single line regardless of focus.
  const taRef = useRef(null);
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    if (!text) { ta.style.height = ''; return; }
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [text]);
  return html`
    <div class="composer">
      ${cmdHints.length > 0 && html`
        <div class="cmd-hints">
          ${cmdHints.map(([c, d]) => html`
            <button key=${c} class="cmd-hint"
              onMouseDown=${(e) => { e.preventDefault(); setText(c.split(' ')[0] + (c.includes(' ') ? ' ' : '')); taRef.current?.focus(); }}>
              <span class="cmd">${c}</span><span class="desc">${d}</span>
            </button>`)}
        </div>`}
      <div class="row">
        <textarea ref=${taRef} value=${text} rows=${1}
          placeholder="Type a message or /"
          onInput=${(e) => setText(e.target.value)}
          onKeyDown=${(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !coarseEnter) { e.preventDefault(); if (!generating && !busy) send(); }
          }} />
        ${generating
          ? html`<button class="btn danger" onClick=${onStop}>■ Stop</button>`
          : html`<button class="btn primary" disabled=${!!busy} onClick=${send}>${busy ? 'Working…' : 'Send'}</button>`}
      </div>
      ${hint && html`<div class="hint warn">${hint}</div>`}
    </div>`;
}

function ChatPane({ chat, persona, characterNames, generating, suggestions, onPickSuggestion, onRerollSuggestions,
                  onSubmitInput, onStop, composerInject, auxBusy, dateFormat, ...actions }) {
  const logRef = useRef(null);
  const path = useMemo(() => getActivePath(chat?.messages, chat?.activeLeafId), [chat]);
  // Stick-to-bottom: follow content growth only while the user is pinned to
  // the bottom zone (~80px). Programmatic scrolls are flagged so they don't
  // unpin/re-pin themselves via the scroll listener.
  const pinnedRef = useRef(true);
  const programmaticRef = useRef(false);
  const lastTopRef = useRef(0); // for detecting user-initiated upward scrolls
  const [pinned, setPinned] = useState(true);
  // "Jump to latest" is deliberately shy: it only appears once the latest
  // message (e.g. the one being generated) is entirely scrolled out of view —
  // not merely when the user nudges up a few px from the bottom.
  const [showJump, setShowJump] = useState(false);
  const computeJump = () => {
    const el = logRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const msgs = el.querySelectorAll(':scope > .msg');
    const lastH = msgs.length ? msgs[msgs.length - 1].offsetHeight : 0;
    const show = dist > lastH + 40;
    setShowJump(prev => prev === show ? prev : show);
  };
  const scrollToBottom = () => {
    const el = logRef.current;
    if (!el) return;
    programmaticRef.current = true;
    el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setPinned(true);
    setShowJump(false);
  };
  const onLogScroll = () => {
    const el = logRef.current;
    if (!el) return;
    const top = el.scrollTop;
    if (programmaticRef.current) { programmaticRef.current = false; lastTopRef.current = top; return; }
    const dist = el.scrollHeight - top - el.clientHeight;
    let p = pinnedRef.current;
    // Any user-initiated upward scroll unpins immediately — during streaming,
    // an 80px threshold just snaps you back before you can escape it.
    if (top < lastTopRef.current - 1) p = false;
    else if (dist < 40) p = true; // deliberately scrolling to the bottom re-pins
    lastTopRef.current = top;
    if (p !== pinnedRef.current) { pinnedRef.current = p; setPinned(p); }
    computeJump();
  };
  useEffect(() => { // follow growth only when pinned
    const el = logRef.current;
    if (pinnedRef.current) {
      if (el) { programmaticRef.current = true; el.scrollTop = el.scrollHeight; }
    } else computeJump(); // content grew while unpinned — jump may newly apply
  }, [chat, generating, suggestions]);
  useEffect(() => { // new chat → start pinned at the bottom
    pinnedRef.current = true;
    setPinned(true);
    setShowJump(false);
    const el = logRef.current;
    if (el) { programmaticRef.current = true; el.scrollTop = el.scrollHeight; }
  }, [chat?.id]);
  if (!chat) return html`
    <div class="main"><div class="chatlog"><div class="empty">
      <div style=${{ fontSize: '22px' }}>FictionPad</div>
      <div>Create a scenario in the sidebar, then start a chat from it.<br/>
      Configure an OpenAI-compatible endpoint in Settings to begin generating.</div>
    </div></div></div>`;
  const personaName = persona?.name?.trim() || 'User';
  const leaf = path[path.length - 1];
  const showSugg = !generating && leaf?.role === 'assistant'
    && suggestions?.chatId === chat.id && suggestions?.nodeId === leaf.id;
  return html`
    <div class="main">
      <div class="chatlog" ref=${logRef} onScroll=${onLogScroll}>
        ${path.map((node, i) => html`
          <${MessageItem} key=${node.id} node=${node} index=${i + 1} isRoot=${!node.parentId} isLeaf=${node.id === leaf?.id}
            personaName=${personaName} characterNames=${characterNames}
            streaming=${generating?.nodeId === node.id}
            generating=${!!generating}
            dateFormat=${dateFormat}
            onEdit=${actions.onEdit} onRegenerate=${actions.onRegenerate} onSwipe=${actions.onSwipe}
            onSwipeTo=${actions.onSwipeTo}
            onBranch=${actions.onBranch} onRewind=${actions.onRewind} onDelete=${actions.onDeleteMsg}
            onReply=${actions.onReply} onRegenFromToken=${actions.onRegenFromToken} />`)}
        ${showSugg && html`
          <div class="sugg-row">
            ${suggestions.loading
              ? html`<span class="hint">Thinking of options…</span>`
              : html`
                  ${(suggestions.swipe === leaf.activeSwipe ? suggestions.items ?? [] : []).map((s, i) => html`
                    <button key=${i} class="sugg-chip" onClick=${() => onPickSuggestion(s)}>${s}</button>`)}
                  <button class="btn small ghost" title="Re-roll suggestions" onClick=${onRerollSuggestions}>⟳</button>
                `}
          </div>`}
      </div>
      ${showJump && html`
        <button class="jump-latest" title="Scroll to the latest message" onClick=${scrollToBottom}>↓ Jump to latest</button>`}
      ${!generating && leaf?.role === 'user' && html`
        <div class="gen-reply">
          <button class="btn primary" onClick=${() => actions.onGenerateReply()}>✦ Generate response</button>
        </div>`}
      <${Composer} generating=${!!generating} busy=${auxBusy} onSubmit=${onSubmitInput} onStop=${onStop} inject=${composerInject} />
    </div>`;
}

// ============================================================================
// COMPONENTS: SIDEBAR — collapsible Scenarios / Characters / Chats sections.
// A collapsed section still shows the entries tied to the open chat (its
// scenario, its linked global characters, the chat itself) so the current
// context never vanishes. Collapse state persists in fictionpad.ui.
// ============================================================================
function Sidebar({ scenarios, chats, characters, selectedScenarioId, selectedCharacterId, selectedChatId,
                  onSelectScenario, onSelectCharacter, onSelectChat,
                  onNewScenario, onEditScenario, onDeleteScenario, onNewChat,
                  onNewCharacter, onEditCharacter, onDeleteCharacter, onNewCharacterChat,
                  onExportScenario, onExportCharacter, onImport,
                  onOpenPersonas, onOpenSettings, collapsed, onDeleteChat,
                  sideCollapsed, onToggleSection,
                  storageKind, saveRetrying,
                  width, onDragStart, onResetWidth, onChatAction, onChatContextMenu }) {
  const openChat = chats[selectedChatId] ?? null;
  const chatList = Object.values(chats)
    .filter(c => selectedScenarioId ? c.scenarioId === selectedScenarioId
      : selectedCharacterId ? (c.characterIds ?? []).includes(selectedCharacterId)
      : true)
    .sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0));
  const scenarioList = Object.values(scenarios).sort((a, b) => a.name.localeCompare(b.name));
  const characterList = Object.values(characters ?? {}).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  // Entries that stay visible while their section is collapsed: whatever the
  // open chat is built from.
  const pinScenarioId = openChat?.scenarioId ?? null;
  const pinCharIds = new Set([
    ...(scenarios[openChat?.scenarioId]?.characterIds ?? []),
    ...(openChat?.characterIds ?? []),
  ].filter(id => characters?.[id]));
  const shownScenarios = sideCollapsed.scenarios ? scenarioList.filter(s => s.id === pinScenarioId) : scenarioList;
  const shownCharacters = sideCollapsed.characters ? characterList.filter(c => pinCharIds.has(c.id)) : characterList;
  const shownChats = sideCollapsed.chats ? chatList.filter(c => c.id === selectedChatId) : chatList;
  // Long-press (touch) → same context menu as right-click. Cancelled by movement.
  const lp = useRef(null);
  const lpStart = (e, id) => {
    if (e.pointerType === 'mouse') return;
    const { clientX: x, clientY: y } = e;
    lp.current = { x, y, timer: setTimeout(() => { lp.current = null; onChatContextMenu(id, x, y); }, 500) };
  };
  const lpCancel = (e) => {
    if (!lp.current) return;
    if (e.type === 'pointermove'
        && Math.abs(e.clientX - lp.current.x) < 10 && Math.abs(e.clientY - lp.current.y) < 10) return;
    clearTimeout(lp.current.timer);
    lp.current = null;
  };
  const act = (e, id, action) => { e.stopPropagation(); onChatAction(id, action); };
  const sectionTitle = (key, label, onAdd, addTitle) => html`
    <div class="title">
      <span class="t-toggle" onClick=${() => onToggleSection(key)}>
        ${sideCollapsed[key] ? '▸' : '▾'} ${label}
      </span>
      ${onAdd && html`<button class="btn small ghost" title=${addTitle} onClick=${onAdd}>＋</button>`}
    </div>`;
  return html`
    <div class="sidebar ${collapsed ? 'collapsed' : ''}"
      style=${{ width: collapsed ? 0 : width, minWidth: collapsed ? 0 : width }}>
      <div class="scroll">
        <div class="side-section">
          ${sectionTitle('scenarios', 'Scenarios', onNewScenario, 'New scenario')}
          ${shownScenarios.length === 0 && !sideCollapsed.scenarios
            && html`<div class="hint" style=${{ padding: '0 6px' }}>No scenarios yet.</div>`}
          ${shownScenarios.map(s => html`
            <div class="side-item ${s.id === selectedScenarioId ? 'selected' : ''}" key=${s.id}
              onClick=${() => onSelectScenario(s.id === selectedScenarioId ? null : s.id)}>
              <span class="name">${s.name}</span>
              <span class="tools">
                <button class="btn small ghost" title="New chat from this scenario"
                  onClick=${(e) => { e.stopPropagation(); onNewChat(s.id); }}>✉\uFE0E</button>
                <button class="btn small ghost" title="Edit"
                  onClick=${(e) => { e.stopPropagation(); onEditScenario(s.id); }}>✎</button>
                <button class="btn small ghost" title="Export JSON"
                  onClick=${(e) => { e.stopPropagation(); onExportScenario(s.id); }}>⤓</button>
                <button class="btn small ghost" title="Delete"
                  onClick=${(e) => { e.stopPropagation(); confirm(`Delete scenario "${s.name}"? Its chats are NOT deleted.`) && onDeleteScenario(s.id); }}>✕</button>
              </span>
            </div>`)}
        </div>
        <div class="side-section">
          ${sectionTitle('characters', 'Characters', onNewCharacter, 'New character')}
          ${shownCharacters.length === 0 && !sideCollapsed.characters
            && html`<div class="hint" style=${{ padding: '0 6px' }}>No characters yet.</div>`}
          ${shownCharacters.map(c => html`
            <div class="side-item ${c.id === selectedCharacterId ? 'selected' : ''}" key=${c.id}
              onClick=${() => onSelectCharacter(c.id === selectedCharacterId ? null : c.id)}>
              <span class="name">${c.name}</span>
              <span class="tools">
                <button class="btn small ghost" title="New chat with this character"
                  onClick=${(e) => { e.stopPropagation(); onNewCharacterChat(c.id); }}>✉\uFE0E</button>
                <button class="btn small ghost" title="Edit"
                  onClick=${(e) => { e.stopPropagation(); onEditCharacter(c.id); }}>✎</button>
                <button class="btn small ghost" title="Export JSON"
                  onClick=${(e) => { e.stopPropagation(); onExportCharacter(c.id); }}>⤓</button>
                <button class="btn small ghost" title="Delete"
                  onClick=${(e) => { e.stopPropagation(); confirm(`Delete character "${c.name}"? Scenario/chat links become inert.`) && onDeleteCharacter(c.id); }}>✕</button>
              </span>
            </div>`)}
        </div>
        <div class="side-section">
          ${sectionTitle('chats', `Chats${(selectedScenarioId || selectedCharacterId) ? '' : ' (all)'}`, null, null)}
          ${shownChats.length === 0 && !sideCollapsed.chats && html`<div class="hint" style=${{ padding: '0 6px' }}>No chats yet. Use ✉\uFE0E on a scenario or character.</div>`}
          ${shownChats.map(c => html`
            <div class="side-item chat ${c.id === selectedChatId ? 'selected' : ''}" key=${c.id}
              onClick=${() => onSelectChat(c.id)}
              onContextMenu=${(e) => { e.preventDefault(); onChatContextMenu(c.id, e.clientX, e.clientY); }}
              onPointerDown=${(e) => lpStart(e, c.id)}
              onPointerMove=${lpCancel} onPointerUp=${lpCancel} onPointerCancel=${lpCancel}>
              <span class="name">${c.name}</span>
              <span class="tools">
                <button class="btn small ghost" title="Chat panel (options / inspector / memory)"
                  onClick=${(e) => act(e, c.id, 'inspector')}>▦</button>
                <button class="btn small ghost" title="Rename"
                  onClick=${(e) => act(e, c.id, 'rename')}>✎</button>
                <button class="btn small ghost" title="Export JSON"
                  onClick=${(e) => act(e, c.id, 'export')}>⤓</button>
                <button class="btn small ghost" title="Delete chat"
                  onClick=${(e) => act(e, c.id, 'delete')}>✕</button>
              </span>
            </div>`)}
        </div>
      </div>
      <div class="foot">
        <button class="btn small ghost" onClick=${onImport}>Import</button>
        <button class="btn small ghost" title="Personas" onClick=${onOpenPersonas}>Personas</button>
        <button class="btn small ghost" onClick=${onOpenSettings}>Settings</button>
        <span class="hint ${saveRetrying ? 'warn' : ''}" style=${{ marginLeft: 'auto', alignSelf: 'center' }}
          title=${saveRetrying
            ? 'Some edits could not be saved (server unreachable) — they are queued and retried automatically.'
            : storageKind === 'server'
              ? 'Scenarios, personas, characters and chats are stored on this server (shared).'
              : 'Data is stored locally in this browser.'}>
          ${saveRetrying ? '⚠\uFE0E saving…' : storageKind === 'server' ? 'server storage' : 'local storage'}</span>
      </div>
      ${!collapsed && html`<div class="pane-handle right" title="Drag to resize · double-click to reset"
        onPointerDown=${(e) => { e.preventDefault(); onDragStart(e.clientX); }}
        onDoubleClick=${onResetWidth} />`}
    </div>`;
}
// ============================================================================
// COMPONENTS: NEW CHAT MODAL (scenario or global character → pick persona)
// ============================================================================
function NewChatModal({ scenario, character, personas, onCreate, onClose }) {
  const list = Object.values(personas);
  const [personaId, setPersonaId] = useState(list[0]?.id ?? '');
  const [newName, setNewName] = useState('');
  return html`
    <${Modal} title=${`New chat — ${scenario?.name ?? character?.name ?? ''}`} onClose=${onClose}
      footer=${html`<button class="btn primary" onClick=${() => onCreate(personaId, newName)}>Start chat</button>`}>
      ${character && !scenario && html`
        <div class="hint">Direct chat with ${character.name} — no scenario. The character's greeting opens the chat; its card behaves like a linked character (edits apply live).</div>`}
      <label class="field"><span>Persona ({{user}})</span>
        <select value=${personaId} onChange=${(e) => setPersonaId(e.target.value)}>
          <option value="">— none ({{user}} → "User") —</option>
          ${list.map(p => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}
        </select></label>
      <label class="field"><span>…or create a persona inline (used when nothing is selected above)</span>
        <input type="text" placeholder="New persona name" value=${newName} onInput=${(e) => setNewName(e.target.value)} />
      </label>
    <//>`;
}

// ============================================================================
// COMPONENTS: RECAP MODAL (/recap result — copy or save as memory)
// ============================================================================
function RecapModal({ text, onSaveMemory, onClose }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  return html`
    <${Modal} title="Recap" wide onClose=${onClose}
      footer=${html`
        <button class="btn" disabled=${copied}
          onClick=${async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch {} }}>
          ${copied ? 'Copied ✓' : 'Copy'}</button>
        <button class="btn primary" disabled=${saved}
          onClick=${() => { onSaveMemory(); setSaved(true); }}>
          ${saved ? 'Saved ✓' : 'Save as memory'}</button>
      `}>
      <div style=${{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>${text}</div>
    <//>`;
}

// ============================================================================
// COMPONENTS: CONTEXT MENU (chat rows — right-click / long-press)
// ============================================================================
function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  const style = {
    left: Math.max(4, Math.min(x, window.innerWidth - 190)),
    top: Math.max(4, Math.min(y, window.innerHeight - items.length * 34 - 12)),
  };
  return html`
    <div class="ctx-menu" ref=${ref} style=${style}>
      ${items.map((it, i) => it === '-'
        ? html`<div key=${i} class="ctx-sep" />`
        : html`<button key=${i} class="ctx-item ${it.danger ? 'danger' : ''}"
            onClick=${() => { onClose(); it.fn(); }}>${it.label}</button>`)}
    </div>`;
}

// ============================================================================
// COMPONENTS: CHAT PANEL — the former right pane as a tabbed modal sheet
// (Inspector / Memory / Chat). Centered dialog on desktop, full-screen sheet
// on phones (CSS .modal.sheet).
// ============================================================================
const PANEL_TABS = { inspector: 'Inspector', memory: 'Memory', chat: 'Chat' };

function ChatPanelModal({ chat, tab, onTab, manifest, realCounts, onPreview, auxLog, personas, scenario, characters,
                         onUpdateChat, onSummarize, summarizing, onExport, onDelete, onClose, dateFormat, memoryEvery }) {
  return html`
    <${Modal} title=${chat.name} cls="sheet" onClose=${onClose}>
      <div class="ptabs">
        ${Object.entries(PANEL_TABS).map(([t, label]) => html`
          <button key=${t} class=${tab === t ? 'active' : ''} onClick=${() => onTab(t)}>${label}</button>`)}
      </div>
      <div class="pbody">
        ${tab === 'inspector' && html`
          <${ContextInspector} manifest=${manifest} hasChat=${true} onPreview=${onPreview} realCounts=${realCounts} auxLog=${auxLog} />`}
        ${tab === 'memory' && html`
          <${MemoryPanel} chat=${chat} onUpdateChat=${onUpdateChat} onSummarize=${onSummarize} summarizing=${summarizing} dateFormat=${dateFormat} memoryEvery=${memoryEvery} />`}
        ${tab === 'chat' && html`
          <${ChatOptions} chat=${chat} personas=${personas} scenario=${scenario} characters=${characters} onUpdateChat=${onUpdateChat}
            onExport=${onExport} onDelete=${onDelete} />`}
      </div>
    <//>`;
}

// ============================================================================
// COMPONENTS: RIGHT DRAWER — docked Inspector/Memory/Chat pane (the per-chat
// modal above remains for chat-row/context-menu entry). Fixed overlay on the
// right like the left sidebar, drag-resizable on desktop, slide-in overlay on
// phones.
// ============================================================================
const DRAWER_TABS = { inspector: 'Inspector', memory: 'Memory', chat: 'Chat' };

function RightDrawer({ chat, tab, onTab, manifest, realCounts, onPreview, auxLog,
                      personas, scenario, characters, onExport, onDelete,
                      onUpdateChat, onSummarize, summarizing,
                      width, onDragStart, onResetWidth, onClose, dateFormat, memoryEvery }) {
  return html`
    <div class="drawer ${tab ? '' : 'collapsed'}"
      style=${{ width: tab ? width : 0, minWidth: tab ? width : 0 }}>
      <div class="head">
        <div class="ptabs">
          ${Object.entries(DRAWER_TABS).map(([t, label]) => html`
            <button key=${t} class=${tab === t ? 'active' : ''} onClick=${() => onTab(t)}>${label}</button>`)}
        </div>
        <button class="btn small ghost" title="Close panel" onClick=${onClose}>✕</button>
      </div>
      <div class="pbody">
        ${!chat && html`<div class="hint">Select a chat to inspect its context and memories.</div>`}
        ${chat && tab === 'inspector' && html`
          <${ContextInspector} manifest=${manifest} hasChat=${true} onPreview=${onPreview} realCounts=${realCounts} auxLog=${auxLog} />`}
        ${chat && tab === 'memory' && html`
          <${MemoryPanel} chat=${chat} onUpdateChat=${onUpdateChat} onSummarize=${onSummarize} summarizing=${summarizing} dateFormat=${dateFormat} memoryEvery=${memoryEvery} />`}
        ${chat && tab === 'chat' && html`
          <${ChatOptions} chat=${chat} personas=${personas} scenario=${scenario} characters=${characters}
            onUpdateChat=${onUpdateChat} onExport=${onExport} onDelete=${onDelete} />`}
      </div>
      ${tab && html`<div class="pane-handle left" title="Drag to resize · double-click to reset"
        onPointerDown=${(e) => { e.preventDefault(); onDragStart(e.clientX); }}
        onDoubleClick=${onResetWidth} />`}
    </div>`;
}

// ============================================================================
// COMPONENTS: CHARACTER EDITOR — global reusable character cards. A character
// resolves to a character-type lore piece wherever it's linked (scenarios via
// scenario.characterIds, chats via chat.characterIds) and flows through the
// normal lore pipeline — edits to the card apply live everywhere it's linked.
// The sidebar's ＋ / ✎ open this editor directly; Save upserts and closes.
// ============================================================================
function newCharacter() {
  return {
    id: uid(), name: '', content: '', keys: [],
    pinned: false, weight: 0, smart: false, enabled: true,
    greeting: '', // first assistant message of chats started directly with this character
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

function CharacterEditor({ character, scenarios, onUpsert, onClose }) {
  const [editing, setEditing] = useState(() => character ? deepClone(character) : newCharacter());
  const linkCount = (id) => Object.values(scenarios).filter(s => (s.characterIds ?? []).includes(id)).length;
  return html`
    <${Modal} title=${character ? `Character — ${character.name}` : 'New character'} wide onClose=${onClose}>
      <label class="field"><span>Name — speaker name; also the default trigger key</span>
        <input type="text" value=${editing.name} onInput=${(e) => setEditing({ ...editing, name: e.target.value })} /></label>
      <label class="field"><span>Character card — sent to the AI when active. {{user}} works here.</span>
        <textarea rows=${6} value=${editing.content} onInput=${(e) => setEditing({ ...editing, content: e.target.value })} /></label>
      <label class="field"><span>Trigger keys — one per line, regex; blank = the character's name</span>
        <${ListInput} textarea=${true} delim=${'\n'} rows=${3} values=${editing.keys}
          onChange=${(keys) => setEditing({ ...editing, keys })} /></label>
      <label class="field"><span>Greeting — first message of chats started directly with this character</span>
        <textarea rows=${4} value=${editing.greeting ?? ''}
          onInput=${(e) => setEditing({ ...editing, greeting: e.target.value })} /></label>
      <div class="grid2">
        <label class="field"><span>Weight — higher wins when the lore budget is tight</span>
          <input type="number" value=${editing.weight ?? 0}
            onInput=${(e) => setEditing({ ...editing, weight: Number(e.target.value) })} /></label>
        <div class="field"><span>Activation</span>
          <label class="check" title="Always injected while linked">
            <input type="checkbox" checked=${!!editing.pinned}
              onChange=${(e) => setEditing({ ...editing, pinned: e.target.checked })} /> pinned</label>
          <label class="check" title="Semantic activation — requires an embeddings model in Settings">
            <input type="checkbox" checked=${!!editing.smart}
              onChange=${(e) => setEditing({ ...editing, smart: e.target.checked })} /> smart</label>
          <label class="check">
            <input type="checkbox" checked=${editing.enabled !== false}
              onChange=${(e) => setEditing({ ...editing, enabled: e.target.checked })} /> enabled</label>
        </div>
      </div>
      ${linkCount(editing.id) > 0 && html`
        <div class="hint">Linked into ${linkCount(editing.id)} scenario(s) — edits apply live to their chats.</div>`}
      <div style=${{ display: 'flex', gap: '8px' }}>
        <button class="btn primary" disabled=${!editing.name.trim()}
          onClick=${() => { onUpsert(editing.id, { ...editing, updatedAt: Date.now() }); onClose(); }}>Save</button>
        <button class="btn" onClick=${onClose}>Cancel</button>
      </div>
    <//>`;
}
// ============================================================================
// APP — wires storage, collections, generation orchestration, and the panels.
// ============================================================================
// Chat factory. Scenario chats snapshot the scenario greeting; direct
// character chats (scenarioId null, chat.characterIds set) snapshot the
// character's greeting — possibly empty: the root node is parentless, so
// pruneInterrupted never drops it.
function newChat({ scenario = null, character = null, personaId = null, dateFormat } = {}) {
  const rootId = uid();
  const baseName = scenario?.name ?? (character ? `Chat with ${character.name}` : 'Chat');
  return {
    id: uid(), scenarioId: scenario?.id ?? null, personaId,
    ...(character ? { characterIds: [character.id] } : {}),
    name: `${baseName} — ${fmtDate(Date.now(), dateFormat)}`,
    customInstructions: '',
    rootMessageId: rootId, activeLeafId: rootId,
    messages: {
      [rootId]: { id: rootId, parentId: null, role: 'assistant', edited: false, activeSwipe: 0,
        swipes: [{ text: scenario?.greeting ?? character?.greeting ?? '', createdAt: Date.now(), modelId: null }] },
    },
    memoryStore: { memories: [], cursor: 0 },
    settings: {},
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

// User-defined tools (Settings → Features): advertised to the model after the
// built-ins, executed by action kind in applyToolCall. Built-in names are
// reserved — a custom def can never shadow register_character / add_lore.
const enabledCustomTools = (st) => (st.customTools ?? []).filter(t => t?.name?.trim()
  && t.name !== 'register_character' && t.name !== 'add_lore');

// Full system-prompt head: platform prompt + enabled feature prompts (multi-
// speaker, tool calling + user-defined tools). Shared by runGeneration and
// the inspector preview so both count exactly what a generation would send.
function buildPlatformPrompt(st) {
  const defs = enabledCustomTools(st);
  const customSection = defs.length
    ? '\nAdditional tools:\n' + defs.map(t =>
        `- ${t.name.trim()}(${t.argsHint?.trim() || '…'}) — ${t.description?.trim() || 'custom tool'}`).join('\n')
    : '';
  return [
    st.platformPrompt,
    ...(st.multiSpeaker !== false ? [(st.speakerPrompt ?? '').trim() || SPEAKER_PROMPT] : []),
    ...(st.toolsEnabled !== false ? [((st.toolsPrompt ?? '').trim() || TOOLS_PROMPT) + customSection] : []),
  ].filter(s => s?.trim()).join('\n\n');
}

// Side-pane sizing: manual widths persist in fictionpad.ui (sbWidth/dwWidth);
// when unset, a pane auto-sizes to consume the slack margin around the chat
// column: clamp(MIN, (viewport − chatW)/2 − gap, AUTO_MAX).
const PANE_MIN = 200, PANE_MAX_VW = 0.5, PANE_AUTO_MAX = 640, PANE_GAP = 16;

function Main({ storage, storageKind, storageFailed }) {
  // Request-time endpoint rewrite ("route via server") — never persisted.
  const effEp = (st) => effectiveEndpoint(st, storageKind === 'server');
  const [scenarios, upsertScenario, removeScenario] = useStoredMap(storage, 'Scenarios');
  const [personas, upsertPersona, removePersona] = useStoredMap(storage, 'Personas');
  const [chats, upsertChat, removeChat] = useStoredMap(storage, 'Chats');
  const [characters, upsertCharacter, removeCharacter] = useStoredMap(storage, 'Characters');
  const [settingsRaw, setSettings] = usePersistentState('fictionpad.settings', DEFAULT_SETTINGS);
  const settings = useMemo(() => ({
    ...DEFAULT_SETTINGS, ...(settingsRaw ?? {}),
    samplers: { ...DEFAULT_SETTINGS.samplers, ...(settingsRaw?.samplers ?? {}) },
    layerCaps: { ...DEFAULT_SETTINGS.layerCaps, ...(settingsRaw?.layerCaps ?? {}) },
  }), [settingsRaw]);
  // Settings sync via server storage: Meta/app.settings is the shared source
  // when server storage is active (server wins at boot, last-write-wins after).
  // serverToken is a per-device credential — stripped on upload, preserved
  // locally on download. localStorage remains the offline cache/fallback.
  const SETTINGS_SYNC_KEY = 'app.settings';
  const settingsSync = useRef({ adopted: false, lastWritten: null });
  useEffect(() => { // adopt the server copy once at boot
    if (storageKind !== 'server') return;
    const remote = storage.get('Meta', SETTINGS_SYNC_KEY);
    if (remote && typeof remote === 'object') {
      setSettings(prev => ({ ...remote, serverToken: prev?.serverToken ?? '' }));
      // Skip the pre-adoption upload: the write effect fires in this same
      // commit with the *local* settings — don't let them clobber the server.
      settingsSync.current.lastWritten = settingsRaw;
    }
    settingsSync.current.adopted = true;
  }, [storageKind]);
  useEffect(() => { // upload on every change (token stripped; first boot seeds it)
    if (storageKind !== 'server' || !settingsSync.current.adopted) return;
    if (settingsSync.current.lastWritten === settingsRaw) return;
    settingsSync.current.lastWritten = settingsRaw;
    const { serverToken, ...rest } = settingsRaw ?? {};
    storage.set('Meta', SETTINGS_SYNC_KEY, rest);
  }, [settingsRaw, storageKind]);
  const [ui, setUi] = usePersistentState('fictionpad.ui', { scenarioId: null, chatId: null, drawer: null, sidebarCollapsed: false });
  const [theme, setTheme] = usePersistentState('fictionpad.theme', 'miku');
  const [accent, setAccent] = usePersistentState('fictionpad.accent', DEFAULT_ACCENT);
  useEffect(() => applyTheme(theme, accent), [theme, accent]);
  // Inspector data is cached per chat: opening another chat's panel shows ITS
  // last recorded manifest (or the empty state), never the wrong chat's.
  const [manifests, setManifests] = useState({}); // chatId -> { manifest, lastMessages }
  const setManifestFor = (chatId, man, msgs) =>
    setManifests(m => (chatId ? { ...m, [chatId]: { manifest: man, lastMessages: msgs } } : m));
  const manifest = manifests[ui.chatId]?.manifest ?? null;
  const lastMessages = manifests[ui.chatId]?.lastMessages ?? null; // chat-completions array behind manifest
  const [realCounts, setRealCounts] = useState(null); // /tokenize counts {static,lore,memory,total} | null
  const [modal, setModal] = useState(null);
  const [generating, setGenerating] = useState(null); // { chatId, nodeId }
  const [summarizing, setSummarizing] = useState(false);
  const [suggestions, setSuggestions] = useState(null); // { chatId, nodeId, swipe, loading, items } | null
  const [composerInject, setComposerInject] = useState(null); // { text?, hint?, nonce }
  const [auxBusy, setAuxBusy] = useState(null); // 'improve' | 'recap' | 'memory' | null
  const [error, setError] = useState(null);
  const genRef = useRef(null); // { abort }

  // Aux-call observability: memory/lore-extract/suggestions//improve//recap are
  // separate requests that never touch the main context, so the manifest can't
  // show them. Keep a short session log (last 12) of what was sent and what
  // came back; the Inspector renders it as its own section.
  const [auxLog, setAuxLog] = useState([]);
  async function auxLogged(kind, args) {
    const entry = { kind, at: Date.now(), model: args.model ?? '', system: args.system ?? '', user: args.user ?? '' };
    try {
      const out = await auxCall(args);
      setAuxLog(log => [...log.slice(-11), { ...entry, ok: true, out: out ?? '' }]);
      return out;
    } catch (e) {
      setAuxLog(log => [...log.slice(-11), { ...entry, ok: false, out: String(e?.message ?? e) }]);
      throw e;
    }
  }

  // Always-fresh refs for async generation loops (avoid stale closures).
  const ref = useRef({});
  ref.current = { scenarios, personas, chats, characters, settings };

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 9000);
    return () => clearTimeout(t);
  }, [error]);

  // Real token counts for the inspector — debounced, async, silently absent
  // when /tokenize is unavailable. Estimates remain the fallback.
  useEffect(() => {
    setRealCounts(null);
    if (!manifest?.layers || !lastMessages?.length) return;
    const st = ref.current.settings;
    const model = ref.current.chats[ui.chatId]?.settings?.model || st.model;
    if (!st.endpoint || !model) return;
    let alive = true;
    const t = setTimeout(async () => {
      const count = (text) => text
        ? getTokenCount({ endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model, text })
        : Promise.resolve(null);
      // Reconstruct the exact blocks as sent from the same message array.
      const sysBlocks = lastMessages.filter(m => m.role === 'system');
      const rest = lastMessages.slice(sysBlocks.length);
      const hasGreeting = rest[0]?.role === 'assistant';
      const [s, l, m2, g, h, tot] = await Promise.all([
        count(sysBlocks[0]?.content),
        count(sysBlocks.find(m => m.content.startsWith('[World Info]'))?.content),
        count(sysBlocks.find(m => m.content.startsWith('[Memories]'))?.content),
        count(hasGreeting ? rest[0].content : ''),
        count((hasGreeting ? rest.slice(1) : rest).map(m => m.content).join('\n')),
        count(lastMessages.map(m => m.content).join('\n')),
      ]);
      if (alive) setRealCounts({ static: s, lore: l, memory: m2, greeting: g, history: h, total: tot });
    }, 500);
    return () => { alive = false; clearTimeout(t); };
  }, [manifest, lastMessages]);

  const chat = chats[ui.chatId] ?? null;
  // On chat open/switch (incl. after branching): drop debris from generations
  // killed by a reload, then default to the swipes the conversation actually
  // continued from. In-session browsing is unaffected.
  useEffect(() => {
    const c = ref.current.chats[ui.chatId];
    if (!c) return;
    const next = applyUsedSwipes(pruneInterrupted(c));
    if (next !== c) upsertChat(next.id, next);
  }, [ui.chatId]);
  const persona = chat?.personaId ? personas[chat.personaId] : null;
  const personaName = persona?.name?.trim() || 'User';
  const characterNames = useMemo(
    () => characterNamesOf(chat ? scenarios[chat.scenarioId] : null, chat, characters),
    [chat, scenarios, characters]);
  const sidebarCollapsed = ui.sidebarCollapsed ?? (window.innerWidth <= 700); // phones start with the drawer closed
  const toggleSidebar = () => setUi(u => ({ ...u, sidebarCollapsed: !sidebarCollapsed }));
  // Right drawer: ui.drawer is the open tab ('inspector' | 'memory' | 'chat') or null.
  const toggleDrawer = (tab) => setUi(u => ({ ...u, drawer: u.drawer === tab ? null : tab }));
  const closeDrawer = () => setUi(u => (u.drawer ? { ...u, drawer: null } : u));
  const lastDrawerTabRef = useRef('inspector'); // edge-swipe reopens the last-used tab
  if (ui.drawer) lastDrawerTabRef.current = ui.drawer;
  const saveChat = useCallback((c) => upsertChat(c.id, { ...c, updatedAt: Date.now() }), [upsertChat]);

  // Writes that failed to persist and are queued for retry (Task: never drop).
  const [saveRetrying, setSaveRetrying] = useState(false);
  useEffect(() => {
    const on = (e) => setSaveRetrying(!!e.detail?.retrying);
    storage.addEventListener('savestate', on);
    return () => storage.removeEventListener('savestate', on);
  }, [storage]);

  // ---- side-pane sizing (auto slack-fill + drag-to-resize) ----
  const [viewportW, setViewportW] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const chatW = useMemo(() => {
    const v = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--chat-w'), 10);
    return Number.isFinite(v) ? v : 780;
  }, []);
  const clampPane = (w) => Math.round(Math.max(PANE_MIN, Math.min(w, viewportW * PANE_MAX_VW)));
  const autoPaneW = clampPane(Math.min((viewportW - chatW) / 2 - PANE_GAP, PANE_AUTO_MAX));
  const sbW = sidebarCollapsed ? 0 : clampPane(ui.sbWidth ?? autoPaneW);
  const dwW = ui.drawer ? clampPane(ui.dwWidth ?? autoPaneW) : 0;
  // Narrow-viewport fallback: pad the center column with a pane's actual
  // width only when the slack margin can't contain it — chat never hides.
  // At the phone breakpoint both panes are full overlays (scrim), no sharing.
  const MOBILE_BP = 700;
  const isMobile = viewportW <= MOBILE_BP;
  const padL = !isMobile && viewportW < chatW + 2 * sbW ? sbW : 0;
  const padR = !isMobile && viewportW < chatW + 2 * dwW ? dwW : 0;
  const [dragging, setDragging] = useState(false);
  const paneDragStart = (side) => (startX) => {
    const key = side === 'left' ? 'sbWidth' : 'dwWidth';
    const startW = side === 'left' ? sbW : dwW;
    setDragging(true);
    const onMove = (ev) => {
      const dx = side === 'left' ? ev.clientX - startX : startX - ev.clientX;
      const w = clampPane(startW + dx);
      setUi(u => (u[key] === w ? u : { ...u, [key]: w }));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const resetPaneWidth = (side) => setUi(u => ({ ...u, [side === 'left' ? 'sbWidth' : 'dwWidth']: null }));

  // ---- mobile edge swipes: open/close the two overlay panes ----
  // Left edge → swipe right opens the sidebar; right edge → swipe left opens
  // the Inspector/Memory drawer. Message rows (.msg) are ALWAYS bubble swipe
  // territory — pane gestures never start there, and with a pane open only
  // touches on the pane/scrim itself swipe it shut (scrim tap also closes).
  // Otherwise pane gestures steal bubble swipes near the edges, which reads
  // as "the swipe directions are backwards".
  const navStateRef = useRef({ isMobile, collapsed: sidebarCollapsed, drawer: ui.drawer });
  navStateRef.current = { isMobile, collapsed: sidebarCollapsed, drawer: ui.drawer, lastDrawerTab: lastDrawerTabRef.current };
  useEffect(() => {
    let g = null;
    const down = (e) => {
      if (e.pointerType === 'mouse') return;
      const st = navStateRef.current;
      if (!st.isMobile) return;
      if (e.target.closest?.('.msg')) return; // message rows: bubble navigation only
      if (st.collapsed && !st.drawer) {
        // Both panes closed: an open gesture must start on a screen edge.
        const edge = e.clientX <= 24 ? 'left' : e.clientX >= window.innerWidth - 24 ? 'right' : null;
        if (edge) g = { id: e.pointerId, x: e.clientX, y: e.clientY, edge };
      } else if (e.target.closest?.('.sidebar, .drawer, .scrim')) {
        // A pane is open: swiping it shut starts on the pane/scrim itself.
        g = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }
    };
    const move = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > 2 * Math.abs(dy)) {
        const st = navStateRef.current;
        if (g.edge === 'left') { if (dx > 0 && st.collapsed) toggleSidebar(); }
        else if (g.edge === 'right') { if (dx < 0 && !st.drawer) toggleDrawer(st.lastDrawerTab ?? 'inspector'); }
        else {
          if (dx < 0 && !st.collapsed) toggleSidebar();
          else if (dx > 0 && st.drawer) closeDrawer();
        }
        g = null;
      }
    };
    const up = () => { g = null; };
    for (const [ev, fn] of [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up]])
      window.addEventListener(ev, fn, { passive: true });
    return () => {
      for (const [ev, fn] of [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up]])
        window.removeEventListener(ev, fn);
    };
  }, []);

  // ---- chat row actions + context menu ----
  const [ctxMenu, setCtxMenu] = useState(null); // { chatId, x, y }
  // The panel is a modal view into a chat — it must NOT switch the open chat,
  // or the main pane and the right drawer would jump to it under the modal.
  const openChatPanel = (chatId, tab) => setModal({ kind: 'chatPanel', chatId, tab });
  const chatAction = (chatId, action) => {
    const c = ref.current.chats[chatId];
    if (!c) return;
    switch (action) {
      case 'inspector': return openChatPanel(chatId, 'chat'); // panel opens on the Chat tab; Inspector is one tab over
      case 'memory': return openChatPanel(chatId, 'memory');
      case 'settings': return openChatPanel(chatId, 'chat');
      case 'rename': {
        const name = prompt('Rename chat', c.name);
        if (name?.trim()) saveChat({ ...c, name: name.trim() });
        return;
      }
      case 'export': return onExportChat(c);
      case 'delete': if (confirm(`Delete chat "${c.name}"?`)) onDeleteChat(chatId);
    }
  };

  // ---- storage migration helpers (settings; last write wins per key) ----
  async function migrateUpload() {
    const idb = new IndexedDBAdapter();
    await idb.init();
    const srv = new ServerDBAdapter(ref.current.settings.serverToken ?? '');
    let n = 0;
    for (const store of STORES)
      for (const [key, data] of Object.entries(idb.getAll(store))) {
        await srv.remoteSave(store, key, data);
        n++;
      }
    return n;
  }
  async function migrateDownload() {
    const idb = new IndexedDBAdapter();
    await idb.init();
    const srv = new ServerDBAdapter(ref.current.settings.serverToken ?? '');
    let n = 0;
    for (const store of STORES)
      for (const [key, data] of Object.entries(await srv.remoteAll(store))) {
        await idb.persistPut(store, key, data);
        n++;
      }
    return n;
  }

  // ---- memory subsystem ----
  // Shared memory-card generation (auto-summarize + /memory). Returns the
  // ≤500-char note text, or null when there's nothing to summarize. Throws on
  // endpoint/HTTP errors.
  async function generateMemory(chatObj, messageCount = null) {
    const { personas: pe, settings: st } = ref.current;
    const model = st.auxModel || st.model;
    if (!st.endpoint || !model) throw new Error('Configure an endpoint and model in Settings first.');
    const every = st.memoryEvery ?? MEMORY_EVERY;
    const pName = (chatObj.personaId && pe[chatObj.personaId]?.name?.trim()) || 'User';
    const path = getActivePath(chatObj.messages, chatObj.activeLeafId);
    const recent = path.slice(-(messageCount ?? every))
      .map(n => `${n.role === 'user' ? pName : 'Character'}: ${subUser(activeText(n), pName)}`)
      .join('\n\n');
    if (!recent.trim()) return null;
    const maxChars = st.memoryMaxChars ?? 500;
    const out = await auxLogged('memory', {
      endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model,
      system: subUser(st.memoryPrompt || DEFAULT_MEMORY_PROMPT, pName),
      user: `Recent conversation:\n\n${recent}\n\nMemory note (max ${maxChars} characters):`,
      maxTokens: st.memoryMaxTokens ?? 220, temperature: st.memoryTemp ?? 0.3, stop: st.stopStrings,
    });
    return out.slice(0, maxChars) || null;
  }
  async function summarizeNow(chatObj) {
    setSummarizing(true);
    try {
      const text = await generateMemory(chatObj);
      if (text) {
        const pathLen = getActivePath(chatObj.messages, chatObj.activeLeafId).length;
        const store = addMemory(chatObj.memoryStore, text, Date.now(), ref.current.settings.memoryCap ?? MEMORY_CAP);
        saveChat({ ...chatObj, memoryStore: { ...store, cursor: pathLen } });
      }
    } catch (e) {
      setError(`Memory summarization failed: ${e.message ?? e}`);
    } finally {
      setSummarizing(false);
    }
  }
  function maybeSummarize(chatObj) {
    const every = ref.current.settings.memoryEvery ?? MEMORY_EVERY;
    const pathLen = getActivePath(chatObj.messages, chatObj.activeLeafId).length;
    if (pathLen - (chatObj.memoryStore?.cursor ?? 0) >= every) summarizeNow(chatObj);
  }

  // ---- emergent lore extraction (v2.0d) ----
  // On the memory cadence, an aux call proposes up to 3 NEW lore pieces from
  // the recent conversation. 'queue' mode (default): proposals wait for review
  // in chat settings. 'auto': applied straight to chat lore. 'off': nothing.
  // Failures degrade silently (console.warn) and the cursor still advances.
  async function maybeExtractLore(chatObj) {
    const { scenarios: sc, personas: pe, settings: st } = ref.current;
    const scen = sc[chatObj.scenarioId];
    const mode = scen?.emergentLore ?? 'queue';
    if (mode === 'off' || !st.endpoint) return;
    const model = st.auxModel || st.model;
    if (!model) return;
    const path = getActivePath(chatObj.messages, chatObj.activeLeafId);
    const pathLen = path.length;
    const every = st.memoryEvery ?? MEMORY_EVERY;
    if (pathLen - (chatObj.emergentCursor ?? 0) < every) return;
    const advance = (c) => saveChat({ ...c, emergentCursor: pathLen });
    const pName = (chatObj.personaId && pe[chatObj.personaId]?.name?.trim()) || 'User';
    const recent = path.slice(-every)
      .map(n => `${n.role === 'user' ? pName : 'Narrator'}: ${subUser(activeText(n), pName)}`)
      .join('\n\n');
    if (!recent.trim()) return;
    const titles = mergedLorePieces(scen, chatObj, ref.current.characters).map(p => (p.title ?? '').trim()).filter(Boolean);
    try {
      const out = await auxLogged('lore-extract', {
        endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model,
        system: st.loreExtractPrompt || DEFAULT_LORE_EXTRACT_PROMPT,
        user: `Existing lore: ${titles.join(', ') || '(none)'}\n\nRecent conversation:\n\n${recent}\n\nJSON array:`,
        maxTokens: st.loreExtractMaxTokens ?? 400, temperature: st.loreExtractTemp ?? 0.3, stop: st.stopStrings,
      });
      const m = out.match(/\[[\s\S]*\]/);
      const proposals = m ? JSON.parse(m[0]) : [];
      const existing = new Set(titles.map(t => t.toLowerCase()));
      const queued = new Set((chatObj.loreQueue ?? []).map(q => (q.title ?? '').trim().toLowerCase()));
      const fresh = (Array.isArray(proposals) ? proposals : [])
        .map(p => ({
          title: String(p?.title ?? '').trim().slice(0, TOOL_NAME_MAX),
          content: String(p?.content ?? '').trim().slice(0, TOOL_TEXT_MAX),
          keys: (Array.isArray(p?.keys) ? p.keys : []).map(k => String(k).trim()).filter(k => k.length >= MIN_KEY_LENGTH).slice(0, 5),
        }))
        .filter(p => p.title && p.content
          && !existing.has(p.title.toLowerCase()) && !queued.has(p.title.toLowerCase()))
        .slice(0, Math.max(1, st.loreExtractMax ?? 3));
      if (fresh.length) {
        let work = chatObj;
        if (mode === 'auto') {
          work = applyToolCalls(work, fresh.map(p => ({ name: 'add_lore', args: p })), { now: Date.now() }).chat;
        } else {
          for (const p of fresh) work = queueLorePiece(work, { ...p, source: 'extract' });
        }
        advance(work);
        return;
      }
      advance(chatObj);
    } catch (e) {
      console.warn('Emergent lore extraction failed:', e);
      advance(chatObj);
    }
  }

  // ---- generation ----
  async function runGeneration(chatObj, nodeId, { continuation = false, fresh = false, pov = null } = {}) {
    const { scenarios: sc, personas: pe, characters: gchars, settings: st } = ref.current;
    const model = chatObj.settings?.model || st.model; // per-chat override wins
    if (!st.endpoint || !model) { setError('Configure an endpoint and chat model in Settings first.'); return; }
    // Claim the generation slot immediately — the async prep below (semantic
    // embeddings, exact token count) can take a long time on a slow backend,
    // and the UI (waiting dots, Stop button, input guards) keys off this.
    const abort = new AbortController();
    genRef.current = { abort };
    setGenerating({ chatId: chatObj.id, nodeId });
    const genStart = Date.now(); // for swipe.genMs (prompt-to-completion time)
    const scen = sc[chatObj.scenarioId];
    const pers = chatObj.personaId ? pe[chatObj.personaId] : null;
    const node = chatObj.messages[nodeId];
    // The node being generated is excluded from the prompt unless continuing it.
    const promptChat = continuation ? chatObj : { ...chatObj, activeLeafId: node?.parentId ?? chatObj.activeLeafId };
    // Semantic lore activation (async, outside the pure assembler): embed the
    // recent conversation + smart pieces, threshold → preActivated id set.
    // Scores for every scored piece go on the manifest so the Inspector can
    // show near-misses. Any embeddings failure degrades to keyword-only with
    // a manifest warning.
    let preActivated = null;
    let semanticWarning = null;
    let semanticReport = null;
    const semThreshold = typeof st.semanticThreshold === 'number' ? st.semanticThreshold : SEMANTIC_THRESHOLD;
    if (st.embeddingModel) {
      const smartPieces = mergedLorePieces(scen, chatObj, gchars).filter(p => p && p.enabled !== false && !p.pinned && p.smart);
      const queryText = getActivePath(promptChat.messages, promptChat.activeLeafId)
        .map(activeText).join('\n').slice(-1500);
      if (smartPieces.length && queryText.trim()) {
        try {
          const [queryVec] = await embed({ endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model: st.embeddingModel, inputs: [queryText] });
          const vecs = await Promise.all(smartPieces.map(p =>
            embedCached({ endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model: st.embeddingModel,
              text: `${p.title ?? ''}\n${(p.content ?? '').slice(0, 500)}` })));
          preActivated = new Set();
          semanticReport = { threshold: semThreshold, scores: [] };
          for (let i = 0; i < smartPieces.length; i++) {
            const score = cosine(queryVec, vecs[i]);
            if (score >= semThreshold) preActivated.add(smartPieces[i].id);
            semanticReport.scores.push({ id: smartPieces[i].id, title: smartPieces[i].title ?? '', score });
          }
        } catch (e) {
          console.warn('Semantic lore activation failed:', e);
          semanticWarning = 'Semantic lore activation failed (embeddings); keyword-only for this generation.';
        }
      }
    }
    let { messages, manifest: man } = assemblePrompt({
      scenario: scen, persona: pers, chat: promptChat, settings: st,
      platformPrompt: buildPlatformPrompt(st),
      preActivated, pov, characters: gchars,
    });
    if (semanticWarning) man.warnings.push(semanticWarning);
    if (semanticReport) man.semantic = semanticReport;
    // Exact-count overflow guard: the assembler budgets on char estimates,
    // which can undercount. When /tokenize is available, count the fixed head
    // (static + lore + memory + greeting) exactly and drop oldest history
    // messages until the estimated remainder fits the real headroom.
    // Silently skipped (estimates stand) when tokenize is unavailable.
    {
      const nSys = messages.filter(m => m.role === 'system').length;
      const hasGreeting = (man.layers.greeting?.tokens ?? 0) > 0;
      const head = messages.slice(0, nSys + (hasGreeting ? 1 : 0));
      const hist = messages.slice(head.length);
      const headTok = hist.length
        ? await getTokenCount({ endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model,
            text: head.map(m => m.content).join('\n') })
        : null;
      if (headTok != null) {
        const headroom = man.budget - headTok;
        const estT = (t) => estimateTokens(t, st.tokenChars);
        let estHist = hist.reduce((t, m) => t + estT(m.content), 0);
        let extraDrops = 0;
        while (estHist > headroom && hist.length > 1) {
          estHist -= estT(hist.shift().content);
          extraDrops++;
        }
        if (extraDrops > 0) {
          messages = [...head, ...hist];
          man.layers.history.kept -= extraDrops;
          man.layers.history.dropped += extraDrops;
          man.layers.history.tokens = estHist;
          man.totalTokens = messages.reduce((t, m) => t + estT(m.content), 0);
          man.warnings.push(`Exact token count left less room than the estimate — dropped ${extraDrops} more oldest message(s).`);
        }
        if (headTok > man.budget)
          man.warnings.push(`Fixed layers alone use ~${headTok} exact tokens, over the ${man.budget}-token prompt budget — shrink backstory/lore/memory or raise the context length.`);
      }
    }
    // Stopped during the async prep (embeddings/tokenize)? Bail before streaming.
    if (abort.signal.aborted) { genRef.current = null; setGenerating(null); return; }
    setManifestFor(chatObj.id, man, messages);
    setSuggestions(null);
    // Logit bias: OpenAI shape {token_id: bias}, first token of each entry.
    const logitBias = {};
    for (const e of Object.values(st.logitBias ?? {})) {
      const id = e?.ids?.[0];
      if (Number.isInteger(id)) logitBias[String(id)] = Math.max(-100, Math.min(100, e.power));
    }
    let work = chatObj;
    // Display text streams in plain (delta is the text authority). Logprobs
    // accumulate as a SEPARATE raw tape — a chunk's delta and its logprob
    // entries are not reliably related (middleware re-chunking can attach
    // them off by one), so alignment happens once, globally, at the end.
    const baseText = continuation ? activeText(node) : '';
    const baseSpans = continuation
      ? (node?.swipes?.[node.activeSwipe]?.tokens ?? [{ text: baseText, logprob: null, top: [] }])
      : [];
    let acc = baseText;
    const lpTape = [];
    // Tool replies: the RAW accumulated text and its raw→stripped char map
    // (set when tool blocks were stripped) so the lp tape — which covers the
    // protocol text too — can still be aligned and projected onto the
    // stripped display text.
    let rawAcc = null, probMap = null;
    const applyText = (text, tokens) => {
      const n = work.messages[nodeId];
      if (!n) return;
      const swipes = n.swipes.slice();
      swipes[n.activeSwipe] = { ...swipes[n.activeSwipe], text, modelId: model, ...(tokens ? { tokens } : {}) };
      work = { ...work, messages: { ...work.messages, [nodeId]: { ...n, swipes } }, updatedAt: Date.now() };
      upsertChat(work.id, work);
    };
    // One global alignment pass over the finished text + raw lp tape; attaches
    // swipe.tokens when at least one span carries real prob data. Runs on
    // completion AND abort, so partial generations keep their probs.
    const attachProbs = () => {
      let spans = null;
      if (probMap && rawAcc != null)
        spans = alignStrippedToolSpans(rawAcc.slice(baseText.length), lpTape, probMap.map, baseText.length, acc.slice(baseText.length));
      if (!spans) spans = alignTokensToSpans(acc.slice(baseText.length), lpTape);
      spans = [...baseSpans, ...spans];
      if (spans.some(s => s.logprob != null)) applyText(acc, spans);
      else if (st.tokenProbs !== false && acc)
        console.warn('FictionPad: logprobs were requested but the stream contained none — ' +
          'an intermediate proxy/middleware may not be forwarding "logprobs"/"top_logprobs" to the backend.');
    };
    // Remove the empty generating swipe (or the fresh placeholder node) when
    // nothing was ever written — applies to errors, dropped connections,
    // empty completions, and Stop-before-first-token alike.
    const discardEmptySwipe = () => {
      const n = work.messages[nodeId];
      if (!n) return;
      if (n.swipes.length > 1) {
        const swipes = n.swipes.slice(0, -1);
        work = { ...work, messages: { ...work.messages, [nodeId]: { ...n, swipes, activeSwipe: swipes.length - 1 } } };
        upsertChat(work.id, work);
      } else if (fresh) {
        const messages = { ...work.messages };
        delete messages[nodeId];
        work = { ...work, messages, activeLeafId: n.parentId };
        upsertChat(work.id, work);
      }
    };
    let sawDone = false; // a chunk with finish_reason arrived (clean finish)
    try {
      for await (const chunk of openaiChatStream({
        endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model, messages,
        samplers: st.samplers, maxTokens: st.maxTokens, signal: abort.signal,
        tokenProbs: st.tokenProbs !== false, topLogprobs: st.topLogprobs ?? 10, logitBias, stop: st.stopStrings,
      })) {
        if (chunk.done) { sawDone = true; continue; }
        if (chunk.lp) { lpTape.push(...chunk.lp); continue; }
        acc += chunk.content;
        // Streaming view hides tool protocol blocks (complete + trailing
        // unterminated) so the user never sees them mid-generation.
        applyText(st.toolsEnabled !== false ? stripToolBlocks(acc) : acc);
      }
      if (!acc && !abort.signal.aborted)
        setError(sawDone ? 'The model returned an empty response.'
                         : 'The connection ended before any text arrived.');
    } catch (e) {
      if (e.name !== 'AbortError')
        setError(`Generation failed: ${e.message ?? e}`);
    } finally {
      genRef.current = null;
      setGenerating(null);
      // Tool calls (v2.0b): parse the finished text, strip protocol blocks
      // from display, execute against the chat lore overlay. Logprobs still
      // attach on tool replies: the lp tape is aligned against the RAW text
      // (which it tiles exactly) and projected through the strip's char map
      // onto the stripped display text (attachProbs).
      let toolResults = null;
      // Regenerate hygiene: a successful regeneration replaces the previous
      // swipe — drop tool-written pieces it created, but ONLY when nothing
      // follows this node in the tree (mid-tree regenerates keep them: later
      // messages may rely on them). Runs even with tools toggled off — the
      // old swipe's pieces were written when they were on.
      if (acc && !fresh && !continuation
          && !Object.values(work.messages).some(m => m.parentId === nodeId)) {
        const pruned = pruneToolPieces(work, nodeId);
        if (pruned !== work) { work = pruned; upsertChat(work.id, work); }
      }
      if (acc && st.toolsEnabled !== false) {
        const parsed = parseToolCalls(acc);
        if (parsed.text !== acc) {
          // Keep the raw text + raw→stripped map for logprob projection.
          probMap = stripToolBlocksMapped(acc);
          rawAcc = acc;
          // Drift guard: if the map's text isn't exactly what we store,
          // discard it — attachProbs falls back to plain alignment.
          if (probMap.text !== parsed.text) { probMap = null; rawAcc = null; }
          acc = parsed.text;
          if (acc) applyText(acc);
        }
        if (parsed.calls.length) {
          // DEBUG: log raw tool blocks + parsed calls while the protocol is
          // being tuned. TODO: remove this console.debug once format
          // compliance is confirmed across models.
          console.debug('FictionPad tool calls:', parsed.calls.map(c => ({ raw: c.raw, parsed: { name: c.name, args: c.args }, error: c.error })));
          const callCap = Math.max(1, st.toolCallCap ?? TOOL_CALL_CAP);
          const applied = applyToolCalls(work, parsed.calls, {
            nodeId, now: Date.now(), cap: callCap,
            queueLore: (scen?.emergentLore ?? 'queue') === 'queue',
            customTools: enabledCustomTools(st),
          });
          toolResults = applied.results;
          if (applied.chat !== work) { work = applied.chat; upsertChat(work.id, work); }
          man.toolCalls = applied.results.map(r => ({
            name: r.name, ok: r.ok, note: r.note, args: toPreview(JSON.stringify(r.args ?? {}), 200),
          }));
          const capped = applied.results.filter(r => r.note === 'call cap reached').length;
          const failed = applied.results.filter(r => !r.ok && r.note !== 'call cap reached').length;
          if (capped) man.warnings.push(`${capped} tool call(s) skipped — per-generation cap is ${callCap}.`);
          if (failed) man.warnings.push(`${failed} tool call(s) failed — details in the inspector.`);
          setManifestFor(chatObj.id, { ...man }, messages);
        }
      }
      if (!acc) discardEmptySwipe();
      // Stream ended without a finish chunk and not by the user's Stop — the
      // connection dropped mid-generation. Partial text is kept, but flagged.
      const interrupted = !!acc && !sawDone && !abort.signal.aborted;
      if (acc) {
        attachProbs();
        // Attribute the finished swipe to a character (or "Narrator"), and
        // record how long the generation took.
        const names = characterNamesOf(scen, work, gchars);
        const n = work.messages[nodeId];
        if (n) {
          const swipes = n.swipes.slice();
          swipes[n.activeSwipe] = { ...swipes[n.activeSwipe], speaker: detectSpeaker(acc, names) ?? 'Narrator', genMs: Date.now() - genStart,
            ...(interrupted ? { interrupted: true } : {}),
            // Persisted on the swipe so the gear popover can show them after the fact.
            ...(toolResults ? { toolCalls: toolResults.map(({ name, ok, note, args }) => ({
              name, ok, note, args: toPreview(JSON.stringify(args ?? {}), 200),
            })) } : {}) };
          work = { ...work, messages: { ...work.messages, [nodeId]: { ...n, swipes } } };
          upsertChat(work.id, work);
        }
        maybeSummarize(work);
        maybeExtractLore(work);
        // Response suggestions: only after a full generation/regeneration —
        // never mid-stream, never after /continue, never for OOC exchanges.
        if (!continuation && st.suggestions !== false) {
          const parent = work.messages[node?.parentId];
          const parentIsOOC = parent?.role === 'user' && /^\[OOC:/i.test(activeText(parent).trim());
          if (!parentIsOOC) fetchSuggestions(work, nodeId);
        }
      }
      storage.flush();
    }
  }

  // ---- response suggestions (aux model; ephemeral, silent on failure) ----
  async function fetchSuggestions(chatObj, nodeId) {
    const { personas: pe, settings: st } = ref.current;
    const model = st.auxModel || st.model;
    if (!st.endpoint || !model) return;
    const pName = (chatObj.personaId && pe[chatObj.personaId]?.name?.trim()) || 'User';
    const count = Math.max(1, Math.min(5, st.suggestionsCount ?? 2));
    const words = Math.max(5, Math.min(60, st.suggestionsWords ?? 20));
    const sysPrompt = subUser(st.suggestionsPrompt || DEFAULT_SUGGESTIONS_PROMPT, pName)
      .replaceAll('{{count}}', String(count)).replaceAll('{{words}}', String(words));
    const swipeIdx = chatObj.messages[nodeId]?.activeSwipe ?? 0;
    const recent = getActivePath(chatObj.messages, nodeId).slice(-(st.suggestionsDepth ?? 6))
      .map(n => `${n.role === 'user' ? pName : 'Narrator'}: ${subUser(activeText(n), pName)}`)
      .join('\n\n');
    const key = { chatId: chatObj.id, nodeId, swipe: swipeIdx };
    setSuggestions({ ...key, loading: true, items: null });
    try {
      const out = await auxLogged('suggestions', {
        endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model,
        system: sysPrompt,
        user: `Recent scene:\n\n${recent}\n\n${count === 1 ? 'One option' : `${count} options`} for ${pName}:`,
        maxTokens: Math.min(500, 60 + count * words * 2), temperature: st.suggestionsTemp ?? 0.9, stop: st.stopStrings,
      });
      const items = out.split('\n')
        .map(l => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
        .filter(l => l.length > 0 && l.split(/\s+/).length <= Math.ceil(words * 1.5) && !/^\d+$/.test(l) && !/:$/.test(l))
        .slice(0, count);
      setSuggestions(s => (s?.chatId === key.chatId && s?.nodeId === key.nodeId)
        ? (items.length ? { ...key, loading: false, items } : null) : s);
    } catch {
      setSuggestions(s => (s?.chatId === key.chatId && s?.nodeId === key.nodeId) ? null : s);
    }
  }

  // ---- chat input / slash commands ----
  function sendUserMessage(c, content) {
    const { chat: c1, id: userId } = appendMessage(c, c.activeLeafId, 'user', content);
    const { chat: c2, id: asstId } = appendMessage(c1, userId, 'assistant', '');
    upsertChat(c2.id, { ...c2, updatedAt: Date.now() });
    runGeneration(c2, asstId, { fresh: true });
  }
  function handleContinue(c) {
    const path = getActivePath(c.messages, c.activeLeafId);
    const last = path[path.length - 1];
    if (last?.role === 'assistant' && activeText(last)) {
      runGeneration(c, last.id, { continuation: true });
    } else {
      const { chat: c1, id } = appendMessage(c, c.activeLeafId, 'assistant', '');
      upsertChat(c1.id, { ...c1, updatedAt: Date.now() });
      runGeneration(c1, id, { fresh: true });
    }
  }
  function handleInput(raw) {
    const c = ref.current.chats[ui.chatId];
    if (!c) return 'Select or create a chat first.';
    if (genRef.current) return 'Already generating — press Stop first.';
    if (auxBusy) return `Working… (${auxBusy})`;
    if (raw.startsWith('/')) {
      const sp = raw.indexOf(' ');
      const cmd = (sp === -1 ? raw : raw.slice(0, sp)).toLowerCase();
      const arg = sp === -1 ? '' : raw.slice(sp + 1).trim();
      if (cmd === '/ooc') {
        if (!arg) return 'Usage: /ooc <text>';
        sendUserMessage(c, `[OOC: ${arg}]`);
        return null;
      }
      if (cmd === '/continue') { handleContinue(c); return null; }
      if (cmd === '/pov') {
        if (!arg) return 'Usage: /pov <character name>';
        // Reframe one generation around another character. If a character-type
        // lore piece matches the name, it's force-injected (reason 'pov') so
        // the model sees that definition; otherwise the directive alone stands.
        const scen = ref.current.scenarios[c.scenarioId];
        const q = arg.toLowerCase();
        const chars = mergedLorePieces(scen, c, ref.current.characters).filter(p => p && p.enabled !== false && (p.type ?? 'lore') === 'character');
        const piece = chars.find(p => (p.title ?? '').trim().toLowerCase() === q)
          ?? chars.find(p => (p.title ?? '').trim().toLowerCase().includes(q));
        const { chat: c1, id } = appendMessage(c, c.activeLeafId, 'assistant', '');
        upsertChat(c1.id, { ...c1, updatedAt: Date.now() });
        runGeneration(c1, id, { fresh: true, pov: { name: piece?.title?.trim() || arg, pieceId: piece?.id ?? null } });
        return null;
      }
      if (cmd === '/improve') {
        if (!arg) return 'Usage: /improve <draft text>';
        improveDraft(c, arg);
        return null;
      }
      if (cmd === '/recap') {
        const n = Math.max(10, Math.min(500, parseInt(arg, 10) || 50));
        recapChat(c, n);
        return null;
      }
      if (cmd === '/memory') {
        const n = Math.max(10, Math.min(50, parseInt(arg, 10) || 30));
        memoryCommand(c, n);
        return null;
      }
      if (cmd === '/model') {
        const global = ref.current.settings.model;
        if (!arg)
          return `Effective model: ${c.settings?.model || global || '(none)'}${c.settings?.model ? ' (chat override)' : ' (global)'}`;
        saveChat({ ...c, settings: { ...(c.settings ?? {}), model: arg } });
        return `Chat model set to "${arg}" (this chat only, persisted).`;
      }
      if (cmd === '/theme') {
        const names = Object.values(THEMES).map(t => t.name).join(', ');
        if (!arg) return `Theme: ${THEMES[theme]?.name ?? theme}. Available: ${names}`;
        const q = arg.toLowerCase();
        const id = Object.keys(THEMES).find(k => k === q || THEMES[k].name.toLowerCase() === q)
          ?? Object.keys(THEMES).find(k => k.includes(q) || THEMES[k].name.toLowerCase().includes(q));
        if (!id) return `No theme matching "${arg}". Available: ${names}`;
        setTheme(id);
        return `Theme set to ${THEMES[id].name}.`;
      }
      return `Unknown command ${cmd}. Available: /ooc, /continue, /pov NAME, /improve, /recap N, /memory N, /model NAME, /theme NAME`;
    }
    sendUserMessage(c, raw);
    return null;
  }

  // ---- aux slash commands ----
  async function improveDraft(c, draft) {
    const { personas: pe, settings: st } = ref.current;
    const model = st.auxModel || st.model;
    if (!st.endpoint || !model) { setError('Configure an endpoint and model in Settings first.'); return; }
    const pers = c.personaId ? pe[c.personaId] : null;
    const pName = pers?.name?.trim() || 'User';
    const personaDesc = pers?.description?.trim() ? ` (${subUser(pers.description, pName)})` : '';
    const recent = getActivePath(c.messages, c.activeLeafId).slice(-4)
      .map(n => `${n.role === 'user' ? pName : 'Narrator'}: ${subUser(activeText(n), pName)}`)
      .join('\n\n');
    setAuxBusy('improve');
    try {
      const out = await auxLogged('improve', {
        endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model,
        system: subUser(st.improvePrompt || DEFAULT_IMPROVE_PROMPT, `${pName}${personaDesc}`),
        user: `${recent ? `Recent scene:\n\n${recent}\n\n` : ''}Draft:\n\n${draft}`,
        maxTokens: st.improveMaxTokens ?? 400, temperature: st.improveTemp ?? 0.7, stop: st.stopStrings,
      });
      if (!out) throw new Error('empty response from the model');
      setComposerInject({ text: out, nonce: Date.now() });
    } catch (e) {
      setError(`/improve failed: ${e.message ?? e}`);
    } finally {
      setAuxBusy(null);
    }
  }

  async function recapChat(c, n) {
    const { personas: pe, settings: st } = ref.current;
    const model = st.auxModel || st.model;
    if (!st.endpoint || !model) { setError('Configure an endpoint and model in Settings first.'); return; }
    const pName = (c.personaId && pe[c.personaId]?.name?.trim()) || 'User';
    const recent = getActivePath(c.messages, c.activeLeafId).slice(-n)
      .map(x => `${x.role === 'user' ? pName : 'Narrator'}: ${subUser(activeText(x), pName)}`)
      .join('\n\n');
    if (!recent.trim()) { setComposerInject({ hint: 'Nothing to recap yet.', nonce: Date.now() }); return; }
    setAuxBusy('recap');
    try {
      const out = await auxLogged('recap', {
        endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model,
        system: st.recapPrompt || DEFAULT_RECAP_PROMPT,
        user: `Roleplay excerpt (last ${n} messages):\n\n${recent}`,
        maxTokens: st.recapMaxTokens ?? 700, temperature: st.recapTemp ?? 0.4, stop: st.stopStrings,
      });
      if (!out) throw new Error('empty response from the model');
      setModal({ kind: 'recap', text: out });
    } catch (e) {
      setError(`/recap failed: ${e.message ?? e}`);
    } finally {
      setAuxBusy(null);
    }
  }

  async function memoryCommand(c, n) {
    setAuxBusy('memory');
    setComposerInject({ hint: 'Generating memory…', nonce: Date.now() });
    try {
      const text = await generateMemory(c, n);
      if (!text) { setComposerInject({ hint: 'Nothing to summarize yet.', nonce: Date.now() }); return; }
      const store = addMemory(c.memoryStore, text, Date.now(), ref.current.settings.memoryCap ?? MEMORY_CAP); // manual: cursor untouched
      saveChat({ ...c, memoryStore: { ...store, cursor: c.memoryStore?.cursor ?? 0 } });
      setComposerInject({ hint: `Memory saved (${store.memories.length} total).`, nonce: Date.now() });
    } catch (e) {
      setComposerInject({ hint: null, nonce: Date.now() });
      setError(`/memory failed: ${e.message ?? e}`);
    } finally {
      setAuxBusy(null);
    }
  }

  // ---- per-message actions ----
  const onEdit = (nodeId, text) => {
    const c = ref.current.chats[ui.chatId]; const n = c?.messages[nodeId];
    if (!n) return;
    const swipes = n.swipes.slice();
    swipes[n.activeSwipe] = { ...swipes[n.activeSwipe], text };
    saveChat({ ...c, messages: { ...c.messages, [nodeId]: { ...n, swipes, edited: true } } });
  };
  const onRegenerate = (nodeId) => {
    const c = ref.current.chats[ui.chatId]; const n = c?.messages[nodeId];
    if (!n || genRef.current) return;
    const swipes = [...n.swipes, { text: '', createdAt: Date.now(), modelId: null }];
    const c1 = { ...c, messages: { ...c.messages, [nodeId]: { ...n, swipes, activeSwipe: swipes.length - 1 } }, updatedAt: Date.now() };
    upsertChat(c1.id, c1);
    runGeneration(c1, nodeId);
  };
  // Regenerate from a token: new swipe whose text starts with tokens[0..i]
  // (+ chosen alternative), then continue generation from that prefix via the
  // existing continuation machinery (trailing assistant message = prefill).
  const onRegenFromToken = (nodeId, tokIdx, alt) => {
    const c = ref.current.chats[ui.chatId]; const n = c?.messages[nodeId];
    if (!n || genRef.current) return;
    const src = n.swipes[n.activeSwipe];
    const toks = src?.tokens;
    if (!toks?.length) return;
    const keep = toks.slice(0, alt == null ? tokIdx + 1 : tokIdx);
    const prefix = keep.map(t => t.text).join('') + (alt ?? '');
    const prefixToks = alt == null ? keep : [...keep, { text: alt, logprob: null, top: [] }];
    const swipes = [...n.swipes, { text: prefix, createdAt: Date.now(), modelId: null, tokens: prefixToks }];
    const c1 = { ...c, messages: { ...c.messages, [nodeId]: { ...n, swipes, activeSwipe: swipes.length - 1 } }, updatedAt: Date.now() };
    upsertChat(c1.id, c1);
    runGeneration(c1, nodeId, { continuation: true });
  };
  const onSwipe = (nodeId, dir) => {
    const c = ref.current.chats[ui.chatId]; const n = c?.messages[nodeId];
    if (!n) return;
    const next = Math.min(n.swipes.length - 1, Math.max(0, n.activeSwipe + dir));
    saveChat({ ...c, messages: { ...c.messages, [nodeId]: { ...n, activeSwipe: next } } });
  };
  const onSwipeTo = (nodeId, idx) => {
    const c = ref.current.chats[ui.chatId]; const n = c?.messages[nodeId];
    if (!n || idx < 0 || idx >= n.swipes.length) return;
    saveChat({ ...c, messages: { ...c.messages, [nodeId]: { ...n, activeSwipe: idx } } });
  };
  const onBranch = (nodeId) => {
    const c = ref.current.chats[ui.chatId];
    if (!c) return;
    const b = branchChat(c, nodeId); // deep-copies messages + memoryStore
    upsertChat(b.id, b);
    setUi(u => ({ ...u, chatId: b.id }));
  };
  const onRewind = (nodeId) => {
    const c = ref.current.chats[ui.chatId];
    if (c) saveChat(rewindChat(c, nodeId)); // rolls memoryStore back too
  };
  const onDeleteMsg = (nodeId) => {
    const c = ref.current.chats[ui.chatId]; const n = c?.messages[nodeId];
    if (!n?.parentId) return;
    const messages = deleteSubtree(c.messages, nodeId);
    const leaf = messages[c.activeLeafId] ? c.activeLeafId : n.parentId;
    saveChat({ ...c, messages, activeLeafId: leaf });
  };

  // ---- scenarios / personas / chats ----
  const onSaveScenario = (draft) => { upsertScenario(draft.id, draft); setModal(null); };
  const onDeleteScenario = (id) => {
    removeScenario(id);
    if (ui.scenarioId === id) setUi(u => ({ ...u, scenarioId: null }));
  };
  // New chat from a scenario (scenarioId) or directly with a global character
  // (characterId). Selecting the matching sidebar filter keeps the new chat
  // visible — a scenario filter would hide a character chat and vice versa.
  const createChat = ({ scenarioId = null, characterId = null }, personaId, newPersonaName) => {
    let pid = personaId || null;
    if (!pid && newPersonaName.trim()) {
      pid = uid();
      upsertPersona(pid, { id: pid, name: newPersonaName.trim(), description: '' });
    }
    const scen = scenarioId ? ref.current.scenarios[scenarioId] : null;
    const char = characterId ? ref.current.characters[characterId] : null;
    if (!scen && !char) return;
    const c = newChat({ scenario: scen, character: char, personaId: pid, dateFormat: settings?.dateFormat });
    upsertChat(c.id, c);
    setUi(u => (scen
      ? { ...u, chatId: c.id, scenarioId: scen.id, characterId: null }
      : { ...u, chatId: c.id, scenarioId: null, characterId: char.id }));
    setModal(null);
  };
  const onDeleteCharacter = (id) => {
    removeCharacter(id); // links dangle in scenarios/chats — resolveCharacters skips them
    if (ui.characterId === id) setUi(u => ({ ...u, characterId: null }));
  };
  const onDeleteChat = (id) => {
    // Abort generation in flight for this chat before removing it.
    if (generating?.chatId === id) genRef.current?.abort.abort();
    removeChat(id);
    if (ui.chatId === id) setUi(u => ({ ...u, chatId: null }));
  };

  // Generate an assistant reply as a child of a user message (defaults to the
  // active leaf). A new assistant child becomes the active leaf, so repeated
  // calls create sibling assistant branches — same semantics as swipes.
  const onGenerateReply = (nodeId = null) => {
    const c = ref.current.chats[ui.chatId];
    if (!c || genRef.current) return;
    const parent = c.messages[nodeId ?? c.activeLeafId];
    if (!parent || parent.role !== 'user') return;
    const { chat: c1, id } = appendMessage(c, parent.id, 'assistant', '');
    upsertChat(c1.id, { ...c1, updatedAt: Date.now() });
    runGeneration(c1, id, { fresh: true });
  };

  // ---- export / import ----
  const onExportScenario = (id) =>
    downloadJSON(`fictionpad-scenario-${scenarios[id]?.name ?? id}.json`, { type: 'fictionpad-scenario', version: 1, data: scenarios[id] });
  const onExportChat = (c) =>
    downloadJSON(`fictionpad-chat-${c.name}.json`, { type: 'fictionpad-chat', version: 1, data: c });
  const onExportCharacter = (id) =>
    downloadJSON(`fictionpad-character-${characters[id]?.name ?? id}.json`, { type: 'fictionpad-character', version: 1, data: characters[id] });
  const onImport = async () => {
    const obj = await pickJSONFile();
    if (!obj) return;
    if (obj.__error) return setError(`Import failed: ${obj.__error}`);
    if (obj.type === 'fictionpad-scenario' && obj.data?.name != null) {
      const s = { ...obj.data, id: uid() };
      upsertScenario(s.id, s);
      setUi(u => ({ ...u, scenarioId: s.id }));
    } else if (obj.type === 'fictionpad-character' && obj.data?.name != null) {
      const ch = { ...obj.data, id: uid() };
      upsertCharacter(ch.id, ch);
      setUi(u => ({ ...u, characterId: ch.id, scenarioId: null }));
    } else if (obj.type === 'fictionpad-chat' && obj.data?.messages) {
      const c = { ...obj.data, id: uid() };
      upsertChat(c.id, c);
      setUi(u => ({ ...u, chatId: c.id, scenarioId: c.scenarioId ?? null }));
      if (c.scenarioId && !ref.current.scenarios[c.scenarioId])
        setError('Chat imported, but its scenario is not present in this browser.');
    } else {
      setError('Unrecognized JSON: expected a FictionPad scenario, character or chat export.');
    }
  };

  const onPreview = (chatId = ui.chatId) => {
    const c = ref.current.chats[chatId];
    if (!c) return;
    const st = ref.current.settings;
    // Same platform-prompt composition as runGeneration so the preview counts
    // the speaker/tools prompts too. Semantic activation is NOT rerun here
    // (async embeddings) — the preview is keyword-trigger lore only.
    const { messages, manifest: man } = assemblePrompt({
      scenario: ref.current.scenarios[c.scenarioId],
      persona: c.personaId ? ref.current.personas[c.personaId] : null,
      chat: c, settings: st, platformPrompt: buildPlatformPrompt(st),
      characters: ref.current.characters,
    });
    // Surface the keyword-only caveat when smart pieces could have fired.
    if (st.embeddingModel && mergedLorePieces(ref.current.scenarios[c.scenarioId], c, ref.current.characters)
        .some(p => p && p.enabled !== false && !p.pinned && p.smart))
      man.warnings.push('Preview: semantic activation not run (embeddings) — smart pieces show keyword-trigger results only.');
    setManifestFor(c.id, man, messages);
  };

  // Suggestions fire after every swipe and would flood the aux list — hidden
  // unless the user opts in (Settings → Features).
  const shownAuxLog = settings.auxShowSuggestions ? auxLog : auxLog.filter(a => a.kind !== 'suggestions');

  // Ribbon pane toggles: «/» edge arrows on phones always, and on desktop when
  // the Appearance setting asks for them; otherwise the brand/Inspector labels.
  const ribbonTier = (isMobile || settings.sidebarArrows) ? 2 : 0;
  // Inset the centered title by the actual toggle-button widths so a long chat
  // name ellipsizes instead of sliding under them.
  const leftBtnRef = useRef(null), rightBtnRef = useRef(null);
  const [btnW, setBtnW] = useState({ l: 0, r: 0 });
  useEffect(() => {
    const l = leftBtnRef.current?.offsetWidth ?? 0, r = rightBtnRef.current?.offsetWidth ?? 0;
    if (l !== btnW.l || r !== btnW.r) setBtnW({ l, r });
  }, [viewportW, ribbonTier]);

  return html`
    <div class="app ${sidebarCollapsed ? '' : 'sb-open'} ${dragging ? 'dragging' : ''}">
      ${isMobile && (!sidebarCollapsed || ui.drawer) && html`
        <div class="scrim" onClick=${() => { if (!sidebarCollapsed) toggleSidebar(); closeDrawer(); }} />`}
      <div class="topbar">
        <div class="topbar-inner">
          <span ref=${leftBtnRef} style=${{ display: 'inline-flex', flex: 'none' }}>
            ${ribbonTier >= 1
              ? html`<button class="btn small ghost ${sidebarCollapsed ? '' : 'active'}" title=${sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
                  onClick=${toggleSidebar}>${sidebarCollapsed ? '»' : '«'}</button>`
              : html`<button class="btn small ghost ${sidebarCollapsed ? '' : 'active'}"
                  title=${sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'} onClick=${toggleSidebar}>FictionPad</button>`}
          </span>
          ${chat && html`<div class="mid"
            style=${{ left: `${(isMobile ? 8 : 14) + padL + btnW.l + 6}px`, right: `${(isMobile ? 8 : 14) + padR + btnW.r + 6}px` }}>
            <span class="title">${chat.name}</span>
            <button class="btn small ghost" title="Close chat"
              onClick=${() => setUi(u => ({ ...u, chatId: null, drawer: null }))}>✕</button>
            <span class="sub">${chat.scenarioId
              ? (scenarios[chat.scenarioId]?.name ?? '(missing scenario)')
              : ((chat.characterIds ?? []).map(id => characters[id]?.name).filter(Boolean).join(', ') || '(no scenario)')} · {{user}} = ${personaName}</span>
          </div>`}
          <span class="spacer"></span>
          <span ref=${rightBtnRef} style=${{ display: 'inline-flex', flex: 'none' }}>
            ${ribbonTier === 2
              ? html`<button class="btn small ghost ${ui.drawer ? 'active' : ''}"
                  title="Inspector / Memory / Chat panel"
                  onClick=${() => ui.drawer ? closeDrawer() : toggleDrawer(lastDrawerTabRef.current ?? 'inspector')}>${ui.drawer ? '»' : '«'}</button>`
              : html`<button class="btn small ghost ${ui.drawer ? 'active' : ''}"
                  title="Inspector panel (Inspector / Memory / Chat tabs)"
                  onClick=${() => ui.drawer ? closeDrawer() : toggleDrawer(lastDrawerTabRef.current ?? 'inspector')}>Inspector</button>`}
          </span>
        </div>
      </div>
      <div class="app-body">
      <${Sidebar}
        scenarios=${scenarios} chats=${chats} characters=${characters}
        selectedScenarioId=${ui.scenarioId} selectedCharacterId=${ui.characterId ?? null} selectedChatId=${ui.chatId}
        onSelectScenario=${(id) => setUi(u => ({ ...u, scenarioId: id, ...(id ? { characterId: null } : {}) }))}
        onSelectCharacter=${(id) => setUi(u => ({ ...u, characterId: id, ...(id ? { scenarioId: null } : {}) }))}
        onSelectChat=${(id) => setUi(u => ({ ...u, chatId: id }))}
        onNewScenario=${() => setModal({ kind: 'scenario', scenario: newScenario() })}
        onEditScenario=${(id) => setModal({ kind: 'scenario', scenario: scenarios[id] })}
        onDeleteScenario=${onDeleteScenario}
        onNewChat=${(scenarioId) => setModal({ kind: 'newChat', scenarioId })}
        onNewCharacter=${() => setModal({ kind: 'character', character: null })}
        onEditCharacter=${(id) => setModal({ kind: 'character', character: characters[id] ?? null })}
        onDeleteCharacter=${onDeleteCharacter}
        onNewCharacterChat=${(characterId) => setModal({ kind: 'newChat', characterId })}
        onExportCharacter=${onExportCharacter}
        onExportScenario=${onExportScenario}
        onImport=${onImport}
        onOpenPersonas=${() => setModal({ kind: 'personas' })}
        onOpenSettings=${() => setModal({ kind: 'settings' })}
        sideCollapsed=${ui.sideCollapsed ?? {}}
        onToggleSection=${(key) => setUi(u => ({ ...u, sideCollapsed: { ...(u.sideCollapsed ?? {}), [key]: !(u.sideCollapsed ?? {})[key] } }))}
        collapsed=${sidebarCollapsed}
        onDeleteChat=${onDeleteChat}
        onChatAction=${chatAction}
        onChatContextMenu=${(chatId, x, y) => setCtxMenu({ chatId, x, y })}
        storageKind=${storageKind} saveRetrying=${saveRetrying}
        width=${sbW} onDragStart=${paneDragStart('left')} onResetWidth=${() => resetPaneWidth('left')} />
      <div class="center-col" style=${{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, paddingLeft: padL, paddingRight: padR }}>
        ${storageFailed && html`<div class="banner">IndexedDB unavailable — data will not persist across reloads.</div>`}
        ${error && html`<div class="banner">${error}<button class="btn small ghost" onClick=${() => setError(null)}>✕</button></div>`}
        <div style=${{ flex: 1, display: 'flex', minHeight: 0 }}>
          <${ErrorBoundary} name="chat">
            <${ChatPane} chat=${chat} persona=${persona} characterNames=${characterNames}
              dateFormat=${settings.dateFormat}
              generating=${generating?.chatId === chat?.id ? generating : null}
              suggestions=${suggestions}
              onPickSuggestion=${(s) => setComposerInject({ text: s, nonce: Date.now() })}
              onRerollSuggestions=${() => {
                const c = ref.current.chats[ui.chatId];
                if (c && !auxBusy) fetchSuggestions(c, c.activeLeafId);
              }}
              composerInject=${composerInject} auxBusy=${auxBusy}
              onSubmitInput=${handleInput} onStop=${() => genRef.current?.abort.abort()}
              onEdit=${onEdit} onRegenerate=${onRegenerate} onSwipe=${onSwipe} onSwipeTo=${onSwipeTo}
              onBranch=${onBranch} onRewind=${onRewind} onDeleteMsg=${onDeleteMsg}
              onGenerateReply=${onGenerateReply} onReply=${onGenerateReply} onRegenFromToken=${onRegenFromToken} />
          <//>
        </div>
      </div>
      <${RightDrawer}
        chat=${chat} tab=${ui.drawer} onTab=${(t) => setUi(u => ({ ...u, drawer: t }))}
        manifest=${manifest} realCounts=${realCounts} onPreview=${() => onPreview()} auxLog=${shownAuxLog}
        personas=${personas} scenario=${chat ? scenarios[chat.scenarioId] : null} characters=${characters}
        onExport=${() => chat && onExportChat(chat)}
        onDelete=${() => { if (chat && confirm(`Delete chat "${chat.name}"?`)) onDeleteChat(chat.id); }}
        dateFormat=${settings.dateFormat} memoryEvery=${settings.memoryEvery}
        onUpdateChat=${saveChat}
        onSummarize=${() => chat && summarizeNow(chat)} summarizing=${summarizing}
        width=${dwW} onDragStart=${paneDragStart('right')} onResetWidth=${() => resetPaneWidth('right')}
        onClose=${closeDrawer} />
      </div>
    </div>
    ${modal?.kind === 'scenario' && html`
      <${ErrorBoundary} name="scenario editor"><${ScenarioEditor} scenario=${modal.scenario} characters=${characters} onSave=${onSaveScenario} onClose=${() => setModal(null)} /><//>`}
    ${modal?.kind === 'character' && html`
      <${ErrorBoundary} name="character editor"><${CharacterEditor} character=${modal.character} scenarios=${scenarios}
        onUpsert=${upsertCharacter} onClose=${() => setModal(null)} /><//>`}
    ${modal?.kind === 'personas' && html`
      <${ErrorBoundary} name="personas"><${PersonaManager} personas=${personas} onUpsert=${upsertPersona} onRemove=${removePersona} onClose=${() => setModal(null)} /><//>`}
    ${modal?.kind === 'settings' && html`
      <${ErrorBoundary} name="settings"><${SettingsModal} settings=${settings} theme=${theme} onThemeChange=${setTheme}
        accent=${accent} onAccentChange=${setAccent}
        onOpenLogitBias=${() => setModal({ kind: 'logitBias' })}
        storageKind=${storageKind} onUpload=${migrateUpload} onDownload=${migrateDownload}
        onSave=${(s) => { setSettings(prev => ({ ...s, logitBias: prev?.logitBias ?? s.logitBias ?? {} })); setModal(null); }}
        onClose=${() => setModal(null)} /><//>`}
    ${modal?.kind === 'logitBias' && html`
      <${ErrorBoundary} name="logit bias"><${LogitBiasModal}
        logitBias=${settings.logitBias ?? {}}
        onChange=${(map) => setSettings(s => ({ ...(s ?? {}), logitBias: map }))}
        onTokenize=${(prompt) => tokenize({ endpoint: effectiveEndpoint(settings, storageKind === 'server'), apiKey: settings.apiKey, serverToken: settings.serverToken, model: settings.model, prompt })}
        onClose=${() => setModal(null)} /><//>`}
    ${modal?.kind === 'newChat' && (scenarios[modal.scenarioId] || characters[modal.characterId]) && html`
      <${ErrorBoundary} name="new chat"><${NewChatModal} scenario=${scenarios[modal.scenarioId] ?? null}
        character=${characters[modal.characterId] ?? null} personas=${personas}
        onCreate=${(pid, newName) => createChat({ scenarioId: modal.scenarioId ?? null, characterId: modal.characterId ?? null }, pid, newName)}
        onClose=${() => setModal(null)} /><//>`}
    ${modal?.kind === 'recap' && html`
      <${ErrorBoundary} name="recap"><${RecapModal} text=${modal.text} onClose=${() => setModal(null)}
        onSaveMemory=${() => {
          const c = ref.current.chats[ui.chatId];
          if (c) {
            const store = addMemory(c.memoryStore, modal.text, Date.now(), settings.memoryCap ?? MEMORY_CAP);
            saveChat({ ...c, memoryStore: { ...store, cursor: c.memoryStore?.cursor ?? 0 } });
          }
        }} /><//>`}
    ${modal?.kind === 'chatPanel' && chats[modal.chatId] && html`
      <${ErrorBoundary} name="chat panel"><${ChatPanelModal}
        chat=${chats[modal.chatId]} tab=${modal.tab}
        onTab=${(tab) => setModal(m => ({ ...m, tab }))}
        manifest=${manifests[modal.chatId]?.manifest ?? null}
        realCounts=${modal.chatId === ui.chatId ? realCounts : null}
        onPreview=${() => onPreview(modal.chatId)} auxLog=${shownAuxLog}
        personas=${personas} scenario=${scenarios[chats[modal.chatId]?.scenarioId]} characters=${characters} onUpdateChat=${saveChat}
        dateFormat=${settings.dateFormat} memoryEvery=${settings.memoryEvery}
        onSummarize=${() => summarizeNow(chats[modal.chatId])} summarizing=${summarizing}
        onExport=${() => onExportChat(chats[modal.chatId])}
        onDelete=${() => { if (confirm(`Delete chat "${chats[modal.chatId].name}"?`)) { onDeleteChat(modal.chatId); setModal(null); } }}
        onClose=${() => setModal(null)} /><//>`}
    ${ctxMenu && html`
      <${ContextMenu} x=${ctxMenu.x} y=${ctxMenu.y} onClose=${() => setCtxMenu(null)}
        items=${[
          { label: 'Chat panel', fn: () => chatAction(ctxMenu.chatId, 'inspector') },
          { label: 'Chat settings', fn: () => chatAction(ctxMenu.chatId, 'settings') },
          { label: 'Memories', fn: () => chatAction(ctxMenu.chatId, 'memory') },
          { label: 'Rename…', fn: () => chatAction(ctxMenu.chatId, 'rename') },
          { label: 'Export JSON', fn: () => chatAction(ctxMenu.chatId, 'export') },
          '-',
          { label: 'Delete…', fn: () => chatAction(ctxMenu.chatId, 'delete'), danger: true },
        ]} />`}
  `;
}

// Remember that this browser's data lives on the server. Used at boot to
// distinguish "never used server storage" (silent IndexedDB fallback is fine)
// from "server temporarily unreachable" (IndexedDB would look like total data
// loss — block with a gate instead).
const SERVER_FLAG_KEY = 'fictionpad.serverStorage';

// Blocking boot screen when a browser that previously used server storage
// can't reach the server. Never falls back to IndexedDB on its own.
function ServerGate({ error, onRetry, onUseLocal }) {
  const unauthorized = error?.status === 401;
  const [token, setToken] = useState('');
  return html`
    <div class="server-gate">
      <div class="gate-card">
        <h2>Cannot reach the FictionPad server</h2>
        <p>This browser's scenarios, personas and chats live in server storage,
          but the server handshake failed${unauthorized ? ' — unauthorized' : ''}.</p>
        <pre class="gate-err">${error?.message ?? String(error)}</pre>
        ${unauthorized && html`
          <p>Unauthorized — check your server token (the server's FICTIONPAD_TOKEN):</p>
          <label class="field"><span>Server token</span>
            <input type="password" value=${token} placeholder="server token"
              onInput=${(e) => setToken(e.target.value)}
              onKeyDown=${(e) => { if (e.key === 'Enter') onRetry(token); }} /></label>`}
        <div class="gate-actions">
          <button class="btn primary" onClick=${() => onRetry(unauthorized ? token : null)}>
            ${unauthorized ? 'Save token & retry' : 'Retry'}</button>
          <button class="btn ghost" onClick=${onUseLocal}>Use browser storage instead</button>
        </div>
        ${!unauthorized && html`<p class="hint">The server may still be restarting — retry in a few seconds.
          Nothing is written anywhere while this screen is up; your server data is safe.</p>`}
      </div>
    </div>`;
}

function App() {
  const [storage, setStorage] = useState(null);
  const [storageKind, setStorageKind] = useState(null); // 'server' | 'local'
  const [storageFailed, setStorageFailed] = useState(false);
  const [gate, setGate] = useState(null); // { error } — server storage expected but unreachable
  const [bootNonce, setBootNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      let adapter = null, kind = 'local';
      // Server storage when served over http(s) and the handshake succeeds.
      // Fresh browser (no server flag): any failure → silent IndexedDB
      // fallback. Server-flagged browser: block with the gate instead of
      // booting an empty IndexedDB that looks like total data loss.
      if (location.protocol === 'http:' || location.protocol === 'https:') {
        try {
          const saved = JSON.parse(localStorage.getItem('fictionpad.settings') ?? '{}');
          const server = new ServerDBAdapter(saved?.serverToken ?? '');
          await server.init();
          adapter = server;
          kind = 'server';
          try { localStorage.setItem(SERVER_FLAG_KEY, '1'); } catch {}
        } catch (e) {
          let hadServer = false;
          try { hadServer = localStorage.getItem(SERVER_FLAG_KEY) === '1'; } catch {}
          if (hadServer) { if (alive) setGate({ error: e }); return; }
          console.warn('FictionPad: server storage unavailable, using browser storage.', e);
        }
      }
      if (!adapter) {
        adapter = new IndexedDBAdapter();
        try { await adapter.init(); }
        catch (e) { console.error(e); if (alive) setStorageFailed(true); }
      }
      if (alive) { setStorage(adapter); setStorageKind(kind); }
    })();
  }, [bootNonce]);
  useEffect(() => {
    if (!storage) return;
    const flush = () => storage.flush();
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, [storage]);
  if (storage) return html`<${ErrorBoundary} name="app"><${Main} storage=${storage} storageKind=${storageKind} storageFailed=${storageFailed} /><//>`;
  if (gate) return html`<${ServerGate} error=${gate.error}
    onRetry=${(token) => {
      if (token != null) try {
        const s = JSON.parse(localStorage.getItem('fictionpad.settings') ?? '{}');
        s.serverToken = token;
        localStorage.setItem('fictionpad.settings', JSON.stringify(s));
      } catch {}
      setGate(null);
      setBootNonce(n => n + 1);
    }}
    onUseLocal=${() => {
      // Explicit opt-out: forget the server flag and boot browser storage.
      try { localStorage.removeItem(SERVER_FLAG_KEY); } catch {}
      setGate(null);
      setBootNonce(n => n + 1);
    }} />`;
  return html`<div class="empty">Loading FictionPad…</div>`;
}


export { ContextInspector, MessageItem, Markdown, assemblePrompt, ProbsView,
  openaiChatStream, alignTokensToSpans, alignStrippedToolSpans, stripToolBlocksMapped, tokenize, getTokenCount, embed, embedCached, cosine, SEMANTIC_THRESHOLD,
  effectiveEndpoint, html, SettingsModal, DEFAULT_SETTINGS,
  Sidebar, CharacterEditor, ScenarioEditor, NewChatModal };