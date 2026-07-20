
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
function wrapDialogue(md) {
  let inFence = false;
  return String(md ?? '').split('\n').map(line => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return line; }
    if (inFence) return line;
    return line.replace(/"[^"\n]+"|“[^”\n]+”/g, m => `<span class="dialogue">${m}</span>`);
  }).join('\n');
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

const characterNamesOf = (scenario) =>
  (scenario?.lorePieces ?? [])
    .filter(p => p.type === 'character' && p.enabled !== false)
    .map(p => p.title?.trim())
    .filter(Boolean);

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
// generation time; ids above SEMANTIC_THRESHOLD arrive here via the
// `preActivated` set and activate with reason 'semantic' — otherwise they
// behave exactly like keyword-triggered pieces (weight, budget, link boost).
function keyMatches(key, text) {
  if (!key || !text) return false;
  try { return new RegExp(key, 'i').test(text); } catch { return false; }
}

// Determine which pieces are active this turn.
// Returns Map(id → { piece, reason: 'pinned'|'triggered'|'semantic'|'link-boosted', boost }).
function scanLore(lorePieces, conversationText, preActivated = null) {
  const pieces = Array.isArray(lorePieces) ? lorePieces : [];
  const active = new Map();
  for (const piece of pieces) {
    if (!piece || piece.enabled === false) continue;
    if (piece.pinned) { active.set(piece.id, { piece, reason: 'pinned', boost: 0 }); continue; }
    if (preActivated?.has(piece.id)) { active.set(piece.id, { piece, reason: 'semantic', boost: 0 }); continue; }
    const depth = Number(piece.searchDepth) > 0 ? Number(piece.searchDepth) : DEFAULT_SEARCH_DEPTH;
    const scanText = conversationText.slice(-Math.round(depth * TOKEN_CHARS));
    if ((Array.isArray(piece.keys) ? piece.keys : []).some(k => keyMatches(k, scanText)))
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
function assemblePrompt({ scenario, persona, chat, settings = {}, platformPrompt = '', preActivated = null }) {
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
  const directive = LENGTH_PRESETS[settings.responseLength ?? 'medium']?.directive;
  if (directive) tailParts.push(directive);
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
  const loreScanned = scanLore(lorePieces, conversationText, preActivated);
  const loreSel = selectLore(lorePieces, conversationText, loreCap, preActivated);
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

// ============================================================================
// STORAGE — AbstractStorage (EventTarget + 500 ms debounced save queue) with
// an IndexedDB adapter. Entities are stored one-key-per-entity; the adapter
// keeps an in-memory cache that React reads synchronously.
// ============================================================================
const STORES = ['Scenarios', 'Personas', 'Chats', 'Meta'];

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
      const req = indexedDB.open(this.dbName, 1);
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
  async #post(route, body) {
    const res = await fetch(route, { method: 'POST', headers: this.#headers(), body: JSON.stringify(body ?? {}) });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = (await res.json())?.error ?? msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  }
  async init() {
    const res = await fetch('/version', { headers: this.#headers() });
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
const authHeaders = (apiKey, endpoint) => {
  if (!apiKey) return {};
  return isServerProxy(endpoint)
    ? { 'X-Real-Authorization': `Bearer ${apiKey}` }
    : { 'Authorization': `Bearer ${apiKey}` };
};

async function listModels({ endpoint, apiKey, signal } = {}) {
  const res = await fetch(modelsURL(endpoint), { headers: { ...authHeaders(apiKey, endpoint) }, signal });
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
async function* openaiChatStream({ endpoint, apiKey, model, messages, samplers = {}, maxTokens, signal, tokenProbs = false, logitBias = null, stop = null }) {
  const stopSet = Array.isArray(stop) && stop.length ? new Set(stop) : null;
  const res = await fetch(chatCompletionsURL(endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint) },
    body: JSON.stringify({
      model, messages, stream: true, max_tokens: maxTokens, ...samplers,
      ...(tokenProbs ? { logprobs: true, top_logprobs: 10 } : {}),
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
    // Stop-token emission: a finish chunk with empty/missing delta carries
    // the sampled EOS in logprobs — yield neither text nor tape for it.
    if (choice.finish_reason && !deltaText) continue;
    if (deltaText && !stopSet?.has(deltaText)) yield { content: deltaText };
    // vLLM/OpenAI put logprobs at choice level; tolerate delta-nested too.
    const lpContent = choice?.logprobs?.content ?? choice?.delta?.logprobs?.content;
    if (Array.isArray(lpContent) && lpContent.length) {
      const tape = lpContent.filter(t => t?.token && !stopSet?.has(t.token)).map(t => ({
        token: t.token,
        logprob: t.logprob ?? null,
        top: (t.top_logprobs ?? []).slice(0, 10)
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
      // Resync at the nearest occurrence of any remaining token in the text.
      let best = -1;
      for (let j = i; j < toks.length; j++) {
        const k = text.indexOf(toks[j].token, pos + 1);
        if (k !== -1 && (best === -1 || k < best)) { best = k; i = j; }
      }
      const end = best === -1 ? text.length : best;
      gap += text.slice(pos, end);
      pos = end;
      if (best === -1) break;
    }
  }
  flush();
  return spans;
}

// ---- /tokenize (vLLM; degrade to null when unavailable) ----
// Defensive about response shapes: {tokens:[ids]}, {tokens:["str"]},
// count-only {count}, or OpenAI-ish {data:{tokens}}. Cached per endpoint+model+text.
const tokenizeCache = new Map();
async function tokenize({ endpoint, apiKey, model, prompt }) {
  const key = `${endpoint}|${model}|${prompt}`;
  if (tokenizeCache.has(key)) return tokenizeCache.get(key);
  if (tokenizeCache.size > 500) tokenizeCache.clear();
  let out = null;
  try {
    const res = await fetch(`${normalizeEndpoint(endpoint)}/tokenize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint) },
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

async function getTokenCount({ endpoint, apiKey, model, text }) {
  const r = await tokenize({ endpoint, apiKey, model, prompt: text });
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

async function embed({ endpoint, apiKey, model, inputs }) {
  const res = await fetch(`${normalizeEndpoint(endpoint)}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint) },
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
async function embedCached({ endpoint, apiKey, model, text }) {
  const key = `${model}|${textHash(text)}`;
  if (embedCache.has(key)) return embedCache.get(key);
  if (embedCache.size > 500) embedCache.clear();
  const [vec] = await embed({ endpoint, apiKey, model, inputs: [text] });
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
async function auxCall({ endpoint, apiKey, model, system, user, maxTokens = 300, temperature = 0.7, stop = null }) {
  const res = await fetch(chatCompletionsURL(endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint) },
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
    try {
      const raw = localStorage.getItem(name);
      if (raw != null) return JSON.parse(raw);
    } catch (e) { console.error(e); }
    return typeof initialState === 'function' ? initialState() : initialState;
  });
  const update = useCallback((next) => {
    setValue(prev => {
      const v = typeof next === 'function' ? next(prev) : next;
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

const fmtDate = (ts) => ts ? new Date(ts).toLocaleString() : '';

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

function Markdown({ text, prose = false }) {
  const rendered = useMemo(
    () => marked.parse(prose ? wrapDialogue(text ?? '') : (text ?? '')),
    [text, prose]);
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

// ============================================================================
// COMPONENTS: SCENARIO EDITOR — full CRUD incl. lore piece editor.
// ============================================================================
function newLorePiece() {
  return {
    id: uid(), type: 'lore', title: '', content: '', keys: [],
    pinned: false, weight: 0, links: [], enabled: true, searchDepth: null,
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
          <label class="field"><span>Trigger keys — one per line, case-insensitive regex</span>
            <${ListInput} textarea=${true} delim=${'\n'} rows=${3} values=${piece.keys}
              onChange=${(keys) => set({ keys })} /></label>
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
    createdAt: Date.now(),
  };
}

function ScenarioEditor({ scenario, onSave, onClose }) {
  const [draft, setDraft] = useState(() => deepClone(scenario));
  const set = (patch) => setDraft(d => ({ ...d, ...patch }));
  const setPiece = (id, next) =>
    set({ lorePieces: draft.lorePieces.map(p => p.id === id ? next : p) });
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
  'characters; leave the actions, words, and thoughts of {{user}} to the user.';

const DEFAULT_SETTINGS = {
  endpoint: 'http://localhost:8080',
  apiKey: '',
  model: '',
  auxModel: '',
  embeddingModel: '', // semantic lore activation; empty = disabled
  contextLength: 8192,
  maxTokens: LENGTH_PRESETS.medium.maxTokens,
  responseLength: 'medium',
  samplers: { temperature: 0.8, top_p: 0.95, top_k: 40, min_p: 0.05, repetition_penalty: 1.1 },
  platformPrompt: DEFAULT_PLATFORM_PROMPT,
  tokenProbs: true, // request logprobs + top_logprobs on generations
  suggestions: true, // response-suggestion chips after generations
  stopStrings: [],  // sent as OpenAI `stop` when non-empty
  routeViaServer: true, // rewrite endpoint → /proxy/… at request time (server storage only)
  serverToken: '',  // optional Bearer token for server storage (FICTIONPAD_TOKEN)
  logitBias: {},    // { [inputString]: { ids: number[], strings: string[], power: -100..100 } }
};

function SettingsModal({ settings, onSave, onClose, theme, onThemeChange, accent, onAccentChange, onOpenLogitBias,
                        storageKind, onUpload, onDownload }) {
  const [draft, setDraft] = useState(() => deepClone(settings));
  const [models, setModels] = useState(null);
  const [modelsError, setModelsError] = useState(null);
  const [migBusy, setMigBusy] = useState(null);
  const [migNote, setMigNote] = useState(null);
  const set = (patch) => setDraft(d => ({ ...d, ...patch }));
  const setSampler = (k, v) => setDraft(d => ({ ...d, samplers: { ...d.samplers, [k]: v } }));

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
    try { setModels(await listModels({ endpoint: effectiveEndpoint(draft, storageKind === 'server'), apiKey: draft.apiKey })); }
    catch (e) { setModels(null); setModelsError(String(e.message ?? e)); }
  };

  return html`
    <${Modal} title="Settings" wide onClose=${onClose}
      footer=${html`<button class="btn ghost" onClick=${onClose}>Cancel</button>
        <button class="btn primary" onClick=${() => onSave(draft)}>Save settings</button>`}>
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
        <label class="field"><span>Aux model (memory summaries; blank = chat model)</span>
          <input type="text" list="fp-models" value=${draft.auxModel} onInput=${(e) => set({ auxModel: e.target.value })} /></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Embedding model (semantic lore activation; blank = off)</span>
          <input type="text" list="fp-models" placeholder="e.g. bge-m3" value=${draft.embeddingModel ?? ''}
            onInput=${(e) => set({ embeddingModel: e.target.value })} />
          <span class="hint">Often a separate model name on vLLM; Fetch above populates the list.</span>
        </label>
      </div>
      <div class="grid3">
        <label class="field"><span>Context length (tokens)</span>
          <input type="number" value=${draft.contextLength} onInput=${(e) => set({ contextLength: Number(e.target.value) })} /></label>
        <label class="field"><span>Response length preset</span>
          <select value=${draft.responseLength}
            onChange=${(e) => set({ responseLength: e.target.value, maxTokens: LENGTH_PRESETS[e.target.value]?.maxTokens ?? draft.maxTokens })}>
            <option value="short">Short (~150 tokens)</option>
            <option value="medium">Medium (~400 tokens)</option>
            <option value="long">Long (~800 tokens)</option>
          </select></label>
        <label class="field"><span>Max tokens (response reserve)</span>
          <input type="number" value=${draft.maxTokens} onInput=${(e) => set({ maxTokens: Number(e.target.value) })} /></label>
      </div>
      <div class="grid3">
        <label class="field"><span>Temperature</span>
          <input type="number" step="0.05" value=${draft.samplers.temperature} onInput=${(e) => setSampler('temperature', Number(e.target.value))} /></label>
        <label class="field"><span>top_p</span>
          <input type="number" step="0.01" value=${draft.samplers.top_p} onInput=${(e) => setSampler('top_p', Number(e.target.value))} /></label>
        <label class="field"><span>top_k</span>
          <input type="number" value=${draft.samplers.top_k} onInput=${(e) => setSampler('top_k', Number(e.target.value))} /></label>
        <label class="field"><span>min_p</span>
          <input type="number" step="0.01" value=${draft.samplers.min_p} onInput=${(e) => setSampler('min_p', Number(e.target.value))} /></label>
        <label class="field"><span>Repetition penalty</span>
          <input type="number" step="0.01" value=${draft.samplers.repetition_penalty} onInput=${(e) => setSampler('repetition_penalty', Number(e.target.value))} /></label>
      </div>
      <label class="field"><span>Stop strings — one per line; generation halts at these (server-side)</span>
        <${ListInput} textarea=${true} delim=${'\n'} rows=${3} values=${draft.stopStrings ?? []}
          placeholder="e.g. your EOS marker, if your model emits one"
          onChange=${(stopStrings) => set({ stopStrings })} /></label>
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
      </div>
      <label class="field"><span>Platform system prompt — lowest instruction rank; {{user}} works here</span>
        <textarea rows=${5} value=${draft.platformPrompt} onInput=${(e) => set({ platformPrompt: e.target.value })} /></label>
      <button class="btn small" onClick=${() => set({ platformPrompt: DEFAULT_PLATFORM_PROMPT })}>Reset prompt to default</button>
      <div class="field"><span>Auxiliary features</span>
        <label class="check">
          <input type="checkbox" checked=${draft.tokenProbs !== false} onChange=${(e) => set({ tokenProbs: e.target.checked })} />
          Token probabilities (request logprobs + top-10 alternatives per token)
        </label>
        <label class="check">
          <input type="checkbox" checked=${draft.suggestions !== false} onChange=${(e) => set({ suggestions: e.target.checked })} />
          Response suggestions (2 clickable options after each AI reply)
        </label>
        <div style=${{ marginTop: '4px' }}>
          <button class="btn small" onClick=${onOpenLogitBias}>Edit logit bias…</button>
          <span class="hint" style=${{ marginLeft: '8px' }}>${Object.keys(draft.logitBias ?? {}).length} entr(ies)</span>
        </div>
      </div>
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

function ContextInspector({ manifest, onPreview, hasChat, realCounts }) {
  const [showInactive, setShowInactive] = useState(false);
  if (!manifest?.layers) return html`
    <div>
      <div class="hint">No generation recorded yet. Send a message, or preview the context that would be sent right now.</div>
      ${hasChat && html`<button class="btn" style=${{ marginTop: '8px' }} onClick=${onPreview}>Preview current context</button>`}
    </div>`;
  const L = manifest.layers;
  const row = (k, v) => html`<div class="kv"><span class="k">${k}</span><span>${v}</span></div>`;
  // Real count leads when available; estimate is the dim parenthetical.
  const estReal = (est, real) => real != null
    ? html`<span>${real} tok <span class="hint">(est ${est})</span></span>`
    : html`<span>${est} tok <span class="hint">(est)</span></span>`;
  return html`
    <div>
      ${row('Context budget', `${manifest.budget} tok (ctx ${manifest.contextLength} − reserve ${manifest.reserve})`)}
      ${row('Total', estReal(manifest.totalTokens, realCounts?.total))}
      <h4>Layers</h4>
      ${row('Static', html`<span>${estReal(L.static.tokens, realCounts?.static)} <span class="hint">(cap ${L.static.cap})</span></span>`)}
      ${row('Lore', html`<span>${estReal(L.lore.tokens, realCounts?.lore)} <span class="hint">(cap ${L.lore.cap})</span></span>`)}
      ${row('Memory', html`<span>${estReal(L.memory.tokens, realCounts?.memory)} <span class="hint">(cap ${L.memory.cap})</span></span>`)}
      ${row('Greeting', estReal(L.greeting?.tokens ?? 0, realCounts?.greeting))}
      ${row('History', html`<span>${estReal(L.history.tokens, realCounts?.history)} <span class="hint">(cap ${L.history.cap}; ${L.history.kept} kept, ${L.history.dropped} dropped)</span></span>`)}
      ${manifest.warnings.map((w, i) => html`<div class="warn" key=${i}>⚠\uFE0E ${w}</div>`)}
      <h4>Lore injected (${L.lore.pieces.length})</h4>
      ${L.lore.pieces.length === 0 && html`<div class="hint">No lore pieces active.</div>`}
      ${L.lore.pieces.map(p => html`
        <${InspectorRow} key=${p.id}
          pills=${[{ text: p.reason, cls: p.reason },
            ...(p.boost > 0 && p.reason !== 'link-boosted' ? [{ text: `+${p.boost} boost`, cls: 'link-boosted' }] : [])]}
          title=${p.title} meta=${`w${p.weight} · ${p.tokens}t`}
          preview=${p.preview} content=${p.content} />`)}
      ${(L.lore.inactive ?? []).length > 0 && html`
        <div class="hint ir-toggle" onClick=${() => setShowInactive(!showInactive)}>
          Not injected (${L.lore.inactive.length}) ${showInactive ? '▾' : '▸'}
        </div>
        ${showInactive && L.lore.inactive.map((p, i) => html`
          <${InspectorRow} key=${p.id ?? i} dimmed
            pills=${[{ text: p.reason, cls: p.reason === 'over-budget' ? 'pinned' : '' }]}
            title=${p.title} meta=${`${p.tokens}t`}
            preview=${p.preview} content=${p.content} />`)}`}
      <h4>Memories injected (${L.memory.memories.length})</h4>
      ${L.memory.memories.length === 0 && html`<div class="hint">No memories injected.</div>`}
      ${L.memory.memories.map((m, i) => html`
        <${InspectorRow} key=${m.id ?? i}
          pills=${m.pinned ? [{ text: 'pinned', cls: 'pinned' }] : []}
          title=${`memory ${String(m.id ?? '').slice(-6)}`} meta=${`${m.tokens}t`}
          preview=${m.preview} content=${m.text} />`)}
      ${hasChat && html`<button class="btn" style=${{ marginTop: '8px' }} onClick=${onPreview}>Re-run assembler on current chat</button>`}
    </div>`;
}

// ============================================================================
// COMPONENTS: MEMORY PANEL — view / pin / delete memories, manual summarize.
// ============================================================================
function MemoryPanel({ chat, onUpdateChat, onSummarize, summarizing }) {
  if (!chat) return html`<div class="hint">Select a chat to see its memories.</div>`;
  const memories = [...(chat.memoryStore?.memories ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const setStore = (mems) => onUpdateChat({ ...chat, memoryStore: { ...chat.memoryStore, memories: mems } });
  return html`
    <div>
      <div style=${{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' }}>
        <span class="hint" style=${{ flex: 1 }}>
          ${memories.length}/${MEMORY_CAP} memories · auto-summary every ${MEMORY_EVERY} messages
        </span>
        <button class="btn small" disabled=${summarizing} onClick=${onSummarize}>
          ${summarizing ? 'Summarizing…' : 'Summarize now'}</button>
      </div>
      ${memories.length === 0 && html`<div class="hint">No memories yet. They are created automatically as the chat grows, and are versioned with the chat (branches fork them, rewinds roll them back).</div>`}
      ${memories.map(m => html`
        <div class="mem-item" key=${m.id}>
          <div class="row">
            ${m.pinned && html`<span class="pill pinned">pinned</span>`}
            <span class="hint" style=${{ flex: 1 }}>${fmtDate(m.createdAt)}</span>
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
function ChatOptions({ chat, personas, onUpdateChat, onExport, onDelete }) {
  if (!chat) return html`<div class="hint">Select a chat first.</div>`;
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
      <label class="field"><span>Custom instructions — appended to the system layer for this chat only</span>
        <textarea rows=${4} value=${chat.customInstructions ?? ''}
          onInput=${(e) => onUpdateChat({ ...chat, customInstructions: e.target.value })} /></label>
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

function MessageItem({ node, isRoot, isLeaf, personaName, characterNames, streaming, generating, onEdit, onRegenerate, onSwipe, onSwipeTo, onBranch, onRewind, onDelete, onReply, onRegenFromToken }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [showProbs, setShowProbs] = useState(false);
  const swipe = node.swipes[node.activeSwipe] ?? { text: '' };
  const text = subUser(swipe.text, personaName);
  const isUser = node.role === 'user';
  const isOOC = /^\[OOC:/i.test(text.trim());
  const hasProbs = !isUser && Array.isArray(swipe.tokens) && swipe.tokens.length > 0;
  const speaker = isUser ? null : (swipe.speaker ?? detectSpeaker(text, characterNames) ?? 'Narrator');
  const isCharacter = !!speaker && speaker !== 'Narrator';
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
  return html`
    <div class="msg ${isUser ? 'user' : 'assistant'} ${isOOC ? 'ooc' : ''}">
      <div class="meta">
        <span class="who ${isCharacter ? 'speaker' : ''}"
          style=${isCharacter ? { '--speaker-h': hueForName(speaker) } : null}>${isUser ? personaName : speaker}</span>
        ${node.edited && html`<span>(edited)</span>`}
        ${swipe.modelId && html`<span>${swipe.modelId}</span>`}
        <span style=${{ flex: 1 }}></span>
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
        <span class="actions ${streaming ? 'always' : ''}">
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
      </div>
      <div class="bubble ${dragX !== 0 ? 'dragging' : ''}"
        style=${{ transform: dragX ? `translateX(${dragX}px)` : null }}
        ...${gestureHandlers}>
        ${editing ? html`
          <textarea class="edit" value=${draft} onInput=${(e) => setDraft(e.target.value)} />
          <div style=${{ display: 'flex', gap: '6px' }}>
            <button class="btn small primary" onClick=${() => { onEdit(node.id, draft); setEditing(false); }}>Save</button>
            <button class="btn small" onClick=${() => setEditing(false)}>Cancel</button>
          </div>` :
          showProbs && hasProbs
            ? html`<${ProbsView} tokens=${swipe.tokens} onPick=${(i, alt) => onRegenFromToken(node.id, i, alt)} />` :
          isOOC
            ? html`<div class="plain ${streaming ? 'streaming-cursor' : ''}">${text}</div>`
            : html`<div class=${streaming ? 'streaming-cursor' : ''}><${Markdown} text=${text} prose /></div>`}
      </div>
    </div>`;
}

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
  // Auto-grow the textarea with the draft, capped (CSS max-height) so long
  // messages scroll internally instead of eating the screen.
  const taRef = useRef(null);
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [text]);
  return html`
    <div class="composer">
      <div class="row">
        <textarea ref=${taRef} value=${text} rows=${2}
          placeholder=${coarseEnter
            ? 'Write a message…  (commands: /ooc /continue /improve /recap N /memory N /model NAME)'
            : 'Write a message…  (Enter to send; commands: /ooc /continue /improve /recap N /memory N /model NAME)'}
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
                  onSubmitInput, onStop, composerInject, auxBusy, ...actions }) {
  const logRef = useRef(null);
  const path = useMemo(() => getActivePath(chat?.messages, chat?.activeLeafId), [chat]);
  // Stick-to-bottom: follow content growth only while the user is pinned to
  // the bottom zone (~80px). Programmatic scrolls are flagged so they don't
  // unpin/re-pin themselves via the scroll listener.
  const pinnedRef = useRef(true);
  const programmaticRef = useRef(false);
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
    if (programmaticRef.current) { programmaticRef.current = false; return; }
    const isPinned = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (isPinned !== pinnedRef.current) { pinnedRef.current = isPinned; setPinned(isPinned); }
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
        ${path.map(node => html`
          <${MessageItem} key=${node.id} node=${node} isRoot=${!node.parentId} isLeaf=${node.id === leaf?.id}
            personaName=${personaName} characterNames=${characterNames}
            streaming=${generating?.nodeId === node.id}
            generating=${!!generating}
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
// COMPONENTS: SIDEBAR
// ============================================================================
function Sidebar({ scenarios, chats, selectedScenarioId, selectedChatId, onSelectScenario, onSelectChat,
                  onNewScenario, onEditScenario, onDeleteScenario, onNewChat, onExportScenario, onImport,
                  onOpenPersonas, onOpenSettings, collapsed, onToggleCollapse, onDeleteChat,
                  storageKind, saveRetrying,
                  width, onDragStart, onResetWidth, onChatAction, onChatContextMenu }) {
  const chatList = Object.values(chats)
    .filter(c => !selectedScenarioId || c.scenarioId === selectedScenarioId)
    .sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0));
  const scenarioList = Object.values(scenarios).sort((a, b) => a.name.localeCompare(b.name));
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
  return html`
    <div class="sidebar ${collapsed ? 'collapsed' : ''}"
      style=${{ width: collapsed ? 0 : width, minWidth: collapsed ? 0 : width }}>
      <div class="head">
        <h1>FictionPad</h1>
        <button class="btn small ghost" title="Personas" onClick=${onOpenPersonas}>Personas</button>
        <button class="btn small ghost" title="Settings" onClick=${onOpenSettings}>⚙\uFE0E</button>
        <button class="btn small ghost" title="Collapse sidebar" onClick=${onToggleCollapse}>«</button>
      </div>
      <div class="scroll">
        <div class="side-section">
          <div class="title">Scenarios
            <button class="btn small ghost" title="New scenario" onClick=${onNewScenario}>＋</button>
          </div>
          ${scenarioList.length === 0 && html`<div class="hint" style=${{ padding: '0 6px' }}>No scenarios yet.</div>`}
          ${scenarioList.map(s => html`
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
          <div class="title">Chats${selectedScenarioId ? '' : ' (all)'}</div>
          ${chatList.length === 0 && html`<div class="hint" style=${{ padding: '0 6px' }}>No chats yet. Use ✉\uFE0E on a scenario.</div>`}
          ${chatList.map(c => html`
            <div class="side-item chat ${c.id === selectedChatId ? 'selected' : ''}" key=${c.id}
              onClick=${() => onSelectChat(c.id)}
              onContextMenu=${(e) => { e.preventDefault(); onChatContextMenu(c.id, e.clientX, e.clientY); }}
              onPointerDown=${(e) => lpStart(e, c.id)}
              onPointerMove=${lpCancel} onPointerUp=${lpCancel} onPointerCancel=${lpCancel}>
              <span class="name">${c.name}</span>
              <span class="tools">
                <button class="btn small ghost" title="Inspector"
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
        <button class="btn small" onClick=${onImport}>Import JSON</button>
        <span class="hint ${saveRetrying ? 'warn' : ''}" style=${{ marginLeft: 'auto', alignSelf: 'center' }}
          title=${saveRetrying
            ? 'Some edits could not be saved (server unreachable) — they are queued and retried automatically.'
            : storageKind === 'server'
              ? 'Scenarios, personas and chats are stored on this server (shared).'
              : 'Data is stored locally in this browser.'}>
          ${saveRetrying ? '⚠\uFE0E saving…' : storageKind === 'server' ? 'server storage' : 'local storage'}</span>
      </div>
      ${!collapsed && html`<div class="pane-handle right" title="Drag to resize · double-click to reset"
        onPointerDown=${(e) => { e.preventDefault(); onDragStart(e.clientX); }}
        onDoubleClick=${onResetWidth} />`}
    </div>`;
}

// ============================================================================
// COMPONENTS: NEW CHAT MODAL (scenario → pick persona)
// ============================================================================
function NewChatModal({ scenario, personas, onCreate, onClose }) {
  const list = Object.values(personas);
  const [personaId, setPersonaId] = useState(list[0]?.id ?? '');
  const [newName, setNewName] = useState('');
  return html`
    <${Modal} title=${`New chat — ${scenario.name}`} onClose=${onClose}
      footer=${html`<button class="btn primary" onClick=${() => onCreate(personaId, newName)}>Start chat</button>`}>
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

function ChatPanelModal({ chat, tab, onTab, manifest, realCounts, onPreview, personas,
                         onUpdateChat, onSummarize, summarizing, onExport, onDelete, onClose }) {
  return html`
    <${Modal} title=${chat.name} cls="sheet" onClose=${onClose}>
      <div class="ptabs">
        ${Object.entries(PANEL_TABS).map(([t, label]) => html`
          <button key=${t} class=${tab === t ? 'active' : ''} onClick=${() => onTab(t)}>${label}</button>`)}
      </div>
      <div class="pbody">
        ${tab === 'inspector' && html`
          <${ContextInspector} manifest=${manifest} hasChat=${true} onPreview=${onPreview} realCounts=${realCounts} />`}
        ${tab === 'memory' && html`
          <${MemoryPanel} chat=${chat} onUpdateChat=${onUpdateChat} onSummarize=${onSummarize} summarizing=${summarizing} />`}
        ${tab === 'chat' && html`
          <${ChatOptions} chat=${chat} personas=${personas} onUpdateChat=${onUpdateChat}
            onExport=${onExport} onDelete=${onDelete} />`}
      </div>
    <//>`;
}

// ============================================================================
// COMPONENTS: RIGHT DRAWER — docked Inspector/Memory pane (the per-chat modal
// above remains for chat-row/context-menu entry; Chat settings stays
// modal-only). Fixed overlay on the right like the left sidebar, drag-resizable
// on desktop, slide-in overlay on phones.
// ============================================================================
const DRAWER_TABS = { inspector: 'Inspector', memory: 'Memory' };

function RightDrawer({ chat, tab, onTab, manifest, realCounts, onPreview,
                      onUpdateChat, onSummarize, summarizing,
                      width, onDragStart, onResetWidth, onClose }) {
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
          <${ContextInspector} manifest=${manifest} hasChat=${true} onPreview=${onPreview} realCounts=${realCounts} />`}
        ${chat && tab === 'memory' && html`
          <${MemoryPanel} chat=${chat} onUpdateChat=${onUpdateChat} onSummarize=${onSummarize} summarizing=${summarizing} />`}
      </div>
      ${tab && html`<div class="pane-handle left" title="Drag to resize · double-click to reset"
        onPointerDown=${(e) => { e.preventDefault(); onDragStart(e.clientX); }}
        onDoubleClick=${onResetWidth} />`}
    </div>`;
}

// ============================================================================
// APP — wires storage, collections, generation orchestration, and the panels.
// ============================================================================
function newChat(scenario, personaId) {
  const rootId = uid();
  return {
    id: uid(), scenarioId: scenario.id, personaId: personaId ?? null,
    name: `${scenario.name} — ${fmtDate(Date.now())}`,
    customInstructions: '',
    rootMessageId: rootId, activeLeafId: rootId,
    messages: {
      [rootId]: { id: rootId, parentId: null, role: 'assistant', edited: false, activeSwipe: 0,
        swipes: [{ text: scenario.greeting ?? '', createdAt: Date.now(), modelId: null }] },
    },
    memoryStore: { memories: [], cursor: 0 },
    settings: {},
    createdAt: Date.now(), updatedAt: Date.now(),
  };
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
  const [settingsRaw, setSettings] = usePersistentState('fictionpad.settings', DEFAULT_SETTINGS);
  const settings = useMemo(() => ({
    ...DEFAULT_SETTINGS, ...(settingsRaw ?? {}),
    samplers: { ...DEFAULT_SETTINGS.samplers, ...(settingsRaw?.samplers ?? {}) },
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
  const [manifest, setManifest] = useState(null);
  const [lastMessages, setLastMessages] = useState(null); // chat-completions array behind manifest
  const [realCounts, setRealCounts] = useState(null); // /tokenize counts {static,lore,memory,total} | null
  const [modal, setModal] = useState(null);
  const [generating, setGenerating] = useState(null); // { chatId, nodeId }
  const [summarizing, setSummarizing] = useState(false);
  const [suggestions, setSuggestions] = useState(null); // { chatId, nodeId, swipe, loading, items } | null
  const [composerInject, setComposerInject] = useState(null); // { text?, hint?, nonce }
  const [auxBusy, setAuxBusy] = useState(null); // 'improve' | 'recap' | 'memory' | null
  const [error, setError] = useState(null);
  const genRef = useRef(null); // { abort }

  // Always-fresh refs for async generation loops (avoid stale closures).
  const ref = useRef({});
  ref.current = { scenarios, personas, chats, settings };

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
        ? getTokenCount({ endpoint: effEp(st), apiKey: st.apiKey, model, text })
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
  // On chat open/switch (incl. after branching), default to the swipes the
  // conversation actually continued from. In-session browsing is unaffected.
  useEffect(() => {
    const c = ref.current.chats[ui.chatId];
    if (!c) return;
    const next = applyUsedSwipes(c);
    if (next !== c) upsertChat(next.id, next);
  }, [ui.chatId]);
  const persona = chat?.personaId ? personas[chat.personaId] : null;
  const personaName = persona?.name?.trim() || 'User';
  const characterNames = useMemo(
    () => characterNamesOf(chat ? scenarios[chat.scenarioId] : null),
    [chat, scenarios]);
  const sidebarCollapsed = ui.sidebarCollapsed ?? (window.innerWidth <= 700); // phones start with the drawer closed
  const toggleSidebar = () => setUi(u => ({ ...u, sidebarCollapsed: !sidebarCollapsed }));
  // Right drawer: ui.drawer is the open tab ('inspector' | 'memory') or null.
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
  const openChatPanel = (chatId, tab) => {
    setUi(u => ({ ...u, chatId }));
    setModal({ kind: 'chatPanel', chatId, tab });
  };
  const chatAction = (chatId, action) => {
    const c = ref.current.chats[chatId];
    if (!c) return;
    switch (action) {
      case 'inspector': return openChatPanel(chatId, 'inspector');
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
  async function generateMemory(chatObj, messageCount = MEMORY_EVERY) {
    const { personas: pe, settings: st } = ref.current;
    const model = st.auxModel || st.model;
    if (!st.endpoint || !model) throw new Error('Configure an endpoint and model in Settings first.');
    const pName = (chatObj.personaId && pe[chatObj.personaId]?.name?.trim()) || 'User';
    const path = getActivePath(chatObj.messages, chatObj.activeLeafId);
    const recent = path.slice(-messageCount)
      .map(n => `${n.role === 'user' ? pName : 'Character'}: ${subUser(activeText(n), pName)}`)
      .join('\n\n');
    if (!recent.trim()) return null;
    const out = await auxCall({
      endpoint: effEp(st), apiKey: st.apiKey, model,
      system: 'You keep memory notes for an ongoing roleplay. Summarize the key recent events, revealed facts, and relationship changes as compact plain prose of at most 500 characters. Past events only; no speculation; no lists; no formatting.',
      user: `Recent conversation:\n\n${recent}\n\nMemory note (max 500 characters):`,
      maxTokens: 220, temperature: 0.3, stop: st.stopStrings,
    });
    return out.slice(0, 500) || null;
  }
  async function summarizeNow(chatObj) {
    setSummarizing(true);
    try {
      const text = await generateMemory(chatObj, MEMORY_EVERY);
      if (text) {
        const pathLen = getActivePath(chatObj.messages, chatObj.activeLeafId).length;
        const store = addMemory(chatObj.memoryStore, text);
        saveChat({ ...chatObj, memoryStore: { ...store, cursor: pathLen } });
      }
    } catch (e) {
      setError(`Memory summarization failed: ${e.message ?? e}`);
    } finally {
      setSummarizing(false);
    }
  }
  function maybeSummarize(chatObj) {
    const pathLen = getActivePath(chatObj.messages, chatObj.activeLeafId).length;
    if (pathLen - (chatObj.memoryStore?.cursor ?? 0) >= MEMORY_EVERY) summarizeNow(chatObj);
  }

  // ---- generation ----
  async function runGeneration(chatObj, nodeId, { continuation = false, fresh = false } = {}) {
    const { scenarios: sc, personas: pe, settings: st } = ref.current;
    const model = chatObj.settings?.model || st.model; // per-chat override wins
    if (!st.endpoint || !model) { setError('Configure an endpoint and chat model in Settings first.'); return; }
    const scen = sc[chatObj.scenarioId];
    const pers = chatObj.personaId ? pe[chatObj.personaId] : null;
    const node = chatObj.messages[nodeId];
    // The node being generated is excluded from the prompt unless continuing it.
    const promptChat = continuation ? chatObj : { ...chatObj, activeLeafId: node?.parentId ?? chatObj.activeLeafId };
    // Semantic lore activation (async, outside the pure assembler): embed the
    // recent conversation + smart pieces, threshold → preActivated id set.
    // Any embeddings failure degrades to keyword-only with a manifest warning.
    let preActivated = null;
    let semanticWarning = null;
    if (st.embeddingModel) {
      const smartPieces = (scen?.lorePieces ?? []).filter(p => p && p.enabled !== false && !p.pinned && p.smart);
      const queryText = getActivePath(promptChat.messages, promptChat.activeLeafId)
        .map(activeText).join('\n').slice(-1500);
      if (smartPieces.length && queryText.trim()) {
        try {
          const [queryVec] = await embed({ endpoint: effEp(st), apiKey: st.apiKey, model: st.embeddingModel, inputs: [queryText] });
          const vecs = await Promise.all(smartPieces.map(p =>
            embedCached({ endpoint: effEp(st), apiKey: st.apiKey, model: st.embeddingModel,
              text: `${p.title ?? ''}\n${(p.content ?? '').slice(0, 500)}` })));
          preActivated = new Set();
          for (let i = 0; i < smartPieces.length; i++)
            if (cosine(queryVec, vecs[i]) >= SEMANTIC_THRESHOLD) preActivated.add(smartPieces[i].id);
        } catch (e) {
          console.warn('Semantic lore activation failed:', e);
          semanticWarning = 'Semantic lore activation failed (embeddings); keyword-only for this generation.';
        }
      }
    }
    const { messages, manifest: man } = assemblePrompt({
      scenario: scen, persona: pers, chat: promptChat, settings: st, platformPrompt: st.platformPrompt, preActivated,
    });
    if (semanticWarning) man.warnings.push(semanticWarning);
    setManifest(man);
    setLastMessages(messages);
    setSuggestions(null);
    // Logit bias: OpenAI shape {token_id: bias}, first token of each entry.
    const logitBias = {};
    for (const e of Object.values(st.logitBias ?? {})) {
      const id = e?.ids?.[0];
      if (Number.isInteger(id)) logitBias[String(id)] = Math.max(-100, Math.min(100, e.power));
    }
    const abort = new AbortController();
    genRef.current = { abort };
    setGenerating({ chatId: chatObj.id, nodeId });
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
      const spans = [...baseSpans, ...alignTokensToSpans(acc.slice(baseText.length), lpTape)];
      if (spans.some(s => s.logprob != null)) applyText(acc, spans);
      else if (st.tokenProbs !== false && acc)
        console.warn('FictionPad: logprobs were requested but the stream contained none — ' +
          'an intermediate proxy/middleware may not be forwarding "logprobs"/"top_logprobs" to the backend.');
    };
    try {
      for await (const chunk of openaiChatStream({
        endpoint: effEp(st), apiKey: st.apiKey, model, messages,
        samplers: st.samplers, maxTokens: st.maxTokens, signal: abort.signal,
        tokenProbs: st.tokenProbs !== false, logitBias, stop: st.stopStrings,
      })) {
        if (chunk.lp) { lpTape.push(...chunk.lp); continue; }
        acc += chunk.content;
        applyText(acc);
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        setError(`Generation failed: ${e.message ?? e}`);
        if (!acc) {
          // Clean up the empty swipe / node so no blank bubble is left behind.
          const n = work.messages[nodeId];
          if (n && n.swipes.length > 1) {
            const swipes = n.swipes.slice(0, -1);
            work = { ...work, messages: { ...work.messages, [nodeId]: { ...n, swipes, activeSwipe: swipes.length - 1 } } };
            upsertChat(work.id, work);
          } else if (n && fresh) {
            const messages = { ...work.messages };
            delete messages[nodeId];
            work = { ...work, messages, activeLeafId: n.parentId };
            upsertChat(work.id, work);
          }
        }
      }
    } finally {
      genRef.current = null;
      setGenerating(null);
      if (acc) {
        attachProbs();
        // Attribute the finished swipe to a character (or "Narrator").
        const names = characterNamesOf(scen);
        const n = work.messages[nodeId];
        if (n) {
          const swipes = n.swipes.slice();
          swipes[n.activeSwipe] = { ...swipes[n.activeSwipe], speaker: detectSpeaker(acc, names) ?? 'Narrator' };
          work = { ...work, messages: { ...work.messages, [nodeId]: { ...n, swipes } } };
          upsertChat(work.id, work);
        }
        maybeSummarize(work);
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
    const swipeIdx = chatObj.messages[nodeId]?.activeSwipe ?? 0;
    const recent = getActivePath(chatObj.messages, nodeId).slice(-6)
      .map(n => `${n.role === 'user' ? pName : 'Narrator'}: ${subUser(activeText(n), pName)}`)
      .join('\n\n');
    const key = { chatId: chatObj.id, nodeId, swipe: swipeIdx };
    setSuggestions({ ...key, loading: true, items: null });
    try {
      const out = await auxCall({
        endpoint: effEp(st), apiKey: st.apiKey, model,
        system: `You suggest what the user's character (${pName}) might say or do next in this roleplay. Reply with exactly 2 options as a numbered list, one per line, at most 20 words each, written in first person as ${pName}. In-character; do not narrate other characters' actions; no commentary.`,
        user: `Recent scene:\n\n${recent}\n\nTwo options for ${pName}:`,
        maxTokens: 120, temperature: 0.9, stop: st.stopStrings,
      });
      const items = out.split('\n')
        .map(l => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
        .filter(l => l.length > 0 && l.split(/\s+/).length <= 30 && !/^\d+$/.test(l) && !/:$/.test(l))
        .slice(0, 2);
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
      return `Unknown command ${cmd}. Available: /ooc, /continue, /improve, /recap N, /memory N, /model NAME`;
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
      const out = await auxCall({
        endpoint: effEp(st), apiKey: st.apiKey, model,
        system: `Rewrite the user's draft in first person as ${pName}${personaDesc}, matching the roleplay's tone. Output only the rewritten text.`,
        user: `${recent ? `Recent scene:\n\n${recent}\n\n` : ''}Draft:\n\n${draft}`,
        maxTokens: 400, temperature: 0.7, stop: st.stopStrings,
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
      const out = await auxCall({
        endpoint: effEp(st), apiKey: st.apiKey, model,
        system: 'Summarize the following roleplay excerpt into a cohesive recap in third person, past tense, at most 400 words. Output only the recap.',
        user: `Roleplay excerpt (last ${n} messages):\n\n${recent}`,
        maxTokens: 700, temperature: 0.4, stop: st.stopStrings,
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
      const store = addMemory(c.memoryStore, text); // manual: cursor untouched
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
  const createChat = (scenarioId, personaId, newPersonaName) => {
    let pid = personaId || null;
    if (!pid && newPersonaName.trim()) {
      pid = uid();
      upsertPersona(pid, { id: pid, name: newPersonaName.trim(), description: '' });
    }
    const scen = ref.current.scenarios[scenarioId];
    if (!scen) return;
    const c = newChat(scen, pid);
    upsertChat(c.id, c);
    setUi(u => ({ ...u, chatId: c.id, scenarioId }));
    setModal(null);
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
  const onImport = async () => {
    const obj = await pickJSONFile();
    if (!obj) return;
    if (obj.__error) return setError(`Import failed: ${obj.__error}`);
    if (obj.type === 'fictionpad-scenario' && obj.data?.name != null) {
      const s = { ...obj.data, id: uid() };
      upsertScenario(s.id, s);
      setUi(u => ({ ...u, scenarioId: s.id }));
    } else if (obj.type === 'fictionpad-chat' && obj.data?.messages) {
      const c = { ...obj.data, id: uid() };
      upsertChat(c.id, c);
      setUi(u => ({ ...u, chatId: c.id, scenarioId: c.scenarioId }));
      if (!ref.current.scenarios[c.scenarioId])
        setError('Chat imported, but its scenario is not present in this browser.');
    } else {
      setError('Unrecognized JSON: expected a FictionPad scenario or chat export.');
    }
  };

  const onPreview = () => {
    const c = ref.current.chats[ui.chatId];
    if (!c) return;
    const { messages, manifest: man } = assemblePrompt({
      scenario: ref.current.scenarios[c.scenarioId],
      persona: c.personaId ? ref.current.personas[c.personaId] : null,
      chat: c, settings: ref.current.settings, platformPrompt: ref.current.settings.platformPrompt,
    });
    setManifest(man);
    setLastMessages(messages);
  };

  return html`
    <div class="app ${sidebarCollapsed ? '' : 'sb-open'} ${dragging ? 'dragging' : ''}">
      ${isMobile && (!sidebarCollapsed || ui.drawer) && html`
        <div class="scrim" onClick=${() => { if (!sidebarCollapsed) toggleSidebar(); closeDrawer(); }} />`}
      <${Sidebar}
        scenarios=${scenarios} chats=${chats}
        selectedScenarioId=${ui.scenarioId} selectedChatId=${ui.chatId}
        onSelectScenario=${(id) => setUi(u => ({ ...u, scenarioId: id }))}
        onSelectChat=${(id) => setUi(u => ({ ...u, chatId: id }))}
        onNewScenario=${() => setModal({ kind: 'scenario', scenario: newScenario() })}
        onEditScenario=${(id) => setModal({ kind: 'scenario', scenario: scenarios[id] })}
        onDeleteScenario=${onDeleteScenario}
        onNewChat=${(scenarioId) => setModal({ kind: 'newChat', scenarioId })}
        onExportScenario=${onExportScenario}
        onImport=${onImport}
        onOpenPersonas=${() => setModal({ kind: 'personas' })}
        onOpenSettings=${() => setModal({ kind: 'settings' })}
        collapsed=${sidebarCollapsed} onToggleCollapse=${toggleSidebar}
        onDeleteChat=${onDeleteChat}
        onChatAction=${chatAction}
        onChatContextMenu=${(chatId, x, y) => setCtxMenu({ chatId, x, y })}
        storageKind=${storageKind} saveRetrying=${saveRetrying}
        width=${sbW} onDragStart=${paneDragStart('left')} onResetWidth=${() => resetPaneWidth('left')} />
      <div class="center-col" style=${{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, paddingLeft: padL, paddingRight: padR }}>
        ${storageFailed && html`<div class="banner">IndexedDB unavailable — data will not persist across reloads.</div>`}
        ${error && html`<div class="banner">${error}<button class="btn small ghost" onClick=${() => setError(null)}>✕</button></div>`}
        <div class="topbar">
          <div class="topbar-inner">
            ${sidebarCollapsed && html`<button class="btn small ghost" title="Show sidebar" onClick=${toggleSidebar}>»</button>`}
            <span class="title">${chat ? chat.name : 'FictionPad'}</span>
            ${chat && html`<span class="sub">${scenarios[chat.scenarioId]?.name ?? '(missing scenario)'} · {{user}} = ${personaName}</span>`}
            <span class="spacer"></span>
            <button class="btn small ghost ${ui.drawer === 'inspector' ? 'active' : ''}"
              title="Context inspector" onClick=${() => toggleDrawer('inspector')}>Inspector</button>
            <button class="btn small ghost ${ui.drawer === 'memory' ? 'active' : ''}"
              title="Memories" onClick=${() => toggleDrawer('memory')}>Memory</button>
          </div>
        </div>
        <div style=${{ flex: 1, display: 'flex', minHeight: 0 }}>
          <${ErrorBoundary} name="chat">
            <${ChatPane} chat=${chat} persona=${persona} characterNames=${characterNames}
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
        manifest=${manifest} realCounts=${realCounts} onPreview=${onPreview}
        onUpdateChat=${saveChat}
        onSummarize=${() => chat && summarizeNow(chat)} summarizing=${summarizing}
        width=${dwW} onDragStart=${paneDragStart('right')} onResetWidth=${() => resetPaneWidth('right')}
        onClose=${closeDrawer} />
    </div>
    ${modal?.kind === 'scenario' && html`
      <${ErrorBoundary} name="scenario editor"><${ScenarioEditor} scenario=${modal.scenario} onSave=${onSaveScenario} onClose=${() => setModal(null)} /><//>`}
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
        onTokenize=${(prompt) => tokenize({ endpoint: effectiveEndpoint(settings, storageKind === 'server'), apiKey: settings.apiKey, model: settings.model, prompt })}
        onClose=${() => setModal(null)} /><//>`}
    ${modal?.kind === 'newChat' && scenarios[modal.scenarioId] && html`
      <${ErrorBoundary} name="new chat"><${NewChatModal} scenario=${scenarios[modal.scenarioId]} personas=${personas}
        onCreate=${(pid, newName) => createChat(modal.scenarioId, pid, newName)}
        onClose=${() => setModal(null)} /><//>`}
    ${modal?.kind === 'recap' && html`
      <${ErrorBoundary} name="recap"><${RecapModal} text=${modal.text} onClose=${() => setModal(null)}
        onSaveMemory=${() => {
          const c = ref.current.chats[ui.chatId];
          if (c) {
            const store = addMemory(c.memoryStore, modal.text);
            saveChat({ ...c, memoryStore: { ...store, cursor: c.memoryStore?.cursor ?? 0 } });
          }
        }} /><//>`}
    ${modal?.kind === 'chatPanel' && chats[modal.chatId] && html`
      <${ErrorBoundary} name="chat panel"><${ChatPanelModal}
        chat=${chats[modal.chatId]} tab=${modal.tab}
        onTab=${(tab) => setModal(m => ({ ...m, tab }))}
        manifest=${manifest} realCounts=${realCounts} onPreview=${onPreview}
        personas=${personas} onUpdateChat=${saveChat}
        onSummarize=${() => summarizeNow(chats[modal.chatId])} summarizing=${summarizing}
        onExport=${() => onExportChat(chats[modal.chatId])}
        onDelete=${() => { if (confirm(`Delete chat "${chats[modal.chatId].name}"?`)) { onDeleteChat(modal.chatId); setModal(null); } }}
        onClose=${() => setModal(null)} /><//>`}
    ${ctxMenu && html`
      <${ContextMenu} x=${ctxMenu.x} y=${ctxMenu.y} onClose=${() => setCtxMenu(null)}
        items=${[
          { label: 'Inspector', fn: () => chatAction(ctxMenu.chatId, 'inspector') },
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
  openaiChatStream, alignTokensToSpans, tokenize, getTokenCount, embed, embedCached, cosine, SEMANTIC_THRESHOLD,
  effectiveEndpoint, html };