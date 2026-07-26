
import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { html } from 'htm/react';
import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

// ============================================================================
// MARKDOWN OUTPUT SANITIZING — marked v5+ ships no sanitizer, and every
// message bubble renders marked output via dangerouslySetInnerHTML while
// apiKey/serverToken sit in localStorage. Raw HTML from model output (or
// imported scenario greetings / character cards / chat exports) is escaped
// to text, EXCEPT the two exact spans wrapDialogue (20-prose.js) injects
// itself before parsing — those must survive or dialogue coloring breaks.
// Link/image hrefs with script-capable schemes are neutralized.
// ============================================================================
const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const DIALOGUE_SPANS = new Set(['<span class="dialogue">', '</span>']);
// Browsers ignore ASCII whitespace/control chars inside a scheme
// ("java\tscript:" still executes), so strip them before the test.
const dangerousHref = (href) => {
  let clean = '';
  for (const ch of String(href ?? '')) {
    const cp = ch.codePointAt(0);
    if (cp > 0x20 && cp !== 0x7f) clean += ch;
  }
  return /^(javascript|vbscript|data):/i.test(clean);
};
marked.use({
  walkTokens(token) {
    if (token.type === 'html' && !DIALOGUE_SPANS.has((token.raw ?? '').trim()))
      token.text = escapeHtml(token.text ?? token.raw); // renderers emit token.text
  },
  renderer: {
    link({ href, title, tokens, text }) {
      const inner = tokens?.length ? this.parser.parseInline(tokens) : escapeHtml(text);
      if (dangerousHref(href)) return inner; // keep the text, drop the link
      return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${inner}</a>`;
    },
    image({ href, title, text }) {
      if (dangerousHref(href)) return escapeHtml(text);
      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ''}>`;
    },
  },
});


// App version, shown in the sidebar foot. Placeholder — vendor.mjs substitutes
// the newest CHANGELOG.md version heading at assemble time ('dev' fallback).
const APP_VERSION = '4.5.0';
// ============================================================================
// THEMES — variable→value maps applied to documentElement (mikupad-style
// dynamic theming). Every theme sets the same keys; derived vars (--c-dim,
// --c-faint, --c-accent-dim, --c-border) are computed in static CSS from
// these, so adding a theme is just a new entry here.
// ============================================================================
const THEMES = {
  defaultTheme: {
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
const DEFAULT_ACCENT = 'pink';

function applyTheme(id, accentId = DEFAULT_ACCENT) {
  const theme = THEMES[id] ?? THEMES.defaultTheme;
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
  const m = /^\s*\*{0,2}\s*([\p{L}][\p{L}\p{M}\p{N}'. \-]{0,39}?)\s*\*{0,2}\s*:/u.exec(text)
        ?? /^\s*\*{1,2}\s*([\p{L}][\p{L}\p{M}\p{N}'. \-]{0,39}?)\s*\*{1,2}/u.exec(text);
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
  // Merged once here — the lore layer below reuses this same list.
  const lorePieces = mergedLorePieces(scenario, chat, characters);
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
    return n.role === 'assistant' ? dedupeSpeakerPrefixes(t, speakerNames) : t;
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
  const greetingTokens = greetingNode ? est(histText(greetingNode)) : 0;
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
    const cost = est(histText(historyNodes[i]));
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

// Weak models often repeat a speaker prefix INSIDE the same speaker's stretch
// ("Mia: … Mia: …" mid-paragraph, or several "Narrator:" parts in a row).
// Strip the redundant prefixes: a prefix is dropped only when it names the
// CURRENT speaker — a line-start repeat, or a mid-line " Mia: " occurrence in
// that speaker's stretch. A different character still splits (line start) or
// stays literal (mid-line). Applied before the display split AND in the
// prompt assembler, so the stored swipe keeps the raw text (logprobs stay
// aligned) but fed-back history shows the clean form — the model doesn't
// learn the repeat habit from its own output.
function dedupeSpeakerPrefixes(text, names) {
  const s = String(text ?? '');
  if (!s || !names?.length) return s;
  const byLower = new Map(names.map(n => [String(n).toLowerCase(), n]));
  const lineRe = /^\s*\*{0,2}\s*([\p{L}][\p{L}\p{M}\p{N}'. \-]{0,39}?)\s*\*{0,2}\s*:(?:[ \t]*\*{1,2}(?=\s|$))?\s*/u;
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
  const s = dedupeSpeakerPrefixes(text, names);
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
const SPEAKER_PROMPT = `When several named characters share the scene, you may reply for more than one of them in a single turn: start each character's part with their FULL registered name and a colon on its own line ("The Auctioneer: …" — shortenings like "Auctioneer:" are not recognized), in the order they speak or act, at most one part per character. One prefix starts the whole part — never repeat it for the same character; the following lines belong to that character until another name or "Narrator:" appears. Narration needs no prefix at the start of the reply; after a character's part, resume it with a single "Narrator:" on its own line — never several "Narrator:" parts in a row, and only for genuine scene-level narration that belongs to no character (unprefixed lines simply continue the current part). In a scene with only one character, write everything in that character's own voice, action and description included; do not use "Narrator:" at all. Use a prefix only for a character the app already knows — from the scenario lore or an earlier registration; a prefix for an unknown name is not recognized and is shown to the reader as plain text.`;

// Prose formatting conventions — single source of truth, woven into the
// platform prompt (src/83-settings.js) and both generator prompts below, so
// the RP reply format and generated greetings/lore can't drift apart.
const PROSE_FORMAT_RULES = 'Prose format: wrap spoken dialogue in double quotation marks ("like this") and actions or non-verbal beats in single asterisks (*like this*). When a specific character speaks or acts, begin that part with the character\'s FULL name exactly as registered, followed by a colon ("The Auctioneer:" — never a shortening like "Auctioneer:"; a partial name is not recognized and shows to the reader as plain text). One prefix starts the whole part — never repeat it for the same character; the following lines belong to that character until another name or "Narrator:" appears. The app labels the message with the prefix and hides it from the reader; resume scene-level narration with a single "Narrator:" line — never several "Narrator:" parts in a row. Narration without a speaker needs no prefix.';

// Default aux-task prompts (user-editable in Settings → Prompts). {{user}} is
// substituted with the persona name at call time; the suggestions prompt also
// takes {{count}} and {{words}}.
const DEFAULT_SUGGESTIONS_PROMPT = 'You suggest what the user\'s character ({{user}}) might say or do next in this roleplay. Reply with exactly {{count}} options as a numbered list, one per line, at most {{words}} words each, written in first person as {{user}}. In-character; do not narrate other characters\' actions; no commentary.';
const DEFAULT_MEMORY_PROMPT = 'You keep memory notes for an ongoing roleplay. Summarize the key recent events, revealed facts, and relationship changes as compact plain prose of at most {{chars}} characters. Past events only; no speculation; no lists; no formatting.';
const DEFAULT_LORE_EXTRACT_PROMPT = 'You maintain the lorebook of an ongoing roleplay. Extract up to {{max}} NEW lasting facts about the world, places, objects, or factions from the recent conversation — long-term reference material, not momentary events, and never facts already in the existing lore. Reply with a JSON array only: [{"title":"…","content":"…","keys":["…"]}] — or [] if nothing qualifies.';
const DEFAULT_IMPROVE_PROMPT = 'Rewrite the user\'s draft in first person as {{user}}, matching the roleplay\'s tone. Output only the rewritten text.';
const DEFAULT_RECAP_PROMPT = 'Summarize the following roleplay excerpt into a cohesive recap in third person, past tense, at most {{words}} words. Output only the recap.';
// Generator prompts (✦ Generate in the scenario/character editors) take no
// runtime placeholders — {{user}} stays literal so the generated text keeps
// the macro. The reply contract is one JSON object; parsing is tolerant
// (first { to last } — see extractGenJSON in src/97-generator.js).
const DEFAULT_SCENARIO_GEN_PROMPT = 'You design roleplay scenarios for a chat app. Given the user\'s request (and an optional current draft to extend), reply with a single JSON object only, no commentary: {"name":"…","description":"…","tags":["…"],"scenarioInstructions":"…","backstory":"…","greeting":"…","lorePieces":[{"type":"lore|character","title":"…","content":"…","keys":["…"],"pinned":false}]}. name, description and tags are metadata never sent to the AI — description is a one-line teaser. scenarioInstructions steer the AI\'s style and behavior; backstory is the world setup the AI always sees. The greeting is the first assistant message of every new chat — write it in scene as narrative prose in the app\'s format. Each lore piece covers ONE entity (a character, location, faction or item): content is compact reference prose, keys are trigger words that inject the piece when mentioned — every character piece needs its name as a key. Every character who speaks or acts in the greeting needs a character lore piece — the app attributes Name: speech only to characters in the lore. At most 5 character pieces. {{user}} in any field is a literal macro for the user\'s character — keep it as-is. Omit lorePieces if none are needed; always return the complete object. ' + PROSE_FORMAT_RULES;
const DEFAULT_CHARACTER_GEN_PROMPT = 'You design character cards for a roleplay chat app. Given the user\'s request (and an optional current draft to extend), reply with a single JSON object only, no commentary: {"name":"…","content":"…","keys":["…"],"greeting":"…","color":"#rrggbb"}. content is the card sent to the AI when the character is active — compact reference prose covering appearance, personality and motives. keys are trigger words that activate the card when mentioned; include the character\'s name. The greeting is the first assistant message of a chat with this character — write it in scene from that character, in the app\'s prose format. color is optional: a hex colour suiting the character, used for their name in the chat UI — omit it when nothing fits. {{user}} in any field is a literal macro for the user\'s character — keep it as-is. ' + PROSE_FORMAT_RULES;
const DEFAULT_PIECE_GEN_PROMPT = 'You write lorebook entries for a roleplay chat app. Given the user\'s request (and an optional current draft to extend), reply with a single JSON object only, no commentary: {"type":"lore|character","title":"…","content":"…","keys":["…"],"pinned":false}. One entry covers ONE entity (a character, location, faction or item). content is compact reference prose sent to the AI when the entry activates — for characters cover appearance, personality and motives. keys are trigger words that inject the entry when mentioned — every character entry needs its name as a key. pinned entries are always injected; use sparingly. {{user}} in any field is a literal macro for the user\'s character — keep it as-is.';
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
    let failed = false, fatal = null;
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
        // A full disk never heals on a timer — surface it as a persistent
        // failure instead of retrying (the next set()/flush retries anyway).
        if (e?.name === 'QuotaExceededError')
          fatal = 'Browser storage is full (quota exceeded) — changes are NOT being saved. Free up storage or export and prune data, then make any edit to retry.';
        failed = true;
      }
    }
    if (fatal) {
      this._retries = 0;
      this.#savestate({ retrying: false, failed: fatal });
      return;
    }
    if (failed) {
      // Bounded exponential backoff (5s → 10 → 20 → 40 → 60s), then give up
      // and flag the failure rather than retrying a permanent error forever.
      // A later set(), flush(), or 'online' event starts the cycle over.
      this._retries = (this._retries ?? 0) + 1;
      if (this._retries > 5) {
        this._retries = 0;
        this.#savestate({ retrying: false, failed: 'Saving keeps failing — recent changes may not persist. Check the server/connection, then make any edit to retry.' });
        return;
      }
      this.#savestate({ retrying: true, failed: null });
      this.retryTimer = setTimeout(() => this.flush(), Math.min(60000, 5000 * 2 ** (this._retries - 1)));
      return;
    }
    this._retries = 0;
    this.#savestate({ retrying: false, failed: null });
  }
  // Detail is { retrying, failed } — retrying = writes queued for another
  // attempt; failed = a message when saving gave up (null while healthy).
  #savestate(detail) {
    const prev = this._savestate ?? {};
    if (!!prev.retrying === !!detail.retrying && (prev.failed ?? null) === detail.failed) return;
    this._savestate = detail;
    this.dispatchEvent(new CustomEvent('savestate', { detail }));
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
// once without it so the browser's cached Basic creds take over. Only OUR
// server's own 401s (tagged X-FictionPad-Auth) trigger the bare retry: an
// upstream LLM 401 passed through the proxy is a real credential failure
// whose error body must surface to the caller, not be retried bare.
// Direct (non-proxy) endpoints never retry: their Authorization is the LLM key.
async function fetchAPI(endpoint, url, opts = {}) {
  let res = await fetch(url, opts);
  if (res.status === 401 && isServerProxy(endpoint) && opts.headers?.Authorization
      && res.headers.get('X-FictionPad-Auth')) {
    const headers = { ...opts.headers };
    delete headers.Authorization;
    res = await fetch(url, { ...opts, headers });
  }
  return res;
}

// Returns { ids, ctxs }: sorted model ids, plus per-model context lengths
// from vendor extensions to the OpenAI model card — vLLM `max_model_len`,
// llama.cpp `n_ctx`, OpenRouter `context_length` (absent elsewhere → {}).
async function listModels({ endpoint, apiKey, serverToken, signal } = {}) {
  const res = await fetchAPI(endpoint, modelsURL(endpoint), { headers: { ...authHeaders(apiKey, endpoint, serverToken) }, signal });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const json = await res.json(); msg = json?.error?.message ?? json?.message ?? msg; } catch {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const ids = [], ctxs = {};
  for (const m of json.data ?? []) {
    if (!m?.id) continue;
    ids.push(m.id);
    const ctx = Number(m.max_model_len ?? m.n_ctx ?? m.context_length);
    if (Number.isFinite(ctx) && ctx > 0) ctxs[m.id] = ctx;
  }
  return { ids: ids.sort(), ctxs };
}

// Human-readable API failure for banners and the settings test button — a
// bare "401" tells the user nothing; name the likely cause and where to fix it.
function describeApiError(e) {
  const status = e?.status;
  const msg = String(e?.message ?? e);
  const detail = msg && !/^HTTP \d+$/.test(msg) ? ` — ${msg}` : '';
  if (status === 401) return `401 Unauthorized${detail}. The API key is missing or was rejected — check Settings → Connection.`;
  if (status === 403) return `403 Forbidden${detail}. The key lacks access, or the server refused the request.`;
  if (status === 404) return `404 Not Found${detail}. The endpoint URL looks wrong — expected an OpenAI-compatible server (…/v1).`;
  if (status === 429) return `429 Too Many Requests${detail}. Rate-limited by the backend — wait a moment and retry.`;
  if (status != null) return `HTTP ${status}${detail}`;
  if (/failed to fetch|networkerror|load failed/i.test(msg))
    return 'Could not reach the endpoint — is it running, and is the URL right? (A cross-origin server may need "Route API requests through this server".)';
  return msg;
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
//   { think }    — reasoning text (delta.reasoning_content / delta.reasoning,
//                  vLLM/DeepSeek/OpenRouter convention); displayed, never prompted
// Consumers display/accumulate content and collect the lp tape separately;
// alignment against the text happens ONCE, globally, via alignTokensToSpans.
async function* openaiChatStream({ endpoint, apiKey, serverToken, model, messages, samplers = {}, maxTokens, signal, tokenProbs = false, topLogprobs = 10, logitBias = null, stop = null }) {
  const stopSet = Array.isArray(stop) && stop.length ? new Set(stop) : null;
  const res = await fetchAPI(endpoint, chatCompletionsURL(endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint, serverToken) },
    body: JSON.stringify({
      // expandSamplerParams: dotted custom-sampler keys (e.g.
      // chat_template_kwargs.enable_thinking) become nested objects.
      model, messages, stream: true, max_tokens: maxTokens, ...expandSamplerParams(samplers),
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
    const err = new Error(msg);
    err.status = res.status; // lets callers special-case e.g. a 400 about stop strings
    throw err;
  }
  for await (const json of parseEventStream(res.body)) {
    const choice = json.choices?.[0];
    // Chunks with no choices (e.g. a trailing usage-only chunk with
    // choices: []) carry nothing to yield — skip them.
    if (!choice) continue;
    // delta.content is the text authority — logprobs never alter it.
    const deltaText = choice?.delta?.content ?? choice?.message?.content;
    // Reasoning channel (vLLM/DeepSeek/OpenRouter): own field, never part of
    // content. Yielded separately so the caller can show it collapsibly.
    const thinkText = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning
      ?? choice?.message?.reasoning_content;
    if (thinkText) yield { think: thinkText };
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
//   tape-longer — reasoning-model backends may logprob the RAW output:
//            the tape then carries think/marker tokens the content never
//            shows. Text is an in-order subsequence of such a tape, so
//            unmatched tape entries are DROPPED (never misattributed).
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
  // Tape longer than the text (think tokens mixed in): fast case first — if
  // the text is a suffix of the tape on a token boundary, drop the leading
  // junk wholesale (reasoning always streams before content).
  if (joined.endsWith(text)) {
    const dropLen = joined.length - text.length;
    let accLen = 0, k = 0;
    while (k < toks.length && accLen < dropLen) accLen += toks[k++].token.length;
    if (accLen === dropLen) return toks.slice(k).map(span);
  }
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
  // Drop-tolerant fallback for interleaved junk the greedy pass can't resync
  // around: discard tape entries that don't match at the cursor (first match
  // wins — content is an in-order subsequence of the tape). Used only when it
  // covers strictly more of the text with real probs than the greedy pass.
  const coverage = (sp) => sp.reduce((n, s) => n + (s.logprob != null ? s.text.length : 0), 0);
  const baseCov = coverage(spans);
  if (baseCov >= text.length) return spans;
  const alt = [];
  {
    let aPos = 0, aI = 0, aGap = '';
    const aFlush = () => { if (aGap) { alt.push(plain(aGap)); aGap = ''; } };
    while (aPos < text.length) {
      let j = aI;
      while (j < toks.length && !text.startsWith(toks[j].token, aPos)) j++;
      if (j >= toks.length) { aGap += text.slice(aPos); break; }
      aFlush();
      alt.push(span(toks[j]));
      aPos += toks[j].token.length;
      aI = j + 1;
    }
    aFlush();
  }
  return coverage(alt) > baseCov ? alt : spans;
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
// count-only {count}, or OpenAI-ish {data:{tokens}}. Cached per endpoint+model+text
// (keyed by textHash — full prompt text must never sit in the cache key).
// Aborts (generation Stop) return null WITHOUT caching — a canceled count
// isn't a "tokenize unavailable" verdict.
const tokenizeCache = new Map();
async function tokenize({ endpoint, apiKey, serverToken, model, prompt, signal }) {
  const key = `${endpoint}|${model}|${textHash(prompt)}`;
  if (tokenizeCache.has(key)) return tokenizeCache.get(key);
  if (tokenizeCache.size > 500) tokenizeCache.clear();
  let out = null;
  try {
    const res = await fetchAPI(endpoint, `${normalizeEndpoint(endpoint)}/tokenize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint, serverToken) },
      body: JSON.stringify({ model, prompt }),
      signal,
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
  } catch (e) {
    if (e?.name === 'AbortError') return null;
  }
  tokenizeCache.set(key, out);
  return out;
}

async function getTokenCount({ endpoint, apiKey, serverToken, model, text, signal }) {
  const r = await tokenize({ endpoint, apiKey, serverToken, model, prompt: text, signal });
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

async function embed({ endpoint, apiKey, serverToken, model, inputs, signal }) {
  const res = await fetchAPI(endpoint, `${normalizeEndpoint(endpoint)}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint, serverToken) },
    body: JSON.stringify({ model, input: inputs }),
    signal,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const json = await res.json();
      msg = json?.error?.message ?? json?.message ?? msg;
    } catch {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  if (!Array.isArray(json?.data)) throw new Error('Malformed embeddings response');
  return [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(d => d.embedding);
}

// Cached single-text embedding (piece match texts change rarely).
async function embedCached({ endpoint, apiKey, serverToken, model, text, signal }) {
  const key = `${model}|${textHash(text)}`;
  if (embedCache.has(key)) return embedCache.get(key);
  if (embedCache.size > 500) embedCache.clear();
  const [vec] = await embed({ endpoint, apiKey, serverToken, model, inputs: [text], signal });
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
// suggestions, /improve, ✦ generator). Returns trimmed text; throws on
// HTTP/API errors. `samplers` (optional) is merged into the request like the
// streaming path does — dotted custom-sampler keys nest (expandSamplerParams).
// `signal` (optional) aborts the call — the composer's Stop aborts all
// in-flight aux calls.
async function auxCall({ endpoint, apiKey, serverToken, model, system, user, maxTokens = 300, temperature = 0.7, stop = null, samplers = null, signal = null }) {
  const res = await fetchAPI(endpoint, chatCompletionsURL(endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey, endpoint, serverToken) },
    ...(signal ? { signal } : {}),
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
      ...(samplers ? expandSamplerParams(samplers) : {}),
    }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const json = await res.json();
      msg = json?.error?.message ?? json?.message ?? msg;
    } catch {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
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
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(name, JSON.stringify(value)); } catch (e) { console.error(e); }
  }, [name, value]);
  const update = useCallback((next) => {
    setValue(prev => (typeof next === 'function' ? next(prev) : next));
  }, []);
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
    // Dismissing the dialog without picking fires oncancel (Chrome/FF 91+);
    // without this the promise never settles and imports silently hang.
    input.oncancel = () => resolve(null);
    input.click();
  });
}

// Sampler knob registry — the sampling params the app can send on chat
// completions (OpenAI-compatible + common vLLM/llama.cpp extensions). A param
// is sent only while present in settings.samplers (global) or
// chat.settings.samplers (per-chat override); `def` seeds a freshly-enabled
// knob. Settings → Generation toggles the global set; settings.samplerFields
// picks which knobs appear as per-chat overrides in the panel's Samplers tab.
// Users can register additional knobs (settings.customSamplers) for backend-
// specific params — a dotted key like `chat_template_kwargs.enable_thinking`
// expands into a nested request object (expandSamplerParams).
const SAMPLER_FIELDS = [
  { key: 'temperature',        label: 'Temperature',        type: 'number', min: 0,  max: 2,          step: 0.01, def: 0.8  },
  { key: 'top_p',              label: 'top_p',              type: 'number', min: 0,  max: 1,          step: 0.01, def: 0.95 },
  { key: 'top_k',              label: 'top_k',              type: 'number', min: -1, max: 500,        step: 1,    def: 40   },
  { key: 'min_p',              label: 'min_p',              type: 'number', min: 0,  max: 1,          step: 0.01, def: 0.05 },
  { key: 'repetition_penalty', label: 'Repetition penalty', type: 'number', min: 0,  max: 2,          step: 0.01, def: 1.1  },
  { key: 'presence_penalty',   label: 'presence_penalty',   type: 'number', min: -2, max: 2,          step: 0.01, def: 0    },
  { key: 'frequency_penalty',  label: 'frequency_penalty',  type: 'number', min: -2, max: 2,          step: 0.01, def: 0    },
  { key: 'seed',               label: 'seed (−1 = random)', type: 'number', min: -1, max: 2147483647, step: 1,    def: -1   },
];
const SAMPLER_FIELD_MAP = Object.fromEntries(SAMPLER_FIELDS.map(f => [f.key, f]));

// User-registered samplers (Settings → Generation), sanitized to field shape.
// Built-in keys are reserved — a custom def can never shadow them.
//   number  — behaves like a built-in (send-checkbox + numeric input)
//   boolean — send-checkbox + true/false select; while enabled the chosen
//             bool IS sent (e.g. chat_template_kwargs.enable_thinking: false)
const customSamplerFields = (st) => (st?.customSamplers ?? [])
  .filter(d => d?.key?.trim() && !SAMPLER_FIELD_MAP[d.key.trim()])
  .map(d => ({
    key: d.key.trim(),
    label: d.name?.trim() || d.key.trim(),
    type: d.type === 'boolean' ? 'boolean' : 'number',
    min: Number.isFinite(d.min) ? d.min : 0,
    max: Number.isFinite(d.max) ? d.max : 1,
    step: Number.isFinite(d.step) && d.step > 0 ? d.step : 0.01,
    def: d.type === 'boolean' ? d.def !== false : (Number.isFinite(d.def) ? d.def : 0),
    custom: true,
  }));
const allSamplerFields = (st) => [...SAMPLER_FIELDS, ...customSamplerFields(st)];

// Samplers minus the user-disabled keys — the set actually sent. Values stay
// in settings.samplers while disabled, so re-enabling restores the tuned
// number instead of resetting it.
const enabledSamplers = (st) => Object.fromEntries(
  Object.entries(st?.samplers ?? {}).filter(([k]) => !(st?.disabledSamplers ?? []).includes(k)));

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
  const dlgRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose; // Escape always calls the latest handler (dirty guards close over live state)
  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    // Initial focus: first field in the body, else the dialog container.
    const target = dlg.querySelector('.m-body input, .m-body textarea, .m-body select, .m-body button') ?? dlg;
    target.focus?.();
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Only the topmost overlay reacts — one Escape must not close a stacked
      // modal AND the dialog beneath it (e.g. the ✦ generator over an editor).
      const overlays = document.querySelectorAll('.modal-overlay');
      if (overlays.length && overlays[overlays.length - 1] !== dlg.closest('.modal-overlay')) return;
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return html`
    <div class="modal-overlay" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal ${wide ? 'wide' : ''} ${cls ?? ''}" role="dialog" aria-modal="true" aria-label=${title}
        tabindex="-1" ref=${dlgRef}>
        <div class="m-head">
          <h2>${title}</h2>
          <button class="btn ghost" onClick=${onClose} aria-label="Close">✕</button>
        </div>
        <div class="m-body">${children}</div>
        ${footer && html`<div class="m-foot">${footer}</div>`}
      </div>
    </div>`;
}

// Scrollable box with the native scrollbar hidden and extent cues instead: a
// thin accent rail tracking scroll position plus a bottom fade while more
// content remains below (see .rail-* in styles.css). Shared by the thinking
// box and the lore links lists so they all scroll the same way. The scroll
// handler writes CSS vars only — no re-render per scroll event.
function RailScroll({ className, children }) {
  const wrapRef = useRef(null);
  const sync = () => {
    const wrap = wrapRef.current;
    const el = wrap?.firstElementChild;
    if (!el) return;
    const scrollable = el.scrollHeight > el.clientHeight + 2;
    wrap.dataset.scrollable = scrollable ? '1' : '';
    wrap.dataset.atBottom = (!scrollable || el.scrollTop + el.clientHeight >= el.scrollHeight - 2) ? '1' : '';
    if (scrollable) {
      wrap.style.setProperty('--th-frac', el.clientHeight / el.scrollHeight);
      wrap.style.setProperty('--th-off', el.scrollTop / el.scrollHeight);
    }
  };
  useEffect(sync); // every render — cheap DOM reads, covers content/resize changes
  return html`<div class="rail-wrap" ref=${wrapRef}>
    <div class=${`rail-body ${className ?? ''}`} onScroll=${sync}>${children}</div>
    <div class="rail"><div class="rail-thumb" /></div>
  </div>`;
}

// Number input that allows free typing and commits a clamped value on
// blur/Enter — clamping on every keystroke fights mid-edit input (typing "3"
// into a min-5 field would snap to 5 before the "0" for "30" arrives).
// While focused, the text is authoritative; unfocused, it follows the prop.
function NumInput({ value, min, max, step, fallback, placeholder, onCommit }) {
  const [text, setText] = useState(String(value ?? ''));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(String(value ?? '')); }, [value, focused]);
  const commit = () => {
    const raw = text.trim();
    let n = raw === '' ? NaN : Number(raw);
    // fallback: null = the field is nullable and blank/invalid commits null;
    // undefined = keep the last good value.
    if (!Number.isFinite(n)) n = fallback === null ? null : (fallback ?? value ?? 0);
    if (n != null) {
      if (min != null) n = Math.max(min, n);
      if (max != null) n = Math.min(max, n);
    }
    if (n !== value) onCommit(n);
    setText(String(n ?? ''));
  };
  return html`<input type="number" min=${min} max=${max} step=${step} placeholder=${placeholder} value=${text}
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
  };
}

// Quick-add skeletons: name + one-line hook + focused fields, filled in by hand.
// Keys stay empty — note that unlike global character cards (resolveCharacters
// defaults empty keys to the card name), lore pieces have no title-as-key
// fallback in scanLore, so a character piece needs a key or pinned to fire.
const LORE_TEMPLATES = [
  { label: 'character', type: 'character',
    content: 'Name — one-line hook.\nAppearance: \nPersonality: \nMotive: ' },
  { label: 'location', type: 'lore',
    content: 'Location — one-line hook.\nDetails: ' },
  { label: 'faction', type: 'lore',
    content: 'Faction — one-line hook.\nGoal: \nMembers: ' },
  { label: 'item', type: 'lore',
    content: 'Item — one-line hook.\nProperties: ' },
];
const newLoreFromTemplate = (t) => ({ ...newLorePiece(), type: t.type, content: t.content });

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

// The editable fields of a lore piece — shared by the inline card (scenario
// editor) and the piece editor popout (chat options), so the two stay
// identical. `set` applies a partial patch to the caller's piece/draft.
function LorePieceFields({ piece, others, set }) {
  return html`
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
    <label class="check" title="The embedding model (Settings → Models) compares this piece against the recent conversation each generation and injects it on similarity, even without a keyword hit">
      <input type="checkbox" checked=${!!piece.smart} onChange=${(e) => set({ smart: e.target.checked })} />
      Semantic activation — uses the embedding model (aux); no keyword needed
    </label>
    <div class="grid3">
      <label class="field"><span>Weight</span>
        <${NumInput} value=${piece.weight ?? 0} step=${1} fallback=${0}
          onCommit=${(n) => set({ weight: n })} /></label>
      <label class="field"><span>Search depth (est. tokens; blank = global default)</span>
        <${NumInput} value=${piece.searchDepth} min=${0} step=${128} fallback=${null} placeholder="2048"
          onCommit=${(n) => set({ searchDepth: n })} /></label>
      <div class="field"><span>Flags</span>
        <label class="check"><input type="checkbox" checked=${!!piece.pinned} onChange=${(e) => set({ pinned: e.target.checked })} /> pinned</label>
        <label class="check"><input type="checkbox" checked=${piece.enabled !== false} onChange=${(e) => set({ enabled: e.target.checked })} /> enabled</label>
      </div>
    </div>
    ${others.length > 0 && html`
      <label class="field"><span>Links — these pieces get a weight boost when this piece is active</span>
        <${RailScroll} className="links-list">
          ${others.map(o => html`
            <label class="check" key=${o.id}>
              <input type="checkbox" checked=${(piece.links ?? []).includes(o.id)}
                onChange=${(e) => set({ links: e.target.checked
                  ? [...(piece.links ?? []), o.id]
                  : (piece.links ?? []).filter(id => id !== o.id) })} />
              ${o.title || '(untitled)'}
            </label>`)}
        <//></label>`}`;
}

function LorePieceCard({ piece, allPieces, onChange, onRemove, onGenerate }) {
  const [open, setOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState(null);
  const set = (patch) => onChange({ ...piece, ...patch });
  const runGenerate = async (promptText) => {
    setGenBusy(true); setGenError(null);
    try {
      // The patch carries content fields only — id and provenance survive.
      set(await onGenerate('piece', promptText, piece));
      setGenOpen(false);
    } catch (e) { setGenError(e?.message ?? String(e)); }
    finally { setGenBusy(false); }
  };
  const others = allPieces.filter(p => p.id !== piece.id);
  return html`
    <div class="lore-card">
      <div class="lc-head" onClick=${() => setOpen(!open)}>
        <span>${open ? '▾' : '▸'}</span>
        <span class="t">${piece.title || '(untitled)'}</span>
        ${piece.type === 'character' && html`<span class="pill">character</span>`}
        ${piece.pinned && html`<span class="pill pinned">pinned</span>`}
        ${piece.enabled === false && html`<span class="pill">disabled</span>`}
        ${onGenerate && html`<button class="btn small" title="Generate / flesh out this piece with the AI"
          onClick=${(e) => { e.stopPropagation(); setGenError(null); setGenOpen(true); }}>✦</button>`}
        <button class="btn small danger" onClick=${(e) => { e.stopPropagation(); onRemove(); }}>✕</button>
      </div>
      ${genOpen && html`
        <${GeneratorModal} title=${`Generate — ${piece.title || 'lore piece'}`} busy=${genBusy} error=${genError}
          onGenerate=${runGenerate} onClose=${() => setGenOpen(false)} />`}
      ${open && html`
        <div class="lc-body"><${LorePieceFields} piece=${piece} others=${others} set=${set} /></div>`}
    </div>`;
}

// Lore piece editor popout (chat options) — the same pattern as the
// scenario/character editors: a wide modal with every field visible (links
// included), ✦ Generate + Save in the footer, local draft, dirty guard. The
// piece is never a blind ✦ prompt — you see what it is before you edit or
// generate. The generator's patch fills the local draft only; persistence
// stays with Save, and id/provenance (createdBy/atLen) survive untouched.
function LorePieceEditor({ piece, isNew, allPieces, onSave, onClose, onGenerate }) {
  const [draft, setDraft] = useState(() => deepClone(piece));
  const [dirty, setDirty] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState(null);
  const set = (patch) => { setDirty(true); setDraft(d => ({ ...d, ...patch })); };
  const guardClose = () => { if (!dirty || confirm('Discard unsaved changes?')) onClose(); };
  const runGenerate = async (promptText) => {
    setGenBusy(true); setGenError(null);
    try {
      set(await onGenerate('piece', promptText, draft));
      setGenOpen(false);
    } catch (e) { setGenError(e?.message ?? String(e)); }
    finally { setGenBusy(false); }
  };
  const others = allPieces.filter(p => p.id !== draft.id);
  return html`
    <${Modal} title=${isNew ? 'New lore piece' : `Lore — ${piece.title || '(untitled)'}`} wide
      onClose=${genOpen ? () => setGenOpen(false) : guardClose}
      footer=${html`${onGenerate && html`<button class="btn" onClick=${() => { setGenError(null); setGenOpen(true); }}>✦ Generate</button>`}
        <button class="btn primary" disabled=${!draft.title.trim()} onClick=${() => onSave(draft)}>Save</button>`}>
      <${LorePieceFields} piece=${draft} others=${others} set=${set} />
      ${genOpen && html`
        <${GeneratorModal} title=${`Generate — ${draft.title || 'lore piece'}`} busy=${genBusy} error=${genError}
          onGenerate=${runGenerate} onClose=${() => setGenOpen(false)} />`}
    <//>`;
}

function newScenario() {
  return {
    id: uid(), name: '', description: '', tags: [],
    backstory: '', greeting: '', scenarioInstructions: '', lorePieces: [],
    emergentLore: 'queue', // off | queue (review) | auto — model/extractor-proposed lore routing
    createdAt: Date.now(),
  };
}

function ScenarioEditor({ scenario, characters = {}, onSave, onClose, onGenerate }) {
  const [draft, setDraft] = useState(() => deepClone(scenario));
  const [dirty, setDirty] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState(null);
  const set = (patch) => { setDirty(true); setDraft(d => ({ ...d, ...patch })); };
  const guardClose = () => { if (!dirty || confirm('Discard unsaved changes?')) onClose(); };
  const runGenerate = async (promptText) => {
    setGenBusy(true); setGenError(null);
    try {
      set(await onGenerate('scenario', promptText, draft));
      setGenOpen(false);
    } catch (e) { setGenError(e?.message ?? String(e)); }
    finally { setGenBusy(false); }
  };
  const setPiece = (id, next) =>
    set({ lorePieces: draft.lorePieces.map(p => p.id === id ? next : p) });
  const charList = Object.values(characters).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  const linkedIds = Array.isArray(draft.characterIds) ? draft.characterIds : [];
  const toggleChar = (id, on) =>
    set({ characterIds: on ? [...linkedIds, id] : linkedIds.filter(x => x !== id) });
  return html`
    <${Modal} title="Scenario editor" wide onClose=${genOpen ? () => setGenOpen(false) : guardClose}
      footer=${html`${onGenerate && html`<button class="btn" onClick=${() => { setGenError(null); setGenOpen(true); }}>✦ Generate</button>`}
        <button class="btn primary" disabled=${!draft.name.trim()} onClick=${() => onSave(draft)}>Save scenario</button>`}>
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
      <label class="field"><span>Greeting — first assistant message of every new chat. Prefix lines with a character's name (Mia:) to show them as that character's bubble; Narrator: resumes narration.</span>
        <textarea rows=${4} value=${draft.greeting} onInput=${(e) => set({ greeting: e.target.value })} /></label>
      <label class="field"><span>Emergent lore — where model-proposed lore (add_lore calls + periodic extraction) goes</span>
        <select value=${draft.emergentLore ?? 'queue'} onChange=${(e) => set({ emergentLore: e.target.value })}>
          <option value="off">off — no proposals, no extraction</option>
          <option value="queue">suggest for review (default) — proposals wait in chat settings</option>
          <option value="auto">auto-add — proposals go straight into chat lore</option>
        </select></label>
      <div class="field">
        <span>Linked characters (${linkedIds.length})</span>
        <div class="hint">Global character cards join this scenario's lore pipeline (activation, budgets, /pov, speaker colours). Card content edits apply live to all linked scenarios and chats — but the opening greeting is snapshotted per chat at creation, so greeting edits only affect new chats. For scenario-only characters, use a character-type lore piece below.</div>
        ${charList.length === 0 && html`<div class="hint">No global characters yet — create them from the sidebar's Characters section.</div>`}
        ${charList.length > 0 && html`
          <${RailScroll} className="links-list">
            ${charList.map(c => html`
              <label class="check" key=${c.id}>
                <input type="checkbox" checked=${linkedIds.includes(c.id)}
                  onChange=${(e) => toggleChar(c.id, e.target.checked)} />
                ${c.name}
              </label>`)}
          <//>`}
      </div>
      <div class="field">
        <span>Lore pieces (${draft.lorePieces.length})
          <button class="btn small" style=${{ marginLeft: '8px' }}
            onClick=${() => set({ lorePieces: [...draft.lorePieces, newLorePiece()] })}>+ add piece</button>
          ${LORE_TEMPLATES.map(t => html`
            <button class="btn small" key=${t.label} style=${{ marginLeft: '4px' }}
              title=${`New ${t.label} piece, prefilled with a skeleton`}
              onClick=${() => set({ lorePieces: [...draft.lorePieces, newLoreFromTemplate(t)] })}>+ ${t.label}</button>`)}
        </span>
        ${draft.lorePieces.map(p => html`
          <${LorePieceCard} key=${p.id} piece=${p} allPieces=${draft.lorePieces}
            onChange=${(next) => setPiece(p.id, next)}
            onRemove=${() => set({ lorePieces: draft.lorePieces.filter(q => q.id !== p.id) })}
            onGenerate=${onGenerate} />`)}
      </div>
      ${genOpen && html`
        <${GeneratorModal} title="Generate scenario" busy=${genBusy} error=${genError}
          onGenerate=${runGenerate} onClose=${() => setGenOpen(false)} />`}
    <//>`;
}

// ============================================================================
// COMPONENTS: PERSONA MANAGER
// ============================================================================
function PersonaManager({ personas, onUpsert, onRemove, onClose, defaultPersonaId, onSetDefault }) {
  const [editing, setEditing] = useState(null); // draft persona or null
  const [dirty, setDirty] = useState(false);
  const list = Object.values(personas).sort((a, b) => a.name.localeCompare(b.name));
  const startEdit = (p) => { setEditing(p); setDirty(false); };
  const edit = (next) => { setDirty(true); setEditing(next); };
  const cancelEdit = () => { if (!dirty || confirm('Discard unsaved changes?')) setEditing(null); };
  const guardClose = () => {
    if (editing && dirty && !confirm('Discard unsaved changes?')) return;
    onClose();
  };
  return html`
    <${Modal} title="Personas" onClose=${guardClose}>
      ${editing ? html`
        <label class="field"><span>Name — replaces {{user}} everywhere</span>
          <input type="text" value=${editing.name} onInput=${(e) => edit({ ...editing, name: e.target.value })} /></label>
        <label class="field"><span>Description — sent to the AI as "{{user}} is …"</span>
          <textarea rows=${5} value=${editing.description} onInput=${(e) => edit({ ...editing, description: e.target.value })} /></label>
        <div style=${{ display: 'flex', gap: '8px' }}>
          <button class="btn primary" disabled=${!editing.name.trim()}
            onClick=${() => { onUpsert(editing.id, editing); setEditing(null); }}>Save</button>
          <button class="btn" onClick=${cancelEdit}>Cancel</button>
        </div>` : html`
        <button class="btn" onClick=${() => startEdit({ id: uid(), name: '', description: '' })}>+ New persona</button>
        <div style=${{ marginTop: '10px' }}>
          ${list.length === 0 && html`<div class="hint">No personas yet. A persona feeds the {{user}} macro.</div>`}
          ${list.map(p => html`
            <div class="side-item" key=${p.id}>
              <span class="name">${p.name}${defaultPersonaId === p.id && html` <span class="pill">default</span>`}</span>
              <span class="tools" style=${{ display: 'flex' }}>
                <button class="btn small ${defaultPersonaId === p.id ? 'primary' : ''}"
                  title=${defaultPersonaId === p.id ? 'Default for new chats — click to clear' : 'Make default for new chats'}
                  onClick=${() => onSetDefault(defaultPersonaId === p.id ? '' : p.id)}>★</button>
                <button class="btn small" onClick=${() => startEdit(deepClone(p))}>edit</button>
                <button class="btn small danger" onClick=${() => onRemove(p.id)}>✕</button>
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
  PROSE_FORMAT_RULES;

const DEFAULT_SETTINGS = {
  endpoint: 'http://localhost:8080',
  apiKey: '',
  model: '',
  auxModel: '',
  embeddingModel: '', // semantic lore activation; empty = disabled
  semanticThreshold: 0.55, // cosine similarity needed for a smart piece to inject
  dateFormat: 'dd/mm/yyyy', // date order for stamps and chat names
  defaultPersonaId: '', // persona preselected in New chat ('' = none; starred in the Personas menu)
  sidebarArrows: false, // desktop: «/» edge arrows instead of the brand/Inspector buttons as pane toggles (phones always use arrows)
  edgePeek: true, // desktop: hovering a thin strip at the screen edge pops a collapsed pane out temporarily
  contextLength: DEFAULT_CONTEXT_LENGTH,
  ctxAuto: true, // context length follows the detected model context (modelCtxs) until edited
  maxTokens: DEFAULT_MAX_TOKENS,
  reserveAuto: true, // response reserve derived from the context length until edited
  modelCtxs: {}, // { [modelId]: contextLength } detected on Fetch (vLLM/llama.cpp/OpenRouter vendor fields)
  responseLength: 'medium',
  // Editable length instruction appended to the prompt tail; '' = no directive.
  // Follows the preset's default text until the user edits it.
  lengthDirective: LENGTH_PRESETS.medium.directive,
  samplers: { temperature: 0.8, top_p: 0.95, top_k: 40, min_p: 0.05, repetition_penalty: 1.1 },
  // Disabled sampler keys — values stay in `samplers`, they're just not sent.
  disabledSamplers: [],
  // Which sampler knobs appear as per-chat overrides in the panel's Samplers tab.
  samplerFields: ['temperature', 'top_p', 'top_k', 'min_p', 'repetition_penalty'],
  // User-registered sampler params (backend-specific): [{ id, name, key, type: 'number'|'boolean', min, max, step, def }]
  customSamplers: [],
  platformPrompt: DEFAULT_PLATFORM_PROMPT,
  tokenProbs: true, // request logprobs + top_logprobs on generations
  showThinking: true, // show reasoning_content (thinking) in a collapsible box on replies
  topLogprobs: 10, // how many alternative tokens to request/store per position
  suggestions: false, // response-suggestion chips after generations (opt-in; they fire an aux call per swipe)
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
  recapWords: 400, // word target substituted into the recap prompt's {{words}}
  scenarioGenPrompt: DEFAULT_SCENARIO_GEN_PROMPT, // ✦ Generate in the scenario editor
  characterGenPrompt: DEFAULT_CHARACTER_GEN_PROMPT, // ✦ Generate in the character editor
  pieceGenPrompt: DEFAULT_PIECE_GEN_PROMPT, // ✦ Generate on a single lore piece
  genModel: '', // ✦ Generate model; blank = aux model (then chat model)
  genTemp: 0.9, // ✦ Generate temperature
  genMaxTokens: 3000, // ✦ Generate response cap (a full scenario JSON must fit)
  toolsEnabled: true, // prompt-based tool calling (register_character / add_lore → chat lore)
  toolsEnrich: false, // experimental: flesh out newly tool-registered characters via the ✦ generator
  toolsPrompt: TOOLS_PROMPT, // protocol instructions appended to the platform prompt; user-editable
  toolCallCap: TOOL_CALL_CAP, // tool calls executed per generation
  multiSpeaker: true, // model may reply for several characters per turn (split into per-speaker bubbles)
  speakerPrompt: SPEAKER_PROMPT, // multi-speaker instructions appended to the platform prompt; user-editable
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
  ['storage', 'Storage'],
  ['models', 'Models'],
  ['generation', 'Generation'],
  ['features', 'Features'],
  ['prompts', 'Prompts'],
];

// One custom-sampler definition card — collapsed by default (they stack
// fast); the header shows the effective label + type, click to expand and
// edit. Freshly added cards (no key yet) start open.
function CustomSamplerCard({ def: d, keyClash, onChange, onRemove }) {
  const [open, setOpen] = useState(!(d.key ?? '').trim());
  const setDef = (patch) => onChange({ ...d, ...patch });
  return html`
    <div class="lore-card">
      <div class="lc-head" onClick=${() => setOpen(!open)}>
        <span class="t">${d.name?.trim() || d.key?.trim() || '(new sampler)'}</span>
        <span class="pill">${d.type === 'boolean' ? 'bool' : 'num'}</span>
        <span>${open ? '▾' : '▸'}</span>
      </div>
      ${open && html`
        <div class="lc-body">
          <div class="grid2">
            <label class="field"><span>Label (blank = the key)</span>
              <input type="text" value=${d.name ?? ''} placeholder=${d.key || 'my_param'}
                onInput=${(e) => setDef({ name: e.target.value })} /></label>
            <label class="field"><span>Request key (dots nest)${keyClash ? ' — reserved built-in!' : ''}</span>
              <input type="text" value=${d.key ?? ''} placeholder="chat_template_kwargs.enable_thinking"
                onInput=${(e) => setDef({ key: e.target.value.replace(/\s+/g, '') })} /></label>
          </div>
          <div class="grid3">
            <label class="field"><span>Type</span>
              <select value=${d.type === 'boolean' ? 'boolean' : 'number'}
                onChange=${(e) => setDef({ type: e.target.value, def: e.target.value === 'boolean' ? true : 0 })}>
                <option value="number">number</option>
                <option value="boolean">boolean (true/false)</option>
              </select></label>
            ${d.type === 'boolean'
              ? html`<label class="field"><span>Default when enabled</span>
                  <select value=${String(d.def !== false)} onChange=${(e) => setDef({ def: e.target.value === 'true' })}>
                    <option value="true">true</option><option value="false">false</option>
                  </select></label>`
              : [['def', 'Default'], ['min', 'Min'], ['max', 'Max'], ['step', 'Step']].map(([k, lbl]) => html`
                  <label class="field" key=${k}><span>${lbl}</span>
                    <${NumInput} value=${d[k] ?? (k === 'step' ? 0.01 : 0)} step=${0.01} fallback=${k === 'step' ? 0.01 : 0}
                      onCommit=${(n) => setDef({ [k]: n })} /></label>`)}
          </div>
          <button class="btn small danger" onClick=${onRemove}>Remove sampler</button>
        </div>`}
    </div>`;
}

function SettingsModal({ settings, onSave, onClose, theme, onThemeChange, accent, onAccentChange, onOpenLogitBias,
                        storageKind, onUpload, onDownload, onExportAll, onImportAll, onServerBackup, initialDraft }) {
  const [draft, setDraft] = useState(() => {
    // initialDraft restores the in-progress draft after the logit-bias detour.
    if (initialDraft) return initialDraft;
    const d = deepClone(settings);
    // Pre-fill from the active preset so saving an untouched form keeps the
    // current directive instead of blanking it.
    d.lengthDirective ??= LENGTH_PRESETS[d.responseLength ?? 'medium']?.directive ?? '';
    return d;
  });
  const [tab, setTab] = useState('appearance');
  const [dirty, setDirty] = useState(false);
  const [models, setModels] = useState(null);
  const [modelsError, setModelsError] = useState(null);
  const [migBusy, setMigBusy] = useState(null);
  const [migNote, setMigNote] = useState(null);
  const set = (patch) => { setDirty(true); setDraft(d => ({ ...d, ...patch })); };
  const setSampler = (k, v) => { setDirty(true); setDraft(d => ({ ...d, samplers: { ...d.samplers, [k]: v } })); };
  // Disable ≠ delete: the value stays in `samplers`, the key joins
  // `disabledSamplers` (not sent). Re-enabling restores the tuned value.
  const toggleSampler = (f, on) => { setDirty(true); setDraft(d => {
    const disabledSamplers = (d.disabledSamplers ?? []).filter(k => k !== f.key);
    if (!on) disabledSamplers.push(f.key);
    const samplers = { ...(d.samplers ?? {}) };
    if (on && samplers[f.key] == null) samplers[f.key] = f.def; // never set before — seed the default
    return { ...d, samplers, disabledSamplers };
  }); };
  const setCap = (k, pct) => { setDirty(true); setDraft(d => ({
    ...d, layerCaps: { ...LAYER_CAPS, ...(d.layerCaps ?? {}), [k]: Math.max(0, Math.min(90, pct || 0)) / 100 },
  })); };
  const guardClose = () => { if (!dirty || confirm('Discard unsaved changes?')) onClose(); };
  const lbCount = Object.keys(draft.logitBias ?? {}).length;

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

  // Full backup (export everything / import backup) — handlers live in Main;
  // null return = picker cancelled. Imported settings already landed in live
  // state; mirror them into the draft so "Save settings" can't clobber them
  // (serverToken stays per-device — never part of the file).
  const [bakBusy, setBakBusy] = useState(null); // 'import' | 'db'
  const [bakNote, setBakNote] = useState(null);
  const importBackup = async () => {
    setBakBusy('import'); setBakNote(null);
    try {
      const out = await onImportAll();
      if (!out) return;
      if (out.settings) setDraft(d => ({ ...d, ...out.settings }));
      setBakNote(out.note);
    } catch (e) {
      setBakNote(`Import failed: ${e.message ?? e}`);
    } finally { setBakBusy(null); }
  };
  const serverBackup = async () => {
    setBakBusy('db'); setMigNote(null);
    try { await onServerBackup(); }
    catch (e) { setMigNote(`Server backup failed: ${e.message ?? e}`); }
    finally { setBakBusy(null); }
  };

  const fetchModels = async () => {
    setModelsError(null);
    try {
      const { ids, ctxs } = await listModels({ endpoint: effectiveEndpoint(draft, storageKind === 'server'), apiKey: draft.apiKey, serverToken: draft.serverToken });
      setModels(ids);
      // Remember detected context lengths per model — resolveLimits uses them
      // for the auto context/reserve knobs (Generation tab).
      if (Object.keys(ctxs).length) set({ modelCtxs: { ...(draft.modelCtxs ?? {}), ...ctxs } });
    }
    catch (e) { setModels(null); setModelsError(describeApiError(e)); }
  };

  // Manual config check (Connection tab): hits /models with the draft
  // endpoint + key and reports reachability, auth, and whether the configured
  // chat model is actually exposed.
  const [testState, setTestState] = useState(null); // null | 'busy' | { ok, msg }
  const testConnection = async () => {
    setTestState('busy');
    try {
      const { ids } = await listModels({ endpoint: effectiveEndpoint(draft, storageKind === 'server'), apiKey: draft.apiKey, serverToken: draft.serverToken });
      const note = draft.model
        ? (ids.includes(draft.model) ? `"${draft.model}" is available.` : `warning: "${draft.model}" is NOT among them.`)
        : 'no chat model configured yet.';
      setTestState({ ok: true, msg: `Connected — ${ids.length} model(s) exposed; ${note}` });
    } catch (e) { setTestState({ ok: false, msg: describeApiError(e) }); }
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

  // Uniform section wrapper — every tab is a stack of these: dim uppercase
  // header with a rule, an optional hint right under it, then the content.
  // `extra` renders at the right end of the header (e.g. an add button).
  const section = (title, content, hint, extra) => html`
    <div class="s-sec">
      <div class="s-sec-h"><span>${title}</span>${extra}</div>
      ${hint && html`<div class="hint" style=${{ margin: '-2px 0 6px' }}>${hint}</div>`}
      ${content}
    </div>`;

  return html`
    <${Modal} title="Settings" wide onClose=${guardClose}
      footer=${html`<button class="btn ghost" onClick=${guardClose}>Cancel</button>
        <button class="btn primary" onClick=${() => onSave(draft)}>Save settings</button>`}>
      <div class="m-tabs">
        ${SETTINGS_TABS.map(([id, label]) => html`
          <button key=${id} class="m-tab ${tab === id ? 'active' : ''}" onClick=${() => setTab(id)}>${label}</button>`)}
      </div>
      <!-- model pickers on several tabs share this list; datalists are invisible -->
      <datalist id="fp-models">${(models ?? []).map(m => html`<option key=${m} value=${m} />`)}</datalist>

      ${tab === 'appearance' && html`
        ${section('Theme', html`
          <div class="grid2">
            <label class="field"><span>Theme</span>
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
          </div>`,
          'Applies immediately, saved automatically.')}
        ${section('Display', html`
          <label class="field"><span>Date format — message stamps, memories, chat names</span>
            <select value=${draft.dateFormat ?? 'dd/mm/yyyy'} onChange=${(e) => set({ dateFormat: e.target.value })}>
              ${Object.keys(DATE_FORMATS).map(f => html`<option key=${f} value=${f}>${f}</option>`)}
            </select></label>`)}
        ${section('Panes', html`
          <label class="check">
            <input type="checkbox" checked=${!!draft.sidebarArrows} onChange=${(e) => set({ sidebarArrows: e.target.checked })} />
            Pane toggles as «/» edge arrows instead of the FictionPad brand / Inspector buttons (desktop — phones always use arrows)
          </label>
          <label class="check">
            <input type="checkbox" checked=${draft.edgePeek !== false} onChange=${(e) => set({ edgePeek: e.target.checked })} />
            Hover the left/right screen edge to peek at a collapsed pane (desktop)
          </label>`)}`}

      ${tab === 'connection' && html`
        ${section('API connection', html`
          <div class="grid2">
            <label class="field"><span>Endpoint</span>
              <input type="text" value=${draft.endpoint} onInput=${(e) => set({ endpoint: e.target.value })} />
              <span class="hint">OpenAI-compatible, with or without /v1.</span>
              ${storageKind === 'server' && draft.routeViaServer !== false && draft.endpoint?.trim() && !draft.endpoint.trim().startsWith('/proxy/') && html`
                <span class="hint">Requests will go via this server: /proxy/${draft.endpoint.trim()}</span>`}
            </label>
            <label class="field"><span>API key</span>
              <input type="password" value=${draft.apiKey} onInput=${(e) => set({ apiKey: e.target.value })} />
              <span class="hint">Sent as Bearer token; ${storageKind === 'server' ? 'synced via server settings' : 'stored locally in this browser'}.</span>
            </label>
          </div>
          ${storageKind === 'server' && html`
            <label class="check">
              <input type="checkbox" checked=${draft.routeViaServer !== false} onChange=${(e) => set({ routeViaServer: e.target.checked })} />
              Route API requests through this server (avoids CORS; the server calls the endpoint on your behalf)
            </label>`}
          <div style=${{ display: 'flex', gap: '8px', alignItems: 'baseline', margin: '2px 0 10px', flexWrap: 'wrap' }}>
            <button class="btn small" disabled=${testState === 'busy'} onClick=${testConnection}>
              ${testState === 'busy' ? 'Testing…' : 'Test connection'}</button>
            ${testState && testState !== 'busy' && html`
              <span class=${testState.ok ? 'hint' : 'warn'}>${testState.msg}</span>`}
          </div>`)}`}

      ${tab === 'storage' && html`
        ${section('Storage', html`
          <div class="hint">${storageKind === 'server'
            ? 'Server storage active — scenarios, personas and chats are shared via this server. Settings synced via server.'
            : 'Local storage — data lives in this browser only.'}</div>
          <label class="field" style=${{ marginTop: '6px' }}><span>Server token</span>
            <input type="password" value=${draft.serverToken ?? ''} onInput=${(e) => set({ serverToken: e.target.value })} />
            <span class="hint">Only when the server sets FICTIONPAD_TOKEN; applies after reload. Never leaves this device — stripped from exports, ignored on imports.</span>
          </label>`)}
        ${storageKind === 'server' && section('Server data', html`
          <div style=${{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button class="btn small" disabled=${!!migBusy} onClick=${() => migrate('up')}>
              ${migBusy === 'up' ? 'Uploading…' : 'Upload local data to server'}</button>
            <button class="btn small" disabled=${!!migBusy} onClick=${() => migrate('down')}>
              ${migBusy === 'down' ? 'Downloading…' : 'Download server data to local'}</button>
            <button class="btn small" disabled=${!!bakBusy} title="Snapshot of the server's SQLite database (all users of this server)"
              onClick=${serverBackup}>
              ${bakBusy === 'db' ? 'Downloading…' : 'Download server backup (.db)'}</button>
          </div>
          ${migNote && html`<div class="hint" style=${{ marginTop: '4px' }}>${migNote}</div>`}`,
          'Move data between this browser and the server. Rows with the same keys are overwritten (last write wins, no merging).')}
        ${section('Export / import', html`
          <div style=${{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button class="btn small" onClick=${onExportAll}>Export everything (.json)</button>
            <button class="btn small" disabled=${!!bakBusy} onClick=${importBackup}>
              ${bakBusy === 'import' ? 'Importing…' : 'Import backup…'}</button>
          </div>
          ${bakNote && html`<div class="hint" style=${{ marginTop: '4px' }}>${bakNote}</div>`}`,
          'One JSON with all scenarios, chats, personas, characters and settings. Import upserts by id (last write wins) — data missing from the file is kept.')}`}

      ${tab === 'models' && html`
        ${section('Models', html`
          <div class="grid3">
            <label class="field"><span>Chat model</span>
              <div style=${{ display: 'flex', gap: '6px' }}>
                <input type="text" list="fp-models" value=${draft.model} onInput=${(e) => set({ model: e.target.value })} />
                <button class="btn" onClick=${fetchModels}>Fetch</button>
              </div>
              ${modelsError && html`<span class="warn">${modelsError}</span>`}
              ${models && html`<span class="hint">${models.length} model(s) found — pick one or type freely.</span>`}
            </label>
            <label class="field"><span>Aux model</span>
              <input type="text" list="fp-models" value=${draft.auxModel} onInput=${(e) => set({ auxModel: e.target.value })} />
              <span class="hint">Memory summaries, suggestions, /improve, /recap. Blank = chat model.</span>
            </label>
            <label class="field"><span>Generator model</span>
              <input type="text" list="fp-models" value=${draft.genModel ?? ''} onInput=${(e) => set({ genModel: e.target.value })} />
              <span class="hint">✦ scenario/character/piece generator. Blank = aux model.</span>
            </label>
          </div>`)}
        ${section('Embeddings', html`
          <div class="grid2">
            <label class="field"><span>Embedding model</span>
              <input type="text" list="fp-models" placeholder="e.g. bge-m3" value=${draft.embeddingModel ?? ''}
                onInput=${(e) => set({ embeddingModel: e.target.value })} />
              <span class="hint">Semantic lore activation; blank = off. Often a separate model name — Fetch above populates the list.</span>
            </label>
            ${numField('semanticThreshold', 'Semantic threshold (0–1)', 0.55, { min: 0, max: 1, step: 0.05 })}
          </div>`,
          'Cosine similarity a semantic ("smart") lore piece needs to inject. Near-misses show in the Inspector. Blank resets to 0.55.')}`}

      ${tab === 'generation' && html`
        ${section('Length', html`
          <div class="grid3">
            <label class="field"><span>Context length (tokens)${draft.ctxAuto !== false ? ' — auto' : ''}</span>
              <${NumInput} value=${draft.ctxAuto !== false ? resolveLimits(draft).contextLength : draft.contextLength}
                min=${256} step=${512} fallback=${resolveLimits(draft).contextLength}
                onCommit=${(n) => set({ contextLength: n, ctxAuto: false })} />
              <span class="hint">${draft.ctxAuto !== false
                ? (draft.modelCtxs?.[draft.model]
                  ? `Detected ${draft.modelCtxs[draft.model]} from the model on Fetch. Editing pins a manual value.`
                  : `Default ${DEFAULT_CONTEXT_LENGTH} — Fetch in the Models tab to detect. Editing pins a manual value.`)
                : html`Manual. <a style=${{ cursor: 'pointer' }} onClick=${() => set({ ctxAuto: true })}>Back to auto</a>`}</span></label>
            <label class="field"><span>Response length preset</span>
              <select value=${draft.responseLength}
                onChange=${(e) => set({
                  responseLength: e.target.value,
                  lengthDirective: LENGTH_PRESETS[e.target.value]?.directive ?? draft.lengthDirective,
                })}>
                <option value="short">Short</option>
                <option value="medium">Medium</option>
                <option value="long">Long</option>
              </select>
              <span class="hint">Prose guidance only — never caps tokens.</span></label>
            <label class="field"><span>Max tokens (response reserve)${draft.reserveAuto !== false ? ' — auto' : ''}</span>
              <${NumInput} value=${draft.reserveAuto !== false ? resolveLimits(draft).maxTokens : draft.maxTokens}
                min=${1} fallback=${resolveLimits(draft).maxTokens}
                onCommit=${(n) => set({ maxTokens: n, reserveAuto: false })} />
              <span class="hint">${draft.reserveAuto !== false
                ? `Context ÷ 16. Editing pins a manual value.`
                : html`Manual. <a style=${{ cursor: 'pointer' }} onClick=${() => set({ reserveAuto: true })}>Back to auto</a>`}</span></label>
          </div>
          <label class="field"><span>Length directive — instruction appended to the prompt (blank = none)</span>
            <textarea rows=${2} value=${draft.lengthDirective ?? ''}
              onInput=${(e) => set({ lengthDirective: e.target.value })} /></label>`)}
        ${section('Samplers', html`
          <div class="sampler-grid">
            ${allSamplerFields(draft).map(f => {
              const active = draft.samplers?.[f.key] != null && !(draft.disabledSamplers ?? []).includes(f.key);
              return html`
                <div class="sampler-row" key=${f.key}>
                  <label class="check">
                    <input type="checkbox" checked=${active} onChange=${(e) => toggleSampler(f, e.target.checked)} />
                    ${f.label}${f.custom ? ' ✦' : ''}</label>
                  <span class="sval">
                    ${active
                      ? (f.type === 'boolean'
                        ? html`<select value=${String(draft.samplers[f.key] !== false)}
                            onChange=${(e) => setSampler(f.key, e.target.value === 'true')}>
                            <option value="true">true</option><option value="false">false</option></select>`
                        : html`<${NumInput} value=${draft.samplers[f.key]} min=${f.min} max=${f.max} step=${f.step} fallback=${f.def}
                            onCommit=${(n) => setSampler(f.key, n)} />`)
                      : html`<span class="hint">${draft.samplers?.[f.key] != null ? String(draft.samplers[f.key]) : '—'}</span>`}
                  </span>
                </div>`;
            })}
          </div>`,
          'Unchecked params are not sent.')}
        ${section('Stop strings', html`
          <${ListInput} textarea=${true} delim=${'\n'} rows=${3} values=${draft.stopStrings ?? []}
            placeholder="e.g. your EOS marker, if your model emits one"
            onChange=${(stopStrings) => set({ stopStrings })} />`,
          'One per line; generation halts at these (server-side).')}
        ${section('Per-chat overrides', html`
          <div class="sampler-grid">
            ${allSamplerFields(draft).map(f => html`
              <label class="check" key=${f.key} style=${{ margin: 0 }}>
                <input type="checkbox" checked=${(draft.samplerFields ?? []).includes(f.key)}
                  onChange=${(e) => set({ samplerFields: e.target.checked
                    ? [...(draft.samplerFields ?? []), f.key]
                    : (draft.samplerFields ?? []).filter(k => k !== f.key) })} />
                ${f.label}${f.custom ? ' ✦' : ''}</label>`)}
          </div>`,
          'The knobs offered in the chat panel\'s Samplers tab. A per-chat override replaces the global value for that chat only; knobs unchecked here aren\'t overridable per chat. Context length and max tokens are always overridable.')}
        ${section(`Custom samplers (${(draft.customSamplers ?? []).length})`, html`
          ${(draft.customSamplers ?? []).map(d => html`
            <${CustomSamplerCard} key=${d.id} def=${d}
              keyClash=${!!SAMPLER_FIELD_MAP[(d.key ?? '').trim()]}
              onChange=${(next) => set({ customSamplers: draft.customSamplers.map(q => q.id === d.id ? next : q) })}
              onRemove=${() => set({
                customSamplers: draft.customSamplers.filter(q => q.id !== d.id),
                // Drop the def's key everywhere too — unregistered params are never sent.
                samplers: Object.fromEntries(Object.entries(draft.samplers ?? {}).filter(([k]) => k !== (d.key ?? '').trim())),
                disabledSamplers: (draft.disabledSamplers ?? []).filter(k => k !== (d.key ?? '').trim()),
                samplerFields: (draft.samplerFields ?? []).filter(k => k !== (d.key ?? '').trim()),
              })} />`)}`,
          html`Backend-specific params (llama.cpp, vLLM extras…). The request key is sent as-is; a dotted key nests — e.g. key <b>chat_template_kwargs.enable_thinking</b> with type boolean sends <b>chat_template_kwargs: ${'{'}enable_thinking: true/false${'}'}</b>. Built-in keys are reserved. Registered samplers join the lists above.`,
          html`<button class="btn small"
            onClick=${() => set({ customSamplers: [...(draft.customSamplers ?? []), { id: uid(), name: '', key: '', type: 'number', min: 0, max: 1, step: 0.01, def: 0 }] })}>+ add sampler</button>`)}
        ${section('Logprobs', html`
          <div class="grid3">
            <label class="field"><span>Top logprobs — alternatives stored per token</span>
              <${NumInput} value=${draft.topLogprobs ?? 10} min=${1} max=${20} fallback=${10}
                onCommit=${(n) => set({ topLogprobs: n })} />
              <span class="hint">Sent as top_logprobs when token probabilities are on (Features tab).</span></label>
          </div>`)}
        ${section('Context budget split (%)', html`
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
          <button class="btn small" onClick=${() => set({ layerCaps: { ...LAYER_CAPS } })}>Reset split to default</button>`,
          'Static / lore / memory — chat history gets the remainder.')}
        ${section('Estimates & lore scanning', html`
          <div class="grid3">
            ${numField('tokenChars', 'Chars per token (estimate fallback)', TOKEN_CHARS, { min: 1, max: 8, step: 0.1 })}
            ${numField('loreSearchDepth', 'Lore search depth (est. tokens)', DEFAULT_SEARCH_DEPTH, { min: 0, step: 128 })}
            ${numField('loreLinkBoost', 'Lore link boost (weight bonus)', LINK_BOOST, { min: 0, max: 20 })}
          </div>`,
          'Chars/token drives estimated counts when /tokenize is unavailable — budgets, inspector "(est)" numbers, and the lore scan window all follow it. Search depth is the default scan window for keyword triggers (per-piece depth still wins); link boost is the weight an active piece lends its links.')}
        ${section('Logit bias', html`
          <div>
            <button class="btn small" onClick=${() => onOpenLogitBias(draft)}>Edit logit bias…</button>
            <span class="hint" style=${{ marginLeft: '8px' }}>${lbCount} ${lbCount === 1 ? 'entry' : 'entries'}</span>
          </div>`)}`}

      ${tab === 'features' && html`
        ${section('Features', html`
          <label class="check">
            <input type="checkbox" checked=${draft.tokenProbs !== false} onChange=${(e) => set({ tokenProbs: e.target.checked })} />
            Token probabilities (logprobs + alternatives per token; count in Generation tab)
          </label>
          <label class="check">
            <input type="checkbox" checked=${draft.showThinking !== false} onChange=${(e) => set({ showThinking: e.target.checked })} />
            Thinking output — show the model's reasoning in a collapsible box on replies (when the backend sends it)
          </label>
          <label class="check">
            <input type="checkbox" checked=${!!draft.suggestions} onChange=${(e) => set({ suggestions: e.target.checked })} />
            Response suggestions ("what you might do next" chips after each AI reply)
          </label>
          <label class="check">
            <input type="checkbox" checked=${draft.toolsEnabled !== false} onChange=${(e) => set({ toolsEnabled: e.target.checked })} />
            Tool calling (model may register characters + lore mid-reply, into this chat's lore)
          </label>
          <label class="check" title="Each newly tool-registered character is fleshed out by the ✦ generator — one aux call per new character, fired concurrently after the generation completes. Failures keep the original description. Requires tool calling.">
            <input type="checkbox" disabled=${draft.toolsEnabled === false}
              checked=${!!draft.toolsEnrich} onChange=${(e) => set({ toolsEnrich: e.target.checked })} />
            Flesh out tool-registered characters with the ✦ generator (experimental)
          </label>
          <label class="check">
            <input type="checkbox" checked=${draft.multiSpeaker !== false} onChange=${(e) => set({ multiSpeaker: e.target.checked })} />
            Multi-speaker replies (model may answer as several characters; each part gets its own bubble)
          </label>`)}
        ${draft.suggestions && section('Response suggestions', html`
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
          <label class="check">
            <input type="checkbox" checked=${!!draft.auxShowSuggestions} onChange=${(e) => set({ auxShowSuggestions: e.target.checked })} />
            Show suggestion calls in the Inspector's Aux calls log
          </label>`,
          'Uses the aux model; the prompt is editable in the Prompts tab.')}
        ${section('Memory', html`
          <div class="grid3">
            <label class="field"><span>Auto-summarize every N messages</span>
              <${NumInput} value=${draft.memoryEvery ?? MEMORY_EVERY} min=${5} max=${200} fallback=${MEMORY_EVERY}
                onCommit=${(n) => set({ memoryEvery: n })} />
              <span class="hint">Also the lore-extraction cadence.</span></label>
          </div>
          <div class="grid3">
            ${numField('memoryTemp', 'Summary temperature', 0.3, { min: 0, max: 2, step: 0.05 })}
            ${numField('memoryMaxTokens', 'Summary max tokens', 220, { min: 50, max: 2000, step: 10 })}
            ${numField('memoryMaxChars', 'Note max characters', 500, { min: 100, max: 5000, step: 50 })}
          </div>
          <div class="grid3">
            ${numField('memoryCap', 'Memory cards kept per chat', MEMORY_CAP, { min: 5, max: 1000 })}
          </div>`,
          'Summarize / extraction prompts are editable in the Prompts tab. Pinned cards are exempt from the card cap.')}
        ${section('Lore extraction', html`
          <div class="grid3">
            ${numField('loreExtractTemp', 'Temperature', 0.3, { min: 0, max: 2, step: 0.05 })}
            ${numField('loreExtractMaxTokens', 'Max tokens', 400, { min: 50, max: 2000, step: 10 })}
            ${numField('loreExtractMax', 'Max pieces per pass', 3, { min: 1, max: 10 })}
          </div>`,
          'Runs on the memory cadence. {{max}} in the extraction prompt auto-fills from max pieces per pass.')}
        ${section('Slash commands', html`
          <div class="grid3">
            ${numField('improveTemp', '/improve temperature', 0.7, { min: 0, max: 2, step: 0.05 })}
            ${numField('improveMaxTokens', '/improve max tokens', 400, { min: 50, max: 4000, step: 10 })}
          </div>
          <div class="grid3">
            ${numField('recapTemp', '/recap temperature', 0.4, { min: 0, max: 2, step: 0.05 })}
            ${numField('recapMaxTokens', '/recap max tokens', 700, { min: 50, max: 4000, step: 10 })}
            ${numField('recapWords', '/recap word target', 400, { min: 50, max: 3000, step: 50 })}
          </div>`,
          'Both use the aux model. The word target fills {{words}} in the recap prompt; max tokens is the hard cap.')}
        ${section('✦ Generator', html`
          <div class="grid3">
            ${numField('genTemp', '✦ Generate temperature', 0.9, { min: 0, max: 2, step: 0.05 })}
            ${numField('genMaxTokens', '✦ Generate max tokens', 3000, { min: 200, max: 32000, step: 100 })}
          </div>`,
          'Scenario/character/piece generator. Model is picked in the Models tab (blank = aux model); prompts are editable in the Prompts tab. Max tokens must fit a full scenario JSON.')}
        ${section('Tool calling', html`
          ${draft.toolsEnabled === false
            ? html`<div class="hint">Off — enable it above.</div>`
            : html`
            <div class="grid3">
              ${numField('toolCallCap', 'Max tool calls per generation', TOOL_CALL_CAP, { min: 1, max: 25 })}
            </div>`}`,
          'Protocol instructions are editable in the Prompts tab.')}`}

      ${tab === 'prompts' && html`
        ${section('Core', html`
          ${promptField('platformPrompt', 'Platform system prompt — lowest instruction rank; {{user}} works here', DEFAULT_PLATFORM_PROMPT, 5)}
          ${draft.toolsEnabled !== false
            ? promptField('toolsPrompt', 'Tool protocol instructions — appended to the platform prompt; teaches the model the format. {{user}} works here.', TOOLS_PROMPT, 9)
            : html`<div class="hint">Tool protocol prompt hidden — tool calling is off (Features tab).</div>`}
          ${draft.multiSpeaker !== false
            ? promptField('speakerPrompt', 'Multi-speaker instructions — appended to the platform prompt.', SPEAKER_PROMPT, 4)
            : html`<div class="hint">Multi-speaker prompt hidden — multi-speaker is off (Features tab).</div>`}`)}
        ${section('Aux calls', html`
          ${promptField('suggestionsPrompt', 'Suggestions prompt — asks the aux model for reply options', DEFAULT_SUGGESTIONS_PROMPT, 3,
            '{{user}} = persona name, {{count}} and {{words}} = the values from the Features tab. Used when suggestions are on.')}
          ${promptField('memoryPrompt', 'Memory summary prompt — auto-summaries and /memory', DEFAULT_MEMORY_PROMPT, 3,
            '{{chars}} = note max characters (Features tab).')}
          ${promptField('loreExtractPrompt', 'Lore extraction prompt — proposes new lore pieces on the memory cadence', DEFAULT_LORE_EXTRACT_PROMPT, 4,
            '{{max}} = max pieces per pass (Features tab).')}
          ${promptField('improvePrompt', '/improve prompt — rewrites your draft in character', DEFAULT_IMPROVE_PROMPT, 2,
            '{{user}} = persona name (+ description, when set).')}
          ${promptField('recapPrompt', '/recap prompt — third-person recap of recent messages', DEFAULT_RECAP_PROMPT, 2,
            '{{words}} = word target (Features tab).')}`)}
        ${section('✦ Generator', html`
          ${promptField('scenarioGenPrompt', 'Scenario generator prompt — ✦ Generate in the scenario editor', DEFAULT_SCENARIO_GEN_PROMPT, 6,
            'The reply contract is one JSON object with the scenario fields; the request and the current draft are sent as context.')}
          ${promptField('characterGenPrompt', 'Character generator prompt — ✦ Generate in the character editor', DEFAULT_CHARACTER_GEN_PROMPT, 4,
            'The reply contract is one JSON object with name, content, keys and greeting.')}
          ${promptField('pieceGenPrompt', 'Lore piece generator prompt — ✦ on a lore piece (scenario or chat lore)', DEFAULT_PIECE_GEN_PROMPT, 4,
            'The reply contract is one JSON object with type, title, content, keys and pinned.')}`)}`}
    <//>`;
}
// ============================================================================
// COMPONENTS: LOGIT BIAS EDITOR — { [inputString]: { ids, strings, power } }.
// Literal strings are tokenized via /tokenize ("!==" + s, prefix tokens sliced
// off to dodge the leading-space artifact); raw "/id,id/" syntax always works.
// ============================================================================
// Hoisted out of LogitBiasModal: defined inline it was a new component type
// every render, remounting every row on each keystroke.
function LogitBiasRow({ k, e, onRemove }) {
  return html`
    <div class="kv">
      <span class="k" style=${{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '55%' }}
        title=${(e.strings ?? []).join('')}>${k} <span class="hint">[${(e.ids ?? []).join(',')}]</span></span>
      <span>${e.power > 0 ? '+' : ''}${e.power}
        <button class="btn small ghost" style=${{ marginLeft: '6px' }} aria-label="Remove entry"
          onClick=${() => onRemove(k)}>✕</button></span>
    </div>`;
}

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
        // Both calls must succeed: without the "!=="-only baseline we can't
        // tell where the prefix ends, so bias would land on the wrong token.
        if (full?.ids && pre?.ids) {
          ids = full.ids.slice(pre.ids.length);
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
      ${pos.length > 0 && html`<h4>Encouraged</h4>${pos.map(([k, e]) => html`<${LogitBiasRow} key=${k} k=${k} e=${e} onRemove=${remove} />`)}`}
      ${neg.length > 0 && html`<h4>Discouraged</h4>${neg.map(([k, e]) => html`<${LogitBiasRow} key=${k} k=${k} e=${e} onRemove=${remove} />`)}`}
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
      ${hasChat && html`<button class="btn" style=${{ marginTop: '8px' }} onClick=${() => onPreview()}>Preview current context</button>`}
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
      ${hasChat && html`<button class="btn" style=${{ marginTop: '8px' }} onClick=${() => onPreview()}>Re-run assembler on current chat</button>`}
    </div>`;
}

// ============================================================================
// COMPONENTS: MEMORY PANEL — view / pin / delete memories, manual summarize.
// ============================================================================
function MemoryPanel({ chat, onUpdateChat, onSummarize, summarizing, dateFormat, memoryEvery, cap }) {
  if (!chat) return html`<div class="hint">Select a chat to see its memories.</div>`;
  const memories = [...(chat.memoryStore?.memories ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const setStore = (mems) => onUpdateChat({ ...chat, memoryStore: { ...chat.memoryStore, memories: mems } }, { touch: false });
  return html`
    <div>
      <div style=${{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' }}>
        <span class="hint" style=${{ flex: 1 }}>
          ${memories.length}/${cap ?? MEMORY_CAP} memories · auto-summary every ${memoryEvery ?? MEMORY_EVERY} messages
        </span>
        <button class="btn small" disabled=${summarizing} onClick=${() => onSummarize()}>
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
function ChatOptions({ chat, personas, scenario, characters, onUpdateChat, onExport, onDelete, onGenerate }) {
  const [editing, setEditing] = useState(null); // { piece, isNew } | null — lore piece editor popout
  if (!chat) return html`<div class="hint">Select a chat first.</div>`;
  const pieces = Array.isArray(chat.lorePieces) ? chat.lorePieces : [];
  const allPieces = mergedLorePieces(scenario, chat, characters);
  const linkedChars = resolveCharacters(scenario, chat, characters);
  const setPieces = (lorePieces) => update({ ...chat, lorePieces });
  // Metadata edits (name, persona, lore, notes) don't touch the message tree —
  // touch:false keeps them from bumping updatedAt and re-sorting the sidebar.
  const update = (c) => onUpdateChat(c, { touch: false });
  return html`
    <div>
      <label class="field"><span>Chat name</span>
        <input type="text" value=${chat.name} onInput=${(e) => update({ ...chat, name: e.target.value })} /></label>
      <label class="field"><span>Persona ({{user}})</span>
        <select value=${chat.personaId ?? ''} onChange=${(e) => update({ ...chat, personaId: e.target.value || null })}>
          <option value="">— none ({{user}} → "User") —</option>
          ${Object.values(personas).sort((a, b) => a.name.localeCompare(b.name)).map(p => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}
        </select></label>
      <label class="field"><span>Model override (this chat only; blank = global chat model)</span>
        <input type="text" value=${chat.settings?.model ?? ''} placeholder="(global)"
          onInput=${(e) => update({ ...chat, settings: { ...(chat.settings ?? {}), model: e.target.value.trim() || undefined } })} /></label>
      ${linkedChars.length > 0 && html`
        <div class="hint">Linked characters (global cards — edits apply live everywhere): ${linkedChars.map(p => p.title).join(', ')}</div>`}
      <label class="field"><span>Custom instructions — appended to the system layer for this chat only</span>
        <textarea rows=${4} value=${chat.customInstructions ?? ''}
          onInput=${(e) => update({ ...chat, customInstructions: e.target.value })} /></label>
      <label class="field"><span>Author's note — sticky steering injected after custom instructions</span>
        <textarea rows=${2} value=${chat.authorsNote ?? ''}
          onInput=${(e) => update({ ...chat, authorsNote: e.target.value })} /></label>
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
                <button class="btn small" onClick=${() => update(acceptQueuedLore(chat, q.id))}>accept</button>
                <button class="btn small danger" onClick=${() => update(dismissQueuedLore(chat, q.id))}>✕</button>
              </div>
              <div class="hint" style=${{ padding: '2px 8px 6px' }}>${toPreview(q.content, 160)}</div>
            </div>`)}
        </div>`}
      <div class="field">
        <span>Lore — this chat only (${pieces.length})
          <button class="btn small" style=${{ marginLeft: '8px' }}
            onClick=${() => setEditing({ piece: newLorePiece(), isNew: true })}>+ add piece</button>
          ${LORE_TEMPLATES.map(t => html`
            <button key=${t.label} class="btn small" style=${{ marginLeft: '4px' }}
              title=${`New ${t.label} piece, prefilled with a skeleton`}
              onClick=${() => setEditing({ piece: newLoreFromTemplate(t), isNew: true })}>+ ${t.label}</button>`)}
        </span>
        <div class="hint">Merged over the scenario's lore at generation time (chat wins on a shared id). Characters added here join speaker colours, /pov, and semantic activation for this chat only. Click a piece to edit or ✦ generate it.</div>
        ${pieces.map(p => html`
          <div class="lore-card" key=${p.id}>
            <div class="lc-head" title="Edit piece" onClick=${() => setEditing({ piece: p, isNew: false })}>
              <span class="t">${p.title || '(untitled)'}</span>
              ${p.type === 'character' && html`<span class="pill">character</span>`}
              ${p.pinned && html`<span class="pill pinned">pinned</span>`}
              ${p.enabled === false && html`<span class="pill">disabled</span>`}
              <button class="btn small danger" title="Remove from this chat"
                onClick=${(e) => { e.stopPropagation(); setPieces(pieces.filter(q => q.id !== p.id)); }}>✕</button>
            </div>
          </div>`)}
      </div>
      <div style=${{ display: 'flex', gap: '6px' }}>
        <button class="btn small" onClick=${() => onExport()}>Export chat JSON</button>
        <button class="btn small danger" onClick=${() => onDelete()}>Delete chat</button>
      </div>
      ${editing && html`
        <${LorePieceEditor} piece=${editing.piece} isNew=${editing.isNew} allPieces=${allPieces}
          onSave=${(draft) => {
            setPieces(editing.isNew ? [...pieces, draft] : pieces.map(q => q.id === draft.id ? draft : q));
            setEditing(null);
          }}
          onClose=${() => setEditing(null)} onGenerate=${onGenerate} />`}
    </div>`;
}

// ============================================================================
// COMPONENTS: CHAT SAMPLERS TAB — per-chat sampler + generation overrides,
// with the global defaults editable in place (the toggle swaps the pane).
// A knob is sent only while checked: per-chat rows override the global value
// for this chat's generations; global rows mirror Settings → Generation.
// ============================================================================
// Generation-length knobs shown in BOTH Samplers pane views (per-chat rows
// override, global rows edit directly) — keeps the two views in the same order.
const GEN_LENGTH_FIELDS = [
  { key: 'contextLength', label: 'Context length (tokens)', type: 'number', min: 256, step: 512, def: DEFAULT_SETTINGS.contextLength },
  { key: 'maxTokens', label: 'Response max tokens', type: 'number', min: 1, step: 50, def: DEFAULT_SETTINGS.maxTokens },
];

function ChatSamplers({ chat, settings, onUpdateChat, onUpdateSettings }) {
  const [globalEdit, setGlobalEdit] = useState(false);
  if (!chat) return html`<div class="hint">Select a chat first.</div>`;
  const global = settings?.samplers ?? {};
  const overrides = chat.settings?.samplers ?? {};
  const fields = allSamplerFields(settings);
  // touch:false — sampler tweaks are metadata, not narrative edits; don't
  // bump updatedAt and re-sort the sidebar.
  const putChatSettings = (patch) =>
    onUpdateChat({ ...chat, settings: { ...(chat.settings ?? {}), ...patch } }, { touch: false });
  const setGlobal = (k, v) => onUpdateSettings({ samplers: { ...global, [k]: v } });
  // Disable ≠ delete: value stays in settings.samplers, key joins
  // disabledSamplers; re-enabling restores it.
  const toggleGlobal = (f, on) => {
    const disabledSamplers = (settings?.disabledSamplers ?? []).filter(k => k !== f.key);
    if (!on) disabledSamplers.push(f.key);
    const samplers = { ...global };
    if (on && samplers[f.key] == null) samplers[f.key] = f.def;
    onUpdateSettings({ samplers, disabledSamplers });
  };
  // What the global side would actually send (disabled keys excluded) — the
  // per-chat rows display these as the inherited values.
  const globalSent = enabledSamplers(settings);
  // Value editor for a field: true/false select for booleans, NumInput else.
  const valueCtl = (f, value, onChange) => f.type === 'boolean'
    ? html`<select value=${String(value !== false)} onChange=${(e) => onChange(e.target.value === 'true')}>
        <option value="true">true</option><option value="false">false</option></select>`
    : html`<${NumInput} value=${value} min=${f.min} max=${f.max} step=${f.step} fallback=${f.def}
        onCommit=${onChange} />`;
  return html`
    <div>
      <div class="ptabs" style=${{ margin: '-4px 0 8px', padding: 0 }}>
        <button class=${globalEdit ? '' : 'active'} onClick=${() => setGlobalEdit(false)}>This chat</button>
        <button class=${globalEdit ? 'active' : ''} onClick=${() => setGlobalEdit(true)}>Global defaults</button>
      </div>
      ${globalEdit ? html`
        ${GEN_LENGTH_FIELDS.map(f => html`
          <div class="sampler-row" key=${f.key}>
            <label class="check">${f.label}</label>
            <span class="sval">
              ${valueCtl(f, settings?.[f.key] ?? f.def, (v) => onUpdateSettings({ [f.key]: v }))}
            </span>
          </div>`)}
        ${fields.map(f => {
          const active = global[f.key] != null && !(settings?.disabledSamplers ?? []).includes(f.key);
          return html`
            <div class="sampler-row" key=${f.key}>
              <label class="check">
                <input type="checkbox" checked=${active} onChange=${(e) => toggleGlobal(f, e.target.checked)} />
                ${f.label}${f.custom ? ' ✦' : ''}</label>
              <span class="sval">
                ${active
                  ? valueCtl(f, global[f.key], (v) => setGlobal(f.key, v))
                  : html`<span class="hint">${global[f.key] != null ? String(global[f.key]) : '—'}</span>`}
              </span>
            </div>`;
        })}
        <div class="hint" style=${{ marginTop: '8px' }}>Editing the global samplers (Settings → Generation). Unchecked params aren't sent — the backend default applies; values are kept.</div>` : html`
        ${GEN_LENGTH_FIELDS.map(f => {
          const on = chat.settings?.[f.key] != null;
          const eff = on ? chat.settings[f.key] : settings?.[f.key];
          return html`
            <div class="sampler-row" key=${f.key}>
              <label class="check">
                <input type="checkbox" checked=${on}
                  onChange=${(e) => putChatSettings({ [f.key]: e.target.checked ? (eff ?? f.def) : undefined })} />
                ${f.label}</label>
              <span class="sval">
                ${on
                  ? valueCtl(f, chat.settings[f.key], (v) => putChatSettings({ [f.key]: v }))
                  : html`<span class="hint">global: ${eff ?? f.def}</span>`}
              </span>
            </div>`;
        })}
        ${(() => {
          const offered = fields.filter(f => (settings?.samplerFields ?? []).includes(f.key));
          if (!offered.length) return html`<div class="hint">No per-chat sampler knobs enabled — pick them in Settings → Generation.</div>`;
          return offered.map(f => {
            const on = overrides[f.key] != null;
            const eff = on ? overrides[f.key] : globalSent[f.key];
            return html`
              <div class="sampler-row" key=${f.key}>
                <label class="check">
                  <input type="checkbox" checked=${on}
                    onChange=${(e) => {
                      const samplers = { ...overrides };
                      if (e.target.checked) samplers[f.key] = global[f.key] ?? f.def;
                      else delete samplers[f.key];
                      putChatSettings({ samplers });
                    }} />
                  ${f.label}${f.custom ? ' ✦' : ''}</label>
                <span class="sval">
                  ${on
                    ? valueCtl(f, overrides[f.key], (v) => putChatSettings({ samplers: { ...overrides, [f.key]: v } }))
                    : html`<span class="hint">${eff != null ? `global: ${eff}` : 'backend default'}</span>`}
                </span>
              </div>`;
          });
        })()}
        <div class="hint" style=${{ marginTop: '8px' }}>Checked knobs override the global value for this chat only. Sampler knobs are picked in Settings → Generation; context length and max tokens are always available.</div>`}
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
// Adaptive precision: near-degenerate distributions (e.g. post-thinking
// replies, where the answer is ~decided) all round to 100.0%/0.0% at 1
// decimal and the view looks broken. Show more digits near the extremes.
const fmtPct = (pct) => pct == null ? null
  : pct >= 99.95 ? pct.toFixed(3) + '%'
  : pct >= 99.5 ? pct.toFixed(2) + '%'
  : pct > 0 && pct < 0.1 ? '<0.1%'
  : pct.toFixed(1) + '%';

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
              <span class="pc">${fmtPct(pct) ?? 'n/a'}</span></div>
            ${(t.top ?? []).map((alt, j) => {
              const ap = probPct(alt.logprob);
              return html`<div key=${j} class="pop-row alt" onClick=${() => onPick(i, alt.token)}>
                <span class="rank">#${j + 1}</span><span class="tt">${visibleTok(alt.token)}</span>
                <span class="pc">${fmtPct(ap) ?? ''}</span></div>`;
            })}
            <div class="pop-row alt" onClick=${() => onPick(i, null)}><span class="tt">↻ from here</span></div>
          </span></span>`;
      })}
    </div>`;
}

// Collapsible reasoning box (delta.reasoning_content — vLLM/DeepSeek/etc.).
// Collapsed by default, streaming or not — the header still shows live that
// thinking is in progress ("Thinking…"). The expanded body scrolls via
// RailScroll (hidden native scrollbar, accent rail + bottom fade cues).
function ThinkBox({ text, streaming }) {
  const [open, setOpen] = useState(false);
  return html`
    <div class="think">
      <button class="think-head" onClick=${() => setOpen(!open)}>
        <span class="think-caret">${open ? '▾' : '▸'}</span> Thinking${streaming ? '…' : ''}</button>
      ${open && html`<${RailScroll} className="think-body">${text}<//>`}
    </div>`;
}

function MessageItem({ node, index, isRoot, isLeaf, personaName, characterNames, characterColors, streaming, generating, dateFormat, showThinking, onEdit, onRegenerate, onSwipe, onSwipeTo, onBranch, onRewind, onDelete, onReply, onRegenFromToken }) {
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
  // The t1–t6 hiding rules exist only inside `@media (max-width: 700px)`, so
  // the whole fit-measurement is pointless (and wastes up to 6 renders per
  // message) on wider viewports — gate every step on it.
  const metaCollapseApplies = () => window.matchMedia('(max-width: 700px)').matches;
  const metaRef = useRef(null);
  const [metaLevel, setMetaLevel] = useState(0);
  useEffect(() => {
    const el = metaRef.current; if (!el || !metaCollapseApplies()) return;
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
    if (!el || streaming || !metaCollapseApplies()) return;
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
  // Reasoning channel (swipe.think): its own bubble ahead of the reply —
  // visually separated like a speaker segment, but unnamed and collapsible.
  const thinkBubble = !isUser && !editing && showThinking !== false && swipe.think
    ? html`<div class="bubble think-bubble"><${ThinkBox} text=${subUser(swipe.think, personaName)} streaming=${streaming} /></div>`
    : null;

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
  // Speaker-name colour: a character card's explicit colour wins; otherwise
  // the hue is hashed from the name (theme supplies saturation/lightness).
  const speakerStyle = (name) => {
    const col = name && characterColors?.[String(name).toLowerCase()];
    return col ? { color: col } : { '--speaker-h': hueForName(name) };
  };
  // Multi-speaker split: one swipe, several `Name:` parts → one
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
              style=${name !== 'Narrator' ? speakerStyle(name) : null}>${name}</span>`)
          : html`<span class="who ${isCharacter ? 'speaker' : ''}"
              style=${isCharacter ? speakerStyle(speaker) : null}>${speaker}</span>`}
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
      ${multi && !editing && !(showProbs && hasProbs) ? html`
        ${thinkBubble}
        ${segments.map((seg, si) => html`
        <div key=${si} class="bubble seg ${dragX !== 0 ? 'dragging' : ''}"
          style=${{ transform: dragX ? `translateX(${dragX}px)` : null }}
          ...${gestureHandlers}>
          <div class="seg-who ${seg.speaker ? 'speaker' : ''}"
            style=${seg.speaker ? speakerStyle(seg.speaker) : null}>${seg.speaker ?? 'Narrator'}</div>
          <div class=${streaming && si === segments.length - 1 ? 'streaming-cursor' : ''}><${ThrottledMarkdown} text=${seg.text} prose streaming=${streaming && si === segments.length - 1} /></div>
        </div>`)}` : html`
      ${thinkBubble}
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
            : html`<div class=${streaming ? 'streaming-cursor' : ''}><${ThrottledMarkdown} text=${displayText} prose streaming=${streaming} /></div>`}
      </div>`}
      ${ctxMenu && html`
        <${ContextMenu} x=${ctxMenu.x} y=${ctxMenu.y} onClose=${() => setCtxMenu(null)}
          items=${[
            ...(hasProbs ? [{ label: 'Token probabilities', fn: () => setShowProbs(!showProbs) }] : []),
            { label: 'Edit', fn: () => { setDraft(swipe.text); setEditing(true); }, disabled: generating },
            isUser
              ? { label: 'Reply from here', fn: () => onReply(node.id) }
              : { label: 'Regenerate (new swipe)', fn: () => onRegenerate(node.id) },
            { label: 'Branch from here', fn: () => onBranch(node.id) },
            ...(!isRoot ? [
              '-',
              { label: 'Rewind to here', fn: () => confirm('Rewind the chat to this message? Later messages stay in the tree but leave the active branch; memories are rolled back.') && onRewind(node.id), disabled: generating },
              { label: 'Delete message (and its branch)', fn: () => confirm('Delete this message and everything after it in its branch?') && onDelete(node.id), danger: true, disabled: generating },
            ] : []),
          ]} />`}
    </div>`;
}

// Streaming markdown throttle: re-parsing the whole accumulated reply with
// marked on every token is O(n²) on the main thread. While `streaming`, the
// rendered text flushes at most once per ~50ms (the latest text is always kept
// in a ref); when streaming ends the exact full text renders immediately via
// the direct path. Non-streaming messages are never throttled.
function ThrottledMarkdown({ text, prose = false, streaming = false }) {
  const [shown, setShown] = useState(text);
  const latestRef = useRef(text);
  latestRef.current = text;
  useEffect(() => {
    if (!streaming) return; // settled: the exact text renders via the direct path
    setShown(latestRef.current); // stream (re)started: sync once, then tick
    const iv = setInterval(() => setShown(s => (s === latestRef.current ? s : latestRef.current)), 50);
    return () => clearInterval(iv);
  }, [streaming]);
  return html`<${Markdown} text=${streaming ? shown : text} prose=${prose} streaming=${streaming} />`;
}

// Memoized MessageItem: the chat pane re-renders the whole message list per
// streamed token, but the other messages don't change. The action callbacks
// from App get fresh identities every render — they are behaviourally stable
// (they read live state via ref.current; the only render-scope capture is
// ui.chatId, and a chat switch always changes the node identities as well), so
// a props-equal that compares everything except functions is safe here.
const MessageItemMemo = React.memo(MessageItem, (a, b) => {
  for (const k in a) {
    if (typeof a[k] === 'function' && typeof b[k] === 'function') continue;
    if (a[k] !== b[k]) return false;
  }
  return true;
});

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

function Composer({ generating, busy, onSubmit, onStop, inject, chatId, initialText, onDraft }) {
  // Draft text seeds from ChatPane's per-chat drafts store (this component
  // remounts per chat via key=chat.id) and every edit is reported back through
  // onDraft, so an unsent draft survives chat switches within the session.
  const [text, setTextRaw] = useState(() => initialText ?? '');
  const setText = (v) => { setTextRaw(v); onDraft?.(chatId, v); };
  const [hint, setHint] = useState(null);
  useEffect(() => {
    if (!inject) return;
    // Async injects (e.g. /improve) resolve seconds later; if the user
    // switched chats meanwhile, the text belongs to the other chat.
    if (inject.chatId && chatId && inject.chatId !== chatId) return;
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
            // While generating/busy, Enter falls through to a newline instead
            // of being swallowed with no effect.
            if (e.key === 'Enter' && !e.shiftKey && !coarseEnter && !generating && !busy) { e.preventDefault(); send(); }
          }} />
        ${generating || busy
          ? html`<button class="btn danger" title=${generating ? 'Stop generation' : 'Stop background calls (memory, generator, suggestions…)'}
              onClick=${onStop}>■ Stop</button>`
          : html`<button class="btn primary" onClick=${send}>Send</button>`}
      </div>
      ${hint && html`<div class="hint warn">${hint}</div>`}
    </div>`;
}

function ChatPane({ chat, persona, characterNames, characterColors, generating, suggestions, onPickSuggestion, onRerollSuggestions,
                  onSubmitInput, onStop, composerInject, auxBusy = [], dateFormat, showThinking, ...actions }) {
  const logRef = useRef(null);
  const path = useMemo(() => getActivePath(chat?.messages, chat?.activeLeafId), [chat]);
  // Stick-to-bottom: follow content growth only while the user is pinned to
  // the bottom zone (~80px). Programmatic scrolls are flagged so they don't
  // unpin/re-pin themselves via the scroll listener.
  const pinnedRef = useRef(true);
  const programmaticRef = useRef(false);
  const lastTopRef = useRef(0); // for detecting user-initiated upward scrolls
  const [pinned, setPinned] = useState(true);
  // Real user scroll gestures (touch drag / wheel) — used to tell deliberate
  // scrolls from layout-driven clamp events (content shrinking on regenerate,
  // mobile keyboard dismiss, meta-row collapse all shift scrollTop without the
  // user touching anything and must NOT unpin the follow).
  const gestureRef = useRef(false);
  const gestureTimer = useRef(0);
  const noteGesture = () => {
    gestureRef.current = true;
    clearTimeout(gestureTimer.current);
    gestureTimer.current = setTimeout(() => { gestureRef.current = false; }, 300);
  };
  // Programmatic scroll-to-bottom: flag the scroll listener, then clear the
  // flag on the next frame regardless — when already at bottom no scroll event
  // fires, and waiting for one would swallow the next genuine user scroll.
  // (A real scroll event fires before rAF callbacks, so the listener still
  // gets first crack at the flag.)
  const scrollElToBottom = (el) => {
    programmaticRef.current = true;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => { programmaticRef.current = false; });
  };
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
    scrollElToBottom(el);
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
    // Unpin on upward scrolls only when they're user-driven (an active
    // gesture) or land clearly away from the bottom. Layout-driven clamp
    // events — content shrinking on regenerate, keyboard dismiss, meta-row
    // collapse — move scrollTop up with no gesture and dist ≈ 0; those must
    // not unpin, or generation stops following and "jump to latest" appears.
    if (top < lastTopRef.current - 1 && (gestureRef.current || dist > 80)) p = false;
    else if (dist < 40) p = true; // deliberately scrolling to the bottom re-pins
    lastTopRef.current = top;
    if (p !== pinnedRef.current) { pinnedRef.current = p; setPinned(p); }
    computeJump();
  };
  useEffect(() => { // follow growth only when pinned
    const el = logRef.current;
    if (pinnedRef.current) {
      if (el) scrollElToBottom(el);
    } else computeJump(); // content grew while unpinned — jump may newly apply
  }, [chat, generating, suggestions]);
  useEffect(() => { // new chat → start pinned at the bottom
    pinnedRef.current = true;
    setPinned(true);
    setShowJump(false);
    const el = logRef.current;
    if (el) scrollElToBottom(el);
  }, [chat?.id]);
  // Explicit intents = go to the bottom and stay there: starting a generation
  // (send / regenerate / ▶⁺ / generate-response) and sending your own message
  // (a fresh user-role leaf) both force-pin, even if you were scrolled up.
  const wasGenRef = useRef(false);
  useEffect(() => {
    if (generating && !wasGenRef.current) scrollToBottom();
    wasGenRef.current = !!generating;
  }, [generating]);
  const seenLeafRef = useRef(null);
  useEffect(() => {
    const leafId = path[path.length - 1]?.id;
    const role = path[path.length - 1]?.role;
    if (leafId && leafId !== seenLeafRef.current) {
      if (role === 'user' && seenLeafRef.current !== null) scrollToBottom();
      seenLeafRef.current = leafId;
    }
  }, [path]);
  // Per-chat composer drafts (ephemeral, session-only — never persisted). The
  // Composer remounts per chat (key=chat.id) and seeds from this map; edits
  // flow back via onDraft, so an unsent draft survives any number of chat
  // switches. A successful send reports '' and clears only that chat's entry.
  const draftsRef = useRef(new Map());
  const onDraft = (chatId, text) => {
    if (text) draftsRef.current.set(chatId, text);
    else draftsRef.current.delete(chatId);
  };
  // Send acceptance: onSubmitInput returns a hint string (draft kept) or null
  // ("consumed"), but Main's pre-flight guard (no endpoint/model configured)
  // drops a plain send silently while still returning null, and the Composer
  // clears its text optimistically. Verify acceptance once Main's state has
  // settled and restore the draft if the message never went anywhere.
  const [draftRestore, setDraftRestore] = useState(null);
  useEffect(() => { setDraftRestore(null); }, [composerInject]); // a fresh Main inject takes precedence
  const latestRef = useRef(null);
  latestRef.current = { chat, generating, auxBusy };
  const onComposerSubmit = (text) => {
    const chatId = chat?.id;
    const res = onSubmitInput(text);
    if (res || !chatId) return res; // hint shown, draft kept by the Composer
    setTimeout(() => {
      const cur = latestRef.current;
      const p = cur.chat ? getActivePath(cur.chat.messages, cur.chat.activeLeafId) : [];
      // Accepted = a generation/aux pass started, or the user message landed
      // in the tree (runGeneration can still bail after the append).
      const appended = p[p.length - 1]?.role === 'assistant'
        && p[p.length - 2]?.role === 'user' && activeText(p[p.length - 2]) === text;
      if (cur.generating || cur.auxBusy.length || appended) return;
      draftsRef.current.set(chatId, text); // rejected — restore the draft
      if (cur.chat?.id === chatId) setDraftRestore({ chatId, text, nonce: Date.now() });
    }, 0);
    return null;
  };
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
      <div class="chatlog" ref=${logRef} onScroll=${onLogScroll} onWheel=${noteGesture} onTouchMove=${noteGesture}>
        ${path.map((node, i) => html`
          <${MessageItemMemo} key=${node.id} node=${node} index=${i + 1} isRoot=${!node.parentId} isLeaf=${node.id === leaf?.id}
            personaName=${personaName} characterNames=${characterNames} characterColors=${characterColors}
            streaming=${generating?.nodeId === node.id}
            generating=${!!generating}
            dateFormat=${dateFormat} showThinking=${showThinking}
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
      ${!generating && !auxBusy.length && leaf?.role === 'user' && html`
        <div class="gen-reply">
          <button class="btn gen-pill" onClick=${() => actions.onGenerateReply()}>✦ Generate response</button>
        </div>`}
      <${Composer} key=${chat.id} chatId=${chat.id} generating=${!!generating} busy=${auxBusy.length > 0}
        initialText=${draftsRef.current.get(chat.id) ?? ''} onDraft=${onDraft}
        onSubmit=${onComposerSubmit} onStop=${onStop} inject=${draftRestore ?? composerInject} />
    </div>`;
}

// ============================================================================
// COMPONENTS: SIDEBAR — collapsible Scenarios / Characters / Chats sections.
// A collapsed section still shows the entries tied to the open chat (its
// scenario, its linked global characters, the chat itself) so the current
// context never vanishes. Collapse state persists in fictionpad.ui.
// ============================================================================
// Below this pane width the pane ribbons (sidebar foot, drawer tabs) no longer
// fit on one line — components add a `narrow` class and CSS stacks the ribbons
// instead of squishing/clipping them.
const PANE_NARROW = 270;
// Full-text chat search: the haystack is every swipe text of every node,
// built lazily (only while a query is active) and cached per chat keyed by
// id + updatedAt — a chat's contents only change with updatedAt. Both the raw
// join (for match excerpts) and its lowercase (for matching) are kept.
const chatTextCache = new Map();
function chatSearchText(chat) {
  const key = `${chat.id}@${chat.updatedAt ?? 0}`;
  let hit = chatTextCache.get(key);
  if (!hit) {
    const raw = Object.values(chat.messages ?? {})
      .flatMap(n => (n.swipes ?? []).map(s => s?.text ?? ''))
      .join('\n');
    hit = { raw, lower: raw.toLowerCase() };
    if (chatTextCache.size > 500) chatTextCache.clear();
    chatTextCache.set(key, hit);
  }
  return hit;
}
// ~60 chars of one-line context around a content match, ellipsized at cuts.
function matchExcerpt(raw, i, qlen) {
  const start = Math.max(0, i - 20);
  const end = Math.min(raw.length, i + qlen + 40);
  return (start > 0 ? '…' : '') + raw.slice(start, end).replace(/\s+/g, ' ').trim()
    + (end < raw.length ? '…' : '');
}
function Sidebar({ scenarios, chats, characters, selectedScenarioId, selectedCharacterId, selectedChatId,
                  onSelectScenario, onSelectCharacter, onSelectChat,
                  onNewScenario, onEditScenario, onDeleteScenario, onNewChat,
                  onNewCharacter, onEditCharacter, onDeleteCharacter, onNewCharacterChat,
                  onExportScenario, onExportCharacter, onImport,
                  onOpenPersonas, onOpenSettings, collapsed, onDeleteChat,
                  onScenarioContextMenu, onCharacterContextMenu,
                  sideCollapsed, onToggleSection,
                  storageKind, saveRetrying,
                  width, onDragStart, onResetWidth, onChatAction, onChatContextMenu, peek, peekLeave }) {
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
  // The open chat is always pinned into the list — even when the scenario/
  // character filter would exclude it (chat opened first, filter changed after).
  const baseChats = sideCollapsed.chats ? chatList.filter(c => c.id === selectedChatId) : chatList;
  const pinnedChats = openChat && !baseChats.includes(openChat) ? [openChat, ...baseChats] : baseChats;
  // Chat filter: case-insensitive substring on the chat name, its scenario's
  // name, any linked character's name — or the full message text (every node,
  // every swipe). Name hits render plain; content-only hits show a match
  // excerpt. Non-empty filter ignores the section's collapse state; empty
  // filter = the pinned view above, untouched.
  const [chatFilter, setChatFilter] = useState('');
  const chatQuery = chatFilter.trim().toLowerCase();
  const matchFor = (c) => {
    const nameHit = (c.name ?? '').toLowerCase().includes(chatQuery)
      || (scenarios[c.scenarioId]?.name ?? '').toLowerCase().includes(chatQuery)
      || (c.characterIds ?? []).some(id => (characters?.[id]?.name ?? '').toLowerCase().includes(chatQuery));
    if (nameHit) return { hit: true, excerpt: null };
    const { raw, lower } = chatSearchText(c);
    const i = lower.indexOf(chatQuery);
    return i === -1 ? { hit: false, excerpt: null } : { hit: true, excerpt: matchExcerpt(raw, i, chatQuery.length) };
  };
  const chatMatches = chatQuery ? new Map(chatList.map(c => [c.id, matchFor(c)])) : null;
  const shownChats = chatQuery ? chatList.filter(c => chatMatches.get(c.id).hit) : pinnedChats;
  // Long-press (touch) → same context menu as right-click. Cancelled by movement.
  const lp = useRef(null);
  const lpMenuRef = useRef(false); // menu just opened by long-press — swallow the follow-up click
  const lpStart = (e, id, onMenu = onChatContextMenu) => {
    if (e.pointerType === 'mouse') return;
    lpMenuRef.current = false; // a fresh press supersedes any stale swallow flag
    const { clientX: x, clientY: y } = e;
    lp.current = { x, y, timer: setTimeout(() => { lp.current = null; lpMenuRef.current = true; onMenu(id, x, y); }, 500) };
  };
  // Row click after a long-press must not also fire (the menu just opened).
  const rowClick = (fn) => () => {
    if (lpMenuRef.current) { lpMenuRef.current = false; return; }
    fn();
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
    <div class="sidebar ${collapsed ? 'collapsed' : ''} ${!collapsed && width < PANE_NARROW ? 'narrow' : ''} ${peek ? 'peek' : ''}"
      style=${{ width: collapsed ? 0 : width, minWidth: collapsed ? 0 : width }}
      onPointerLeave=${peekLeave}>
      <div class="scroll">
        <div class="side-section">
          ${sectionTitle('scenarios', 'Scenarios', onNewScenario, 'New scenario')}
          ${shownScenarios.length === 0 && !sideCollapsed.scenarios
            && html`<div class="hint" style=${{ padding: '0 6px' }}>No scenarios yet.</div>`}
          ${shownScenarios.map(s => html`
            <div class="side-item ${s.id === selectedScenarioId ? 'selected' : ''}" key=${s.id}
              onClick=${rowClick(() => onSelectScenario(s.id === selectedScenarioId ? null : s.id))}
              onContextMenu=${(e) => { e.preventDefault(); onScenarioContextMenu(s.id, e.clientX, e.clientY); }}
              onPointerDown=${(e) => lpStart(e, s.id, onScenarioContextMenu)}
              onPointerMove=${lpCancel} onPointerUp=${lpCancel} onPointerCancel=${lpCancel}>
              <span class="name">${s.name}</span>
              <span class="tools">
                <span class="tools-full">
                  <button class="btn small ghost" title="New chat from this scenario"
                    onClick=${(e) => { e.stopPropagation(); onNewChat(s.id); }}>✉\uFE0E</button>
                  <button class="btn small ghost" title="Edit"
                    onClick=${(e) => { e.stopPropagation(); onEditScenario(s.id); }}>✎</button>
                  <button class="btn small ghost" title="Export JSON"
                    onClick=${(e) => { e.stopPropagation(); onExportScenario(s.id); }}>⤓</button>
                  <button class="btn small ghost" title="Delete"
                    onClick=${(e) => { e.stopPropagation(); onDeleteScenario(s.id); }}>✕</button>
                </span>
                <button class="btn small ghost tools-menu" title="Scenario actions"
                  onClick=${(e) => { e.stopPropagation(); onScenarioContextMenu(s.id, e.clientX, e.clientY); }}>⋯</button>
              </span>
            </div>`)}
        </div>
        <div class="side-section">
          ${sectionTitle('characters', 'Characters', onNewCharacter, 'New character')}
          ${shownCharacters.length === 0 && !sideCollapsed.characters
            && html`<div class="hint" style=${{ padding: '0 6px' }}>No characters yet.</div>`}
          ${shownCharacters.map(c => html`
            <div class="side-item ${c.id === selectedCharacterId ? 'selected' : ''}" key=${c.id}
              onClick=${rowClick(() => onSelectCharacter(c.id === selectedCharacterId ? null : c.id))}
              onContextMenu=${(e) => { e.preventDefault(); onCharacterContextMenu(c.id, e.clientX, e.clientY); }}
              onPointerDown=${(e) => lpStart(e, c.id, onCharacterContextMenu)}
              onPointerMove=${lpCancel} onPointerUp=${lpCancel} onPointerCancel=${lpCancel}>
              <span class="name">${c.name}</span>
              <span class="tools">
                <span class="tools-full">
                  <button class="btn small ghost" title="New chat with this character"
                    onClick=${(e) => { e.stopPropagation(); onNewCharacterChat(c.id); }}>✉\uFE0E</button>
                  <button class="btn small ghost" title="Edit"
                    onClick=${(e) => { e.stopPropagation(); onEditCharacter(c.id); }}>✎</button>
                  <button class="btn small ghost" title="Export JSON"
                    onClick=${(e) => { e.stopPropagation(); onExportCharacter(c.id); }}>⤓</button>
                  <button class="btn small ghost" title="Delete"
                    onClick=${(e) => { e.stopPropagation(); onDeleteCharacter(c.id); }}>✕</button>
                </span>
                <button class="btn small ghost tools-menu" title="Character actions"
                  onClick=${(e) => { e.stopPropagation(); onCharacterContextMenu(c.id, e.clientX, e.clientY); }}>⋯</button>
              </span>
            </div>`)}
        </div>
        <div class="side-section">
          ${sectionTitle('chats', `Chats${(selectedScenarioId || selectedCharacterId) ? '' : ' (all)'}`, null, null)}
          <input type="text" class="chat-search" placeholder="Search…" value=${chatFilter}
            onInput=${(e) => setChatFilter(e.target.value)}
            style=${{ margin: '0 0 6px', padding: '3px 8px', fontSize: '13px' }} />
          ${shownChats.length === 0 && chatQuery
            && html`<div class="hint" style=${{ padding: '0 6px' }}>No chats match.</div>`}
          ${shownChats.length === 0 && !chatQuery && !sideCollapsed.chats && html`<div class="hint" style=${{ padding: '0 6px' }}>No chats yet. Use ✉\uFE0E on a scenario or character.</div>`}
          ${shownChats.map(c => html`
            <div class="side-item chat ${c.id === selectedChatId ? 'selected' : ''}" key=${c.id}
              onClick=${() => {
                // A long-press already opened the context menu — don't also
                // switch the chat out from underneath it.
                if (lpMenuRef.current) { lpMenuRef.current = false; return; }
                onSelectChat(c.id);
              }}
              onContextMenu=${(e) => { e.preventDefault(); onChatContextMenu(c.id, e.clientX, e.clientY); }}
              onPointerDown=${(e) => lpStart(e, c.id)}
              onPointerMove=${lpCancel} onPointerUp=${lpCancel} onPointerCancel=${lpCancel}>
              <span class="name">${c.name}${chatMatches?.get(c.id)?.excerpt
                && html`<span class="chat-match">${chatMatches.get(c.id).excerpt}</span>`}</span>
              <span class="tools">
                <span class="tools-full">
                  <button class="btn small ghost" title="Chat panel (options / inspector / memory)"
                    onClick=${(e) => act(e, c.id, 'inspector')}>▦</button>
                  <button class="btn small ghost" title="Rename"
                    onClick=${(e) => act(e, c.id, 'rename')}>✎</button>
                  <button class="btn small ghost" title="Export JSON"
                    onClick=${(e) => act(e, c.id, 'export')}>⤓</button>
                  <button class="btn small ghost" title="Delete chat"
                    onClick=${(e) => act(e, c.id, 'delete')}>✕</button>
                </span>
                <button class="btn small ghost tools-menu" title="Chat actions"
                  onClick=${(e) => { e.stopPropagation(); onChatContextMenu(c.id, e.clientX, e.clientY); }}>⋯</button>
              </span>
            </div>`)}
        </div>
      </div>
      <div class="foot">
        <button class="btn small ghost" onClick=${onImport}>Import</button>
        <button class="btn small ghost" title="Personas" onClick=${onOpenPersonas}>Personas</button>
        <button class="btn small ghost" onClick=${onOpenSettings}>Settings</button>
        <span class="hint storage-hint ${saveRetrying ? 'warn' : ''}"
          title=${saveRetrying
            ? 'Some edits could not be saved (server unreachable) — they are queued and retried automatically.'
            : storageKind === 'server'
              ? 'Scenarios, personas, characters and chats are stored on this server (shared).'
              : 'Data is stored locally in this browser.'}>
          ${saveRetrying ? '⚠\uFE0E saving…' : storageKind === 'server' ? 'server' : 'local'}</span>
        <span class="hint version" title="FictionPad version">v${APP_VERSION}</span>
      </div>
      ${!collapsed && html`<div class="pane-handle right" title="Drag to resize · double-click to reset"
        onPointerDown=${(e) => { e.preventDefault(); onDragStart(e.clientX); }}
        onDoubleClick=${onResetWidth} />`}
    </div>`;
}
// ============================================================================
// COMPONENTS: NEW CHAT MODAL (scenario or global character → pick persona)
// ============================================================================
function NewChatModal({ scenario, character, personas, initialPersonaId, onCreate, onClose }) {
  const list = Object.values(personas).sort((a, b) => a.name.localeCompare(b.name));
  // Preselect the default/last-used persona when one is passed in — the
  // inline name field still applies once the user selects "— none —".
  const [personaId, setPersonaId] = useState(initialPersonaId ?? '');
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
        : html`<button key=${i} class="ctx-item ${it.danger ? 'danger' : ''}" disabled=${!!it.disabled}
            onClick=${() => { if (it.disabled) return; onClose(); it.fn(); }}>${it.label}</button>`)}
    </div>`;
}

// ============================================================================
// COMPONENTS: CHAT PANEL — the former right pane as a tabbed modal sheet
// (Inspector / Samplers / Memory / Chat). Centered dialog on desktop, full-screen sheet
// on phones (CSS .modal.sheet).
// ============================================================================
const PANEL_TABS = { inspector: 'Inspector', samplers: 'Samplers', memory: 'Memory', chat: 'Chat' };

// Shared tab body for ChatPanelModal and RightDrawer — same tab branches,
// same props. Without a chat, only the drawer can be open, and it shows a hint.
function PanelBody({ chat, tab, manifest, realCounts, onPreview, auxLog, personas, scenario, characters,
                    onUpdateChat, onSummarize, summarizing, onExport, onDelete, dateFormat, memoryEvery, cap,
                    settings, onUpdateSettings, onGenerate }) {
  return html`
    <div class="pbody">
      ${!chat && html`<div class="hint">Select a chat to inspect its context and memories.</div>`}
      ${chat && tab === 'inspector' && html`
        <${ContextInspector} manifest=${manifest} hasChat=${true} onPreview=${onPreview} realCounts=${realCounts} auxLog=${auxLog} />`}
      ${chat && tab === 'samplers' && html`
        <${ChatSamplers} chat=${chat} settings=${settings} onUpdateChat=${onUpdateChat} onUpdateSettings=${onUpdateSettings} />`}
      ${chat && tab === 'memory' && html`
        <${MemoryPanel} chat=${chat} onUpdateChat=${onUpdateChat} onSummarize=${onSummarize} summarizing=${summarizing} dateFormat=${dateFormat} memoryEvery=${memoryEvery} cap=${cap} />`}
      ${chat && tab === 'chat' && html`
        <${ChatOptions} chat=${chat} personas=${personas} scenario=${scenario} characters=${characters}
          onUpdateChat=${onUpdateChat} onExport=${onExport} onDelete=${onDelete} onGenerate=${onGenerate} />`}
    </div>`;
}

function ChatPanelModal({ chat, tab, onTab, manifest, realCounts, onPreview, auxLog, personas, scenario, characters,
                         onUpdateChat, onSummarize, summarizing, onExport, onDelete, onClose, dateFormat, memoryEvery, cap,
                         settings, onUpdateSettings, onGenerate }) {
  return html`
    <${Modal} title=${chat.name} cls="sheet" onClose=${onClose}>
      <div class="ptabs">
        ${Object.entries(PANEL_TABS).map(([t, label]) => html`
          <button key=${t} class=${tab === t ? 'active' : ''} onClick=${() => onTab(t)}>${label}</button>`)}
      </div>
      <${PanelBody} chat=${chat} tab=${tab} manifest=${manifest} realCounts=${realCounts} onPreview=${onPreview}
        auxLog=${auxLog} personas=${personas} scenario=${scenario} characters=${characters}
        onUpdateChat=${onUpdateChat} onSummarize=${onSummarize} summarizing=${summarizing}
        onExport=${onExport} onDelete=${onDelete} dateFormat=${dateFormat} memoryEvery=${memoryEvery} cap=${cap}
        settings=${settings} onUpdateSettings=${onUpdateSettings} onGenerate=${onGenerate} />
    <//>`;
}

// ============================================================================
// COMPONENTS: RIGHT DRAWER — docked Inspector/Memory/Chat pane (the per-chat
// modal above remains for chat-row/context-menu entry). Fixed overlay on the
// right like the left sidebar, drag-resizable on desktop, slide-in overlay on
// phones.
// ============================================================================
function RightDrawer({ chat, tab, onTab, manifest, realCounts, onPreview, auxLog,
                      personas, scenario, characters, onExport, onDelete,
                      onUpdateChat, onSummarize, summarizing,
                      width, onDragStart, onResetWidth, onClose, dateFormat, memoryEvery, cap,
                      settings, onUpdateSettings, peek, peekLeave, onGenerate }) {
  return html`
    <div class="drawer ${tab ? '' : 'collapsed'} ${tab && width < PANE_NARROW ? 'narrow' : ''} ${peek ? 'peek' : ''}"
      style=${{ width: tab ? width : 0, minWidth: tab ? width : 0 }}
      onPointerLeave=${peekLeave}>
      <div class="head">
        <div class="ptabs">
          ${Object.entries(PANEL_TABS).map(([t, label]) => html`
            <button key=${t} class=${tab === t ? 'active' : ''} title=${label} onClick=${() => onTab(t)}>${label}</button>`)}
        </div>
        <button class="btn small ghost" title="Close panel" onClick=${onClose}>✕</button>
      </div>
      <${PanelBody} chat=${chat} tab=${tab} manifest=${manifest} realCounts=${realCounts} onPreview=${onPreview}
        auxLog=${auxLog} personas=${personas} scenario=${scenario} characters=${characters}
        onUpdateChat=${onUpdateChat} onSummarize=${onSummarize} summarizing=${summarizing}
        onExport=${onExport} onDelete=${onDelete} dateFormat=${dateFormat} memoryEvery=${memoryEvery} cap=${cap}
        settings=${settings} onUpdateSettings=${onUpdateSettings} onGenerate=${onGenerate} />
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
    color: '', // speaker-name colour override (hex); '' = auto (hashed from the name)
    greeting: '', // first assistant message of chats started directly with this character
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

function CharacterEditor({ character, scenarios, chatLinkCount = 0, onUpsert, onClose, onGenerate }) {
  const [editing, setEditing] = useState(() => character ? deepClone(character) : newCharacter());
  const [dirty, setDirty] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState(null);
  const edit = (next) => { setDirty(true); setEditing(next); };
  const guardClose = () => { if (!dirty || confirm('Discard unsaved changes?')) onClose(); };
  const runGenerate = async (promptText) => {
    setGenBusy(true); setGenError(null);
    try {
      const patch = await onGenerate('character', promptText, editing);
      edit({ ...editing, ...patch });
      setGenOpen(false);
    } catch (e) { setGenError(e?.message ?? String(e)); }
    finally { setGenBusy(false); }
  };
  const linkCount = (id) => Object.values(scenarios).filter(s => (s.characterIds ?? []).includes(id)).length;
  const totalLinks = linkCount(editing.id) + chatLinkCount;
  return html`
    <${Modal} title=${character ? `Character — ${character.name}` : 'New character'} wide
      onClose=${genOpen ? () => setGenOpen(false) : guardClose}
      footer=${html`${onGenerate && html`<button class="btn" onClick=${() => { setGenError(null); setGenOpen(true); }}>✦ Generate</button>`}
        <button class="btn primary" disabled=${!editing.name.trim()}
          onClick=${() => { onUpsert(editing.id, { ...editing, updatedAt: Date.now() }); onClose(); }}>Save character</button>`}>
      <label class="field"><span>Name — speaker name; also the default trigger key</span>
        <input type="text" value=${editing.name} onInput=${(e) => edit({ ...editing, name: e.target.value })} /></label>
      <div class="field"><span>Name colour — for the speaker name in chats; empty = auto (hashed from the name)</span>
        <div style=${{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input type="color" value=${editing.color || '#8ab4f8'}
            onInput=${(e) => edit({ ...editing, color: e.target.value })}
            style=${{ width: '40px', height: '28px', padding: '0 2px' }} />
          ${editing.color
            ? html`<button class="btn small" onClick=${() => edit({ ...editing, color: '' })}>Clear — back to auto</button>`
            : html`<span class="hint">auto — pick a colour to override</span>`}
        </div>
      </div>
      <label class="field"><span>Character card — sent to the AI when active. {{user}} works here.</span>
        <textarea rows=${6} value=${editing.content} onInput=${(e) => edit({ ...editing, content: e.target.value })} /></label>
      <label class="field"><span>Trigger keys — one per line, regex; blank = the character's name</span>
        <${ListInput} textarea=${true} delim=${'\n'} rows=${3} values=${editing.keys}
          onChange=${(keys) => edit({ ...editing, keys })} /></label>
      <label class="field"><span>Greeting — first message of chats started directly with this character. Prefix lines with a character's name (Mia:) to show them as that character's bubble; Narrator: resumes narration.</span>
        <textarea rows=${4} value=${editing.greeting ?? ''}
          onInput=${(e) => edit({ ...editing, greeting: e.target.value })} /></label>
      <div class="grid2">
        <label class="field"><span>Weight — higher wins when the lore budget is tight</span>
          <${NumInput} value=${editing.weight ?? 0} step=${1} fallback=${0}
            onCommit=${(n) => edit({ ...editing, weight: n })} /></label>
        <div class="field"><span>Activation</span>
          <label class="check" title="Always injected while linked">
            <input type="checkbox" checked=${!!editing.pinned}
              onChange=${(e) => edit({ ...editing, pinned: e.target.checked })} /> pinned</label>
          <label class="check" title="Semantic activation — the embedding model (Settings → Models) injects this card when similar to the recent conversation; no keyword needed">
            <input type="checkbox" checked=${!!editing.smart}
              onChange=${(e) => edit({ ...editing, smart: e.target.checked })} /> semantic</label>
          <label class="check">
            <input type="checkbox" checked=${editing.enabled !== false}
              onChange=${(e) => edit({ ...editing, enabled: e.target.checked })} /> enabled</label>
        </div>
      </div>
      ${totalLinks > 0 && html`
        <div class="hint">Linked into ${linkCount(editing.id)} scenario(s) and ${chatLinkCount} chat(s) — card edits apply live. The greeting is snapshotted per chat at creation, so greeting edits only affect new chats.</div>`}
      ${genOpen && html`
        <${GeneratorModal} title="Generate character" busy=${genBusy} error=${genError}
          onGenerate=${runGenerate} onClose=${() => setGenOpen(false)} />`}
    <//>`;
}
// ============================================================================
// COMPONENTS: GENERATOR — ✦ Generate in the scenario/character editors. One
// aux call turns a free-text request (+ the current draft as context) into a
// full JSON draft, sanitized here and applied to the editor's local draft —
// the user reviews and saves through the editor's normal flow. The prompt
// text lives in settings (scenarioGenPrompt / characterGenPrompt); the call
// itself is wired in Main (runGen), which owns settings + the aux log.
// ============================================================================

// Tolerant reply parsing, same style as the lore-extraction pass: grab the
// first { to the last } (skips ```json fences / chatter) and require a plain
// object. Returns null on any mismatch — the caller shows a retry-able error.
function extractGenJSON(out) {
  const m = String(out ?? '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
  } catch { return null; }
}

const GEN_NAME_MAX = 100;
const GEN_META_MAX = 300;   // description
const GEN_FIELD_MAX = 8000; // scenarioInstructions / backstory / greeting / card content
const GEN_PIECE_CAP = 20;   // lore pieces per generated scenario

const genStr = (v, max) => {
  const s = String(v ?? '').trim().slice(0, max);
  return s || null; // empty fields never enter the patch — they can't wipe the draft
};
const genKeys = (v) => (Array.isArray(v) ? v : [])
  .map(k => String(k).trim()).filter(k => k.length >= MIN_KEY_LENGTH).slice(0, 5);

// One model-shaped piece → canonical fields (title/content capped, keys
// filtered, type whitelisted). Shared by the scenario sanitizer (fresh ids
// minted on top) and the single-piece sanitizer.
const sanitizeGenPiece = (p) => ({
  type: p?.type === 'character' ? 'character' : 'lore',
  title: String(p?.title ?? '').trim().slice(0, TOOL_NAME_MAX),
  content: String(p?.content ?? '').trim().slice(0, TOOL_TEXT_MAX),
  keys: genKeys(p?.keys),
  pinned: p?.pinned === true,
});

// Only fields present (and non-empty) in the model's reply land in the patch;
// everything else keeps the draft's current value.
function sanitizeScenarioGen(obj) {
  const patch = {};
  for (const [key, max] of [['name', GEN_NAME_MAX], ['description', GEN_META_MAX],
      ['scenarioInstructions', GEN_FIELD_MAX], ['backstory', GEN_FIELD_MAX], ['greeting', GEN_FIELD_MAX]]) {
    const s = genStr(obj[key], max);
    if (s) patch[key] = s;
  }
  if (Array.isArray(obj.tags))
    patch.tags = obj.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 10);
  if (Array.isArray(obj.lorePieces))
    patch.lorePieces = obj.lorePieces.slice(0, GEN_PIECE_CAP)
      .map(p => ({ ...newLorePiece(), ...sanitizeGenPiece(p) })) // fresh id + flag defaults
      .filter(p => p.title && p.content);
  return patch;
}

// Single lore piece (✦ on a scenario-editor card or the chat piece editor
// popout). Same no-wipe rule, and no id — the piece keeps its identity (and,
// for chat pieces, its createdBy/atLen provenance for rewind rollback).
function sanitizePieceGen(obj) {
  const p = sanitizeGenPiece(obj);
  const patch = {};
  if (p.title) patch.title = p.title;
  if (p.content) patch.content = p.content;
  if (Array.isArray(obj?.keys)) patch.keys = p.keys;
  if (typeof obj?.pinned === 'boolean') patch.pinned = p.pinned;
  if (obj?.type === 'character' || obj?.type === 'lore') patch.type = p.type;
  return patch;
}

function sanitizeCharacterGen(obj) {
  const patch = {};
  for (const [key, max] of [['name', GEN_NAME_MAX], ['content', GEN_FIELD_MAX], ['greeting', GEN_FIELD_MAX]]) {
    const s = genStr(obj[key], max);
    if (s) patch[key] = s;
  }
  if (Array.isArray(obj.keys)) patch.keys = genKeys(obj.keys);
  // Optional speaker-name colour override — hex only, anything else dropped.
  const col = String(obj.color ?? '').trim();
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(col)) patch.color = col.toLowerCase();
  return patch;
}

// Small nested modal over the editor. The editor owns busy/error state and
// the apply step; this is just the request box. While it's open the editor
// below inert-swallows its own close gestures (see the editors' onClose).
function GeneratorModal({ title, busy, error, onGenerate, onClose }) {
  const [promptText, setPromptText] = useState('');
  return html`
    <${Modal} title=${title} onClose=${() => { if (!busy) onClose(); }}
      footer=${html`<button class="btn ghost" disabled=${busy} onClick=${onClose}>Cancel</button>
        <button class="btn primary" disabled=${busy || !promptText.trim()} onClick=${() => onGenerate(promptText)}>
          ${busy ? 'Generating…' : '✦ Generate'}</button>`}>
      <label class="field"><span>Describe what you want — the current draft is sent as context, so you can also ask for changes ("add a rival for Mia", "make it darker")</span>
        <textarea rows=${4} value=${promptText} onInput=${(e) => setPromptText(e.target.value)} /></label>
      ${error && html`<div class="warn">${error}</div>`}
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

// Full system-prompt head: platform prompt + enabled feature prompts (multi-
// speaker, tool calling). Shared by runGeneration and the inspector preview
// so both count exactly what a generation would send.
function buildPlatformPrompt(st) {
  return [
    st.platformPrompt,
    ...(st.multiSpeaker !== false ? [(st.speakerPrompt ?? '').trim() || SPEAKER_PROMPT] : []),
    ...(st.toolsEnabled !== false ? [(st.toolsPrompt ?? '').trim() || TOOLS_PROMPT] : []),
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
  // locally on download. apiKey syncs with the rest (single-user convenience).
  // localStorage remains the offline cache/fallback.
  const SETTINGS_SYNC_KEY = 'app.settings';
  const settingsSync = useRef({ adopted: false, lastWritten: null });
  useEffect(() => { // adopt the server copy once at boot
    if (storageKind !== 'server') return;
    const remote = storage.get('Meta', SETTINGS_SYNC_KEY);
    if (remote && typeof remote === 'object') {
      // serverToken is per-device — never adopted from the server. apiKey syncs
      // like any other setting; fall back to the local copy if the server has none yet.
      setSettings(prev => ({ ...remote, serverToken: prev?.serverToken ?? '', apiKey: remote.apiKey ?? prev?.apiKey ?? '' }));
      // Skip the pre-adoption upload: the write effect fires in this same
      // commit with the *local* settings — don't let them clobber the server.
      settingsSync.current.lastWritten = settingsRaw;
    }
    settingsSync.current.adopted = true;
  }, [storageKind]);
  useEffect(() => { // upload on every change (serverToken stripped; first boot seeds it)
    if (storageKind !== 'server' || !settingsSync.current.adopted) return;
    if (settingsSync.current.lastWritten === settingsRaw) return;
    settingsSync.current.lastWritten = settingsRaw;
    const { serverToken, ...rest } = settingsRaw ?? {};
    storage.set('Meta', SETTINGS_SYNC_KEY, rest);
  }, [settingsRaw, storageKind]);
  const [ui, setUi] = usePersistentState('fictionpad.ui', { scenarioId: null, chatId: null, drawer: null, sidebarCollapsed: false });
  const [theme, setTheme] = usePersistentState('fictionpad.theme', 'defaultTheme');
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
  // Unsaved Settings draft, handed up when the modal detours into the logit-
  // bias editor — closing that editor returns to Settings with the draft
  // restored instead of silently losing it.
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [generating, setGenerating] = useState(null); // { chatId, nodeId }
  const [summarizing, setSummarizing] = useState(false);
  const [suggestions, setSuggestions] = useState(null); // { chatId, nodeId, swipe, loading, items } | null
  const [composerInject, setComposerInject] = useState(null); // { text?, hint?, nonce }
  const [auxBusy, setAuxBusy] = useState([]); // kinds of in-flight aux calls ('improve', 'generate', …)
  const auxCtls = useRef(new Set()); // AbortControllers of in-flight aux calls — Stop aborts them all
  const [error, setError] = useState(null);
  const genRef = useRef(null); // { abort }

  // Aux-call observability: memory/lore-extract/suggestions//improve//recap are
  // separate requests that never touch the main context, so the manifest can't
  // show them. Keep a short session log (last 12) of what was sent and what
  // came back; the Inspector renders it as its own section. Entries are tagged
  // with the chat they were for — each inspector panel filters to its own chat.
  const [auxLog, setAuxLog] = useState([]);
  async function auxLogged(kind, args, chatId = null) {
    const entry = { kind, chatId, at: Date.now(), model: args.model ?? '', system: args.system ?? '', user: args.user ?? '' };
    // Every aux call is tracked: the composer shows ■ Stop (not Send) while
    // any are in flight, so a background call never overlaps the user's next
    // generation unnoticed; Stop aborts them all via auxCtls.
    const ctl = new AbortController();
    auxCtls.current.add(ctl);
    setAuxBusy(list => [...list, kind]);
    try {
      const out = await auxCall({ ...args, signal: ctl.signal });
      setAuxLog(log => [...log.slice(-11), { ...entry, ok: true, out: out ?? '' }]);
      return out;
    } catch (e) {
      setAuxLog(log => [...log.slice(-11), { ...entry, ok: false, out: describeApiError(e) }]);
      throw e;
    } finally {
      auxCtls.current.delete(ctl);
      setAuxBusy(list => { const i = list.indexOf(kind); return i < 0 ? list : [...list.slice(0, i), ...list.slice(i + 1)]; });
    }
  }

  // ✦ Generate (scenario/character editors): one aux call turns a free-text
  // request + the current draft (context, so "add a rival for Mia" extends
  // rather than replaces) into a sanitized field patch. The editor applies it
  // to its local draft — nothing persists until the editor's own Save. Errors
  // are thrown back to the generator modal, which shows them inline.
  async function runGen(kind, promptText, draft) {
    const st = ref.current.settings;
    const model = st.genModel || st.auxModel || st.model; // generator override → aux → chat
    if (!st.endpoint || !model) throw new Error('Configure an endpoint and model in Settings first.');
    const isScenario = kind === 'scenario';
    // The RP length preset otherwise only reaches the chat assembler — aux
    // calls never see it, so pass the directive through as prose guidance
    // (the greeting is the field it matters for).
    const directive = (st.lengthDirective ?? LENGTH_PRESETS[st.responseLength ?? 'medium']?.directive)?.trim();
    const context = JSON.stringify(isScenario
      ? { name: draft.name, description: draft.description, tags: draft.tags,
          scenarioInstructions: draft.scenarioInstructions, backstory: draft.backstory, greeting: draft.greeting,
          lorePieces: (draft.lorePieces ?? []).map(({ type, title, content, keys, pinned }) => ({ type, title, content, keys, pinned })) }
      : kind === 'piece'
        ? (({ type, title, content, keys, pinned }) => ({ type, title, content, keys, pinned }))(draft)
        : { name: draft.name, content: draft.content, keys: draft.keys, greeting: draft.greeting });
    const out = await auxLogged('generate', {
      endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model,
      system: isScenario
        ? st.scenarioGenPrompt || DEFAULT_SCENARIO_GEN_PROMPT
        : kind === 'piece'
          ? st.pieceGenPrompt || DEFAULT_PIECE_GEN_PROMPT
          : st.characterGenPrompt || DEFAULT_CHARACTER_GEN_PROMPT,
      user: `Current draft (JSON — extend or change it per the request; return the complete updated object):\n${context}\n\nRequest: ${promptText}${directive ? `\n\nLength guidance for the prose fields (especially the greeting): ${directive}` : ''}`,
      maxTokens: st.genMaxTokens ?? 3000, temperature: st.genTemp ?? 0.9,
      // The generator rides the user's GLOBAL sampler set — registered
      // built-ins plus custom samplers (e.g. chat_template_kwargs.enable_thinking)
      // — filtered to registered keys like the RP path; the generator's own
      // temperature wins. Per-chat overrides don't apply outside a chat.
      samplers: { ...Object.fromEntries(
        Object.entries(enabledSamplers(st))
          .filter(([k]) => new Set(allSamplerFields(st).map(f => f.key)).has(k))),
        temperature: st.genTemp ?? 0.9 },
    });
    const obj = extractGenJSON(out);
    if (!obj) throw new Error('The model did not return valid JSON — try again or rephrase the request.');
    return isScenario ? sanitizeScenarioGen(obj) : kind === 'piece' ? sanitizePieceGen(obj) : sanitizeCharacterGen(obj);
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
    // A live generation owns this chat's swipe state — pruning here would
    // strip its in-flight (unflagged) swipe out from under the stream.
    if (generating?.chatId === c.id) return;
    const next = applyUsedSwipes(pruneInterrupted(c));
    if (next !== c) upsertChat(next.id, next);
  }, [ui.chatId]);
  const persona = chat?.personaId ? personas[chat.personaId] : null;
  const personaName = persona?.name?.trim() || 'User';
  // Memo keyed on stable identities — NOT the whole chat object, which gets a
  // fresh identity per streamed token and would defeat MessageItem's memo.
  // Names change only when the scenario, the chat's lore overlay/character
  // links, or the characters map actually change.
  const chatScenario = chat ? scenarios[chat.scenarioId] : null;
  const characterNames = useMemo(
    () => characterNamesOf(chatScenario, chat, characters),
    [chatScenario, chat?.lorePieces, chat?.characterIds, characters]);
  // Speaker-name colour overrides (global character cards with an explicit
  // colour), keyed by lowercase name — everything else falls back to the
  // name-hash hue in MessageItem.
  const characterColors = useMemo(() => Object.fromEntries(
    Object.values(characters ?? {}).filter(c => c?.color && c.name?.trim())
      .map(c => [c.name.trim().toLowerCase(), c.color])), [characters]);
  const sidebarCollapsed = ui.sidebarCollapsed ?? (window.innerWidth <= 700); // phones start with the drawer closed
  const toggleSidebar = () => { setPeek(null); setUi(u => ({ ...u, sidebarCollapsed: !sidebarCollapsed })); };
  // Right drawer: ui.drawer is the open tab ('inspector' | 'samplers' | 'memory' | 'chat') or null.
  const toggleDrawer = (tab) => { setPeek(null); setUi(u => ({ ...u, drawer: u.drawer === tab ? null : tab })); };
  const closeDrawer = () => { setPeek(null); setUi(u => (u.drawer ? { ...u, drawer: null } : u)); };
  const lastDrawerTabRef = useRef('inspector'); // edge-swipe reopens the last-used tab
  if (ui.drawer) lastDrawerTabRef.current = ui.drawer;
  // Desktop edge-hover peek (settings.edgePeek, default on): hovering a thin
  // strip at the screen edge pops the collapsed pane out as a TEMPORARY
  // overlay — no ui.* state changes, pointer-leave closes it, and any real
  // toggle (above) pins/unpins as usual. A short entry delay keeps stray
  // mouse sweeps past the edge from flashing the pane.
  const [peek, setPeek] = useState(null); // 'left' | 'right' | null
  const [peekTab, setPeekTab] = useState(null); // tab chosen inside a drawer peek — session-only, never pins
  const peekTimer = useRef(null);
  const peekEnter = (side) => (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek(side), 90);
  };
  const peekCancel = () => clearTimeout(peekTimer.current);
  // Shallow settings patch (e.g. samplers from the panel's Samplers tab).
  const updateSettings = (patch) => setSettings(prev => ({ ...(prev ?? {}), ...patch }));
  // touch:false for pure metadata edits (rename, options) — the sidebar sorts
  // by updatedAt, and a rename shouldn't teleport the chat to the top.
  const saveChat = useCallback((c, { touch = true } = {}) =>
    upsertChat(c.id, touch ? { ...c, updatedAt: Date.now() } : c), [upsertChat]);

  // Writes that failed to persist and are queued for retry (Task: never drop).
  // failed = non-null once the storage layer gives up (quota / repeated
  // failure) — surfaced as a persistent banner.
  const [saveRetrying, setSaveRetrying] = useState(false);
  const [saveFailed, setSaveFailed] = useState(null);
  useEffect(() => {
    const on = (e) => { setSaveRetrying(!!e.detail?.retrying); setSaveFailed(e.detail?.failed ?? null); };
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
  // Edge-hover peek is desktop-only; a peek never changes the persisted pane
  // state and must not shift the center column (sbW/dwW stay at their real
  // values — the peeked pane is a pure overlay).
  const peekLeft = peek === 'left' && sidebarCollapsed && !isMobile && settings.edgePeek !== false;
  const peekRight = peek === 'right' && !ui.drawer && !isMobile && settings.edgePeek !== false;
  useEffect(() => { if (isMobile || settings.edgePeek === false) setPeek(null); }, [isMobile, settings.edgePeek]);
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
      } else {
        // A pane is open: swipe-shut starts only on the pane CHROME — the pane
        // element itself, its head, the resize handle, empty scroll-container
        // padding, or the scrim. Starting on scrollable CONTENT or a control
        // must not close the pane (a horizontal scroll of a wide inspector
        // table is not a "close" gesture).
        const pane = e.target.closest?.('.sidebar, .drawer');
        const scrollBox = e.target.closest?.('.scroll, .pbody');
        const onChrome = e.target.closest?.('.scrim')
          || (pane && (e.target === pane || e.target === scrollBox))
          || (pane && e.target.closest?.('.head, .pane-handle') && !e.target.closest?.('button, input, select, textarea, a'));
        if (onChrome) g = { id: e.pointerId, x: e.clientX, y: e.clientY };
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
        if (name?.trim()) saveChat({ ...c, name: name.trim() }, { touch: false });
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
      system: subUser(st.memoryPrompt || DEFAULT_MEMORY_PROMPT, pName).replaceAll('{{chars}}', String(maxChars)),
      user: `Recent conversation:\n\n${recent}\n\nMemory note (max ${maxChars} characters):`,
      maxTokens: st.memoryMaxTokens ?? 220, temperature: st.memoryTemp ?? 0.3, stop: st.stopStrings,
    }, chatObj.id);
    return out.slice(0, maxChars) || null;
  }
  // Append a memory to a chat's store, stamped with atLen (the chat's current
  // active-path message count) so rewind keeps memories by position, not
  // timestamp (see rewindChat). Stamped at creation (see addMemory).
  const pushMemory = (c, text) =>
    addMemory(c.memoryStore, text, Date.now(), ref.current.settings.memoryCap ?? MEMORY_CAP,
      getActivePath(c.messages, c.activeLeafId).length);
  async function summarizeNow(chatObj) {
    setSummarizing(true);
    try {
      const text = await generateMemory(chatObj);
      if (text) {
        // Merge-on-write: the chat may have changed (or been deleted) during
        // the aux call — re-read it and overwrite only memoryStore.
        const cur = ref.current.chats[chatObj.id];
        if (cur)
          saveChat({ ...cur, memoryStore: { ...pushMemory(cur, text),
            cursor: getActivePath(cur.messages, cur.activeLeafId).length } });
      }
    } catch (e) {
      // Degrade like lore extraction: warn and advance the cursor — a failing
      // aux endpoint must not re-banner after every generation.
      console.warn('Memory summarization failed:', e);
      const cur = ref.current.chats[chatObj.id];
      if (cur)
        saveChat({ ...cur, memoryStore: { ...(cur.memoryStore ?? { memories: [], cursor: 0 }),
          cursor: getActivePath(cur.messages, cur.activeLeafId).length } });
    } finally {
      setSummarizing(false);
    }
  }
  function maybeSummarize(chatObj) {
    const every = ref.current.settings.memoryEvery ?? MEMORY_EVERY;
    const pathLen = getActivePath(chatObj.messages, chatObj.activeLeafId).length;
    if (pathLen - (chatObj.memoryStore?.cursor ?? 0) >= every) summarizeNow(chatObj);
  }

  // ---- emergent lore extraction ----
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
    // Merge-on-write: re-read the chat at save time (a generation may have
    // advanced it during the aux call) and apply the lore changes to the
    // CURRENT object, so only lorePieces/loreQueue/emergentCursor are
    // overwritten. Chat deleted mid-call → drop the write.
    const advance = (fn) => {
      const cur = ref.current.chats[chatObj.id];
      if (cur) saveChat({ ...fn(cur), emergentCursor: pathLen });
    };
    const pName = (chatObj.personaId && pe[chatObj.personaId]?.name?.trim()) || 'User';
    const recent = path.slice(-every)
      .map(n => `${n.role === 'user' ? pName : 'Narrator'}: ${subUser(activeText(n), pName)}`)
      .join('\n\n');
    if (!recent.trim()) return;
    const titles = mergedLorePieces(scen, chatObj, ref.current.characters).map(p => (p.title ?? '').trim()).filter(Boolean);
    try {
      const out = await auxLogged('lore-extract', {
        endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model,
        system: (st.loreExtractPrompt || DEFAULT_LORE_EXTRACT_PROMPT)
          .replaceAll('{{max}}', String(Math.max(1, st.loreExtractMax ?? 3))),
        user: `Existing lore: ${titles.join(', ') || '(none)'}\n\nRecent conversation:\n\n${recent}\n\nJSON array:`,
        maxTokens: st.loreExtractMaxTokens ?? 400, temperature: st.loreExtractTemp ?? 0.3, stop: st.stopStrings,
      }, chatObj.id);
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
        advance((cur) => {
          let work = cur;
          if (mode === 'auto') {
            work = applyToolCalls(work, fresh.map(p => ({ name: 'add_lore', args: p })),
              { now: Date.now(), atLen: pathLen }).chat;
          } else {
            for (const p of fresh) work = queueLorePiece(work, { ...p, source: 'extract', atLen: pathLen });
          }
          return work;
        });
        return;
      }
      advance((c) => c);
    } catch (e) {
      console.warn('Emergent lore extraction failed:', e);
      advance((c) => c);
    }
  }

  // ---- character enrichment (experimental, settings.toolsEnrich) ----
  // Newly tool-registered characters get fleshed out by the ✦ generator
  // ('piece' kind) — one aux call per new character, all concurrent, after
  // the generation completes. Only CONTENT is rewritten and keys are merged;
  // the title is never touched — the registered name is the speaker-matching
  // key and must not drift. Failures keep the original description.
  async function maybeEnrichCharacters(chatObj, nodeId, toolResults) {
    const fresh = (toolResults ?? []).filter(r => r.name === 'register_character' && r.ok
      && String(r.note ?? '').startsWith('registered character'));
    await Promise.all(fresh.map(async (r) => {
      const name = String(r.args?.name ?? '').trim();
      if (!name) return;
      const piece = ((ref.current.chats[chatObj.id]?.lorePieces) ?? []).find(p => p.createdBy === nodeId
        && p.type === 'character' && (p.title ?? '').trim().toLowerCase() === name.toLowerCase());
      if (!piece) return; // rewound/pruned meanwhile
      try {
        const patch = await runGen('piece',
          'Flesh out this newly introduced character into a full reference card — appearance, personality, motives, voice. Keep the name and their role in the scene recognizable.',
          { type: 'character', title: piece.title, content: piece.content, keys: piece.keys, pinned: piece.pinned });
        // Merge-on-write: re-read at save time; drop the write if the chat or
        // piece vanished (rewind, delete) in between.
        const cur = ref.current.chats[chatObj.id];
        if (!cur || !(cur.lorePieces ?? []).some(p => p.id === piece.id)) return;
        const next = { ...cur, lorePieces: cur.lorePieces.map(p => p.id === piece.id
          ? { ...p, ...(patch.content ? { content: patch.content } : {}),
              keys: [...new Set([...(p.keys ?? []), ...(patch.keys ?? [])])].slice(0, 5) }
          : p) };
        // touch:false — a background lore write shouldn't re-sort the sidebar.
        // Sync ref immediately (same reason as commit() in the generation
        // finally): React flushes the write later, so a sibling enrichment or
        // the next generation's commit() reading ref.current.chats in between
        // would rebuild from the pre-enrichment snapshot and drop this write.
        saveChat(next, { touch: false });
        ref.current.chats = { ...ref.current.chats, [chatObj.id]: next };
      } catch (e) { console.warn(`Character enrichment failed for "${name}":`, e); }
    }));
  }

  // ---- generation ----
  async function runGeneration(chatObj, nodeId, { continuation = false, fresh = false, pov = null } = {}) {
    const { scenarios: sc, personas: pe, characters: gchars, settings: baseSt } = ref.current;
    const model = chatObj.settings?.model || baseSt.model; // per-chat override wins
    if (!baseSt.endpoint || !model) { setError('Configure an endpoint and chat model in Settings first.'); return; }
    // Per-chat generation overrides (panel's Samplers tab): context length and
    // max tokens shadow the globals for this chat's generations. The globals
    // themselves are auto-resolved from the detected model context unless the
    // user pinned them (ctxAuto / reserveAuto).
    const auto = resolveLimits(baseSt, model);
    const st = { ...baseSt,
      contextLength: chatObj.settings?.contextLength ?? auto.contextLength,
      maxTokens: chatObj.settings?.maxTokens ?? auto.maxTokens };
    const genStart = Date.now(); // for swipe.genMs (prompt-to-completion time)
    const scen = sc[chatObj.scenarioId];
    const pers = chatObj.personaId ? pe[chatObj.personaId] : null;
    const node = chatObj.messages[nodeId];
    // Leaf regenerate: roll back tool pieces the replaced swipe created BEFORE
    // generating — the new take must be written against the rolled-back state
    // (pruning afterwards would rip context out from under the swipe that was
    // just generated with the piece in its prompt). Stashed so a generation
    // that produces nothing can restore them (discardEmptySwipe).
    let prunedTools = null;
    if (!fresh && !continuation && node
        && !Object.values(chatObj.messages).some(m => m.parentId === nodeId)) {
      const pruned = pruneToolPieces(chatObj, nodeId);
      // pruneToolPieces no-ops by returning the chat as-is — and a chat whose
      // tools never wrote lore has no lorePieces array at all, so both sides
      // of the comparison need the null-safe read.
      if ((pruned.lorePieces?.length ?? 0) !== (chatObj.lorePieces?.length ?? 0)) {
        prunedTools = (chatObj.lorePieces ?? []).filter(p => p?.createdBy === nodeId);
        chatObj = { ...pruned, updatedAt: Date.now() };
        upsertChat(chatObj.id, chatObj);
        ref.current.chats = { ...ref.current.chats, [chatObj.id]: chatObj };
      }
    }
    // Claim the generation slot before anything async (the prep below —
    // semantic embeddings, exact token count — can take a long time on a slow
    // backend, and the UI keys off this). Deliberately AFTER the synchronous
    // rollback above: a throw there must not leak the claimed slot.
    const abort = new AbortController();
    genRef.current = { abort };
    setGenerating({ chatId: chatObj.id, nodeId });
    // The node being generated is excluded from the prompt unless continuing it.
    // NB: not `??` — the root's parentId is null, and null MUST survive: for a
    // greeting regenerate the path is empty (system prompt only), so the model
    // writes a fresh opening instead of continuing the whole conversation and
    // storing that continuation as a greeting swipe.
    const promptChat = continuation ? chatObj : { ...chatObj, activeLeafId: node ? node.parentId : chatObj.activeLeafId };
    // Semantic lore activation (async, outside the pure assembler): embed the
    // recent conversation + smart pieces, threshold → preActivated id set.
    // Scores for every scored piece go on the manifest so the Inspector can
    // show near-misses. Any embeddings failure degrades to keyword-only with
    // a manifest warning.
    let preActivated = null;
    let semanticWarning = null;
    let semanticReport = null;
    const semThreshold = typeof st.semanticThreshold === 'number' ? st.semanticThreshold : SEMANTIC_THRESHOLD;
    // All of prep runs outside the stream's try/finally below: a throw here
    // (hostile imported data reaching mergedLorePieces/assemblePrompt) must
    // still release the generation slot and drop the empty swipe, or the UI
    // wedges in "generating" until reload. Handled at the abort check below.
    let prepError = null;
    let messages = null, man = null; // declared outside the prep try — used by the stream below
    try {
    if (st.embeddingModel) {
      const smartPieces = mergedLorePieces(scen, chatObj, gchars).filter(p => p && p.enabled !== false && !p.pinned && p.smart);
      const queryText = getActivePath(promptChat.messages, promptChat.activeLeafId)
        .map(activeText).join('\n').slice(-1500);
      if (smartPieces.length && queryText.trim()) {
        try {
          const [queryVec] = await embed({ endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model: st.embeddingModel, inputs: [queryText], signal: abort.signal });
          const vecs = await Promise.all(smartPieces.map(p =>
            embedCached({ endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model: st.embeddingModel,
              text: `${p.title ?? ''}\n${(p.content ?? '').slice(0, 500)}`, signal: abort.signal })));
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
    ({ messages, manifest: man } = assemblePrompt({
      scenario: scen, persona: pers, chat: promptChat, settings: st,
      platformPrompt: buildPlatformPrompt(st),
      preActivated, pov, characters: gchars,
    }));
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
            text: head.map(m => m.content).join('\n'), signal: abort.signal })
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
    } catch (e) { prepError = e; }
    // (Abort-during-prep check lives just before the stream loop, after
    // discardEmptySwipe is defined — Stop during prep must not leak the
    // empty swipe/fresh node the caller already created.)
    // Logit bias: OpenAI shape {token_id: bias}, first token of each entry.
    const logitBias = {};
    for (const e of Object.values(st.logitBias ?? {})) {
      const id = e?.ids?.[0];
      if (Number.isInteger(id)) logitBias[String(id)] = Math.max(-100, Math.min(100, e.power));
    }
    // Effective samplers: per-chat overrides win; only registered params
    // (built-ins + customSamplers) are ever sent — a removed custom def can't
    // leak a stale key upstream. Disabled globals keep their values but are
    // not sent (enabledSamplers); a per-chat override can still force one.
    const allowedSamplerKeys = new Set(allSamplerFields(st).map(f => f.key));
    const effSamplers = Object.fromEntries(
      Object.entries({ ...enabledSamplers(st), ...(chatObj.settings?.samplers ?? {}) })
        .filter(([k]) => allowedSamplerKeys.has(k)));
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
    // Reasoning channel (delta.reasoning_content) accumulates separately and
    // lands on the swipe as `think` — displayed collapsibly, never prompted.
    // Continuations prepend the base swipe's reasoning like its text.
    let thinkAcc = continuation ? (node?.swipes?.[node.activeSwipe]?.think ?? '') : '';
    const lpTape = [];
    // Tool replies: the RAW accumulated text and its raw→stripped char map
    // (set when tool blocks were stripped) so the lp tape — which covers the
    // protocol text too — can still be aligned and projected onto the
    // stripped display text.
    let rawAcc = null, probMap = null;
    // Merge-on-write: rebuild from the CURRENT stored chat and overlay only
    // the message tree, so drawer/panel edits made mid-stream (memory pins,
    // renames, chat options) survive the per-token upserts. Chat deleted
    // mid-generation → keep accumulating locally, never write back.
    const applyText = (text, tokens) => {
      const n = work.messages[nodeId];
      if (!n) return;
      const swipes = n.swipes.slice();
      // Persisted spans cap alternatives at 5 — the tape can carry up to 20
      // and would balloon storage on every swipe. Display needs only a few.
      const capped = tokens?.map(t => t.top?.length > 5 ? { ...t, top: t.top.slice(0, 5) } : t);
      swipes[n.activeSwipe] = { ...swipes[n.activeSwipe], text, modelId: model,
        ...(thinkAcc ? { think: thinkAcc } : {}), ...(capped ? { tokens: capped } : {}) };
      const messages = { ...work.messages, [nodeId]: { ...n, swipes } };
      const cur = ref.current.chats[work.id];
      if (!cur) { work = { ...work, messages }; return; }
      work = { ...cur, messages, updatedAt: Date.now() };
      upsertChat(work.id, work);
    };
    // One global alignment pass over the finished text + raw lp tape; attaches
    // swipe.tokens when at least one span carries real prob data. Runs on
    // completion AND abort, so partial generations keep their probs.
    const attachProbs = () => {
      let spans = null;
      if (probMap && rawAcc != null)
        // stripToolBlocksMapped's map is slice-relative; rebase to absolute
        // raw-reply indices (alignStrippedToolSpans reads inv[rawOffset + i]).
        spans = alignStrippedToolSpans(rawAcc.slice(baseText.length), lpTape,
          probMap.map.map(j => j + baseText.length), baseText.length, acc.slice(baseText.length));
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
      const cur = ref.current.chats[work.id];
      if (!cur) return; // chat deleted mid-generation — never resurrect it
      // The generation produced nothing — restore any tool pieces rolled back
      // before it started, or a failed/empty retry would destroy the replaced
      // take's effects while the take itself survives.
      let base = cur;
      if (prunedTools?.length) {
        const missing = prunedTools.filter(p => !(cur.lorePieces ?? []).some(q => q.id === p.id));
        if (missing.length) base = { ...cur, lorePieces: [...(cur.lorePieces ?? []), ...missing] };
      }
      if (n.swipes.length > 1) {
        const swipes = n.swipes.slice(0, -1);
        work = { ...base, messages: { ...work.messages, [nodeId]: { ...n, swipes, activeSwipe: swipes.length - 1 } }, updatedAt: Date.now() };
        upsertChat(work.id, work);
      } else if (fresh) {
        const messages = { ...work.messages };
        delete messages[nodeId];
        work = { ...base, messages, activeLeafId: n.parentId, updatedAt: Date.now() };
        upsertChat(work.id, work);
      }
    };
    // Stopped during the async prep (embeddings/tokenize)? Bail before
    // streaming — and discard the empty swipe/fresh node the caller already
    // created, or Stop during prep leaks it into the tree.
    if (abort.signal.aborted) { discardEmptySwipe(); genRef.current = null; setGenerating(null); return; }
    if (prepError) {
      console.warn('FictionPad: generation prep failed:', prepError);
      setError(`Generation failed: ${describeApiError(prepError)}`);
      discardEmptySwipe(); genRef.current = null; setGenerating(null); return;
    }
    setManifestFor(chatObj.id, man, messages);
    setSuggestions(null);
    let sawDone = false; // a chunk with finish_reason arrived (clean finish)
    let truncated = false; // finish_reason 'length' — surfaced on the manifest
    // OpenAI-style backends 400 the whole request when stop has >4 entries:
    // retry once with the list truncated, then surface any error as-is.
    let stopList = st.stopStrings;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          for await (const chunk of openaiChatStream({
            endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model, messages,
            // Per-chat sampler overrides (panel's Samplers tab) win over globals.
            samplers: effSamplers,
            maxTokens: st.maxTokens, signal: abort.signal,
            tokenProbs: st.tokenProbs !== false, topLogprobs: st.topLogprobs ?? 10, logitBias, stop: stopList,
          })) {
            if (chunk.done) {
              sawDone = true;
              if (chunk.finishReason === 'length') truncated = true;
              continue;
            }
            if (chunk.lp) { lpTape.push(...chunk.lp); continue; }
            if (chunk.think) { thinkAcc += chunk.think; applyText(acc); continue; }
            acc += chunk.content;
            // Streaming view hides tool protocol blocks (complete + trailing
            // unterminated) so the user never sees them mid-generation.
            applyText(st.toolsEnabled !== false ? stripToolBlocks(acc) : acc);
          }
          if (!acc && !abort.signal.aborted)
            setError(sawDone ? 'The model returned an empty response.'
                             : 'The connection ended before any text arrived.');
          break;
        } catch (e) {
          if (attempt === 0 && !acc && e?.status === 400 && /stop/i.test(e?.message ?? '')
              && Array.isArray(stopList) && stopList.length > 4) {
            console.warn(`FictionPad: backend rejected ${stopList.length} stop strings — retrying with the first 4.`);
            stopList = stopList.slice(0, 4);
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError')
        setError(`Generation failed: ${describeApiError(e)}`);
    } finally {
      genRef.current = null;
      setGenerating(null);
      // Tool calls: parse the finished text, strip protocol blocks
      // from display, execute against the chat lore overlay. Logprobs still
      // attach on tool replies: the lp tape is aligned against the RAW text
      // (which it tiles exactly) and projected through the strip's char map
      // onto the stripped display text (attachProbs).
      let toolResults = null;
      let toolCallsRan = false;
      // All late writes funnel through commit(): the mutation is applied to a
      // merge of the CURRENT stored chat with the generation-owned message
      // tree, and the whole write is skipped when the chat was deleted
      // mid-generation — a deleted chat must never be resurrected from the
      // stale `work` snapshot. mutate returning its input = no write needed.
      const commit = (mutate) => {
        const cur = ref.current.chats[work.id];
        if (!cur) return false;
        const base = { ...cur, messages: work.messages, activeLeafId: work.activeLeafId };
        const next = mutate(base);
        if (next === base) { work = base; return true; }
        work = { ...next, updatedAt: Date.now() };
        upsertChat(work.id, work);
        // React flushes this write only AFTER the finally completes — reflect
        // it in ref immediately, or later same-finally reads (speaker
        // attribution, the tool-only placeholder) rebuild from the pre-tool
        // snapshot and silently drop the pieces the tools just wrote.
        ref.current.chats = { ...ref.current.chats, [work.id]: work };
        return true;
      };
      // (Regenerate hygiene: tool pieces the replaced swipe created were
      // already rolled back BEFORE this generation started — see the top of
      // runGeneration. Restored by discardEmptySwipe when nothing is produced.)
      if (acc && st.toolsEnabled !== false) {
        // Continuation: parse ONLY the new slice — tool blocks in the base
        // text were already executed by its own generation, and the base
        // text (plus its spans) stays verbatim so baseSpans + new spans
        // always tile swipe.text exactly.
        const slice = acc.slice(baseText.length);
        const parsed = parseToolCalls(slice);
        if (parsed.text !== slice) {
          // Keep the raw text + raw→stripped map for logprob projection.
          probMap = stripToolBlocksMapped(slice);
          rawAcc = acc;
          // Drift guard: if the map's text isn't exactly what we store,
          // discard it — attachProbs falls back to plain alignment.
          if (probMap.text !== parsed.text) { probMap = null; rawAcc = null; }
          acc = baseText + parsed.text;
          if (parsed.text) applyText(acc);
        }
        if (parsed.calls.length) {
          toolCallsRan = true;
          const callCap = Math.max(1, st.toolCallCap ?? TOOL_CALL_CAP);
          commit((c) => {
            const applied = applyToolCalls(c, parsed.calls, {
              nodeId, now: Date.now(), cap: callCap,
              queueLore: (scen?.emergentLore ?? 'queue') === 'queue',
              atLen: getActivePath(c.messages, nodeId).length,
            }, mergedLorePieces(scen, c, gchars));
            toolResults = applied.results;
            return applied.chat;
          });
          if (toolResults) {
            man.toolCalls = toolResults.map(r => ({
              name: r.name, ok: r.ok, note: r.note, args: toPreview(JSON.stringify(r.args ?? {}), 200),
            }));
            const capped = toolResults.filter(r => r.note === 'call cap reached').length;
            const failed = toolResults.filter(r => !r.ok && r.note !== 'call cap reached').length;
            if (capped) man.warnings.push(`${capped} tool call(s) skipped — per-generation cap is ${callCap}.`);
            if (failed) man.warnings.push(`${failed} tool call(s) failed — details in the inspector.`);
            if (ref.current.chats[chatObj.id]) setManifestFor(chatObj.id, { ...man }, messages);
          }
        }
      }
      // Tool-only reply: the model emitted ONLY tool blocks. Keep a
      // placeholder swipe instead of discarding it — applyToolCalls stamped
      // its pieces createdBy: nodeId (they must reference a live node), and
      // the user gets visible feedback that lore was added. Logprobs are
      // skipped: the tape covers the raw protocol text, so aligning it to a
      // synthetic placeholder is meaningless.
      const toolOnly = !acc && toolCallsRan;
      if (toolOnly) { acc = '✦ Lore updated via tool call.'; applyText(acc); }
      if (!acc) discardEmptySwipe();
      // Stream ended without a finish chunk and not by the user's Stop — the
      // connection dropped mid-generation. Partial text is kept, but flagged.
      const interrupted = !!acc && !sawDone && !abort.signal.aborted;
      if (acc) {
        if (!toolOnly) attachProbs();
        if (truncated) {
          man.warnings.push('Response truncated at max_tokens — raise Max tokens in Settings or /continue.');
          if (ref.current.chats[chatObj.id]) setManifestFor(chatObj.id, { ...man }, messages);
        }
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
          const messages = { ...work.messages, [nodeId]: { ...n, swipes } };
          const cur = ref.current.chats[work.id];
          if (cur) {
            work = { ...cur, messages, updatedAt: Date.now() };
            upsertChat(work.id, work);
          } else {
            work = { ...work, messages }; // deleted mid-generation — local only
          }
        }
        maybeSummarize(work);
        maybeExtractLore(work);
        // Experimental (settings.toolsEnrich): flesh out characters this
        // generation registered, via the ✦ generator. Fire-and-forget like
        // the passes above; merge-on-write at save time.
        if (st.toolsEnrich && toolResults) maybeEnrichCharacters(work, nodeId, toolResults);
        // Response suggestions: only after a full generation/regeneration —
        // never mid-stream, never after /continue, never for OOC exchanges.
        if (!continuation && st.suggestions) {
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
      }, chatObj.id);
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
  // Generation entry guard: callers append the target swipe/node BEFORE
  // calling runGeneration, so a late "not configured" bail would leak an
  // empty bubble into the tree. Check before writing anything.
  const generationReady = (c) => {
    const st = ref.current.settings;
    if (st.endpoint && (c?.settings?.model || st.model)) return true;
    setError('Configure an endpoint and chat model in Settings first.');
    return false;
  };
  function sendUserMessage(c, content) {
    if (!generationReady(c)) return;
    const { chat: c1, id: userId } = appendMessage(c, c.activeLeafId, 'user', content);
    const { chat: c2, id: asstId } = appendMessage(c1, userId, 'assistant', '');
    upsertChat(c2.id, { ...c2, updatedAt: Date.now() });
    runGeneration(c2, asstId, { fresh: true });
  }
  function handleContinue(c) {
    if (!generationReady(c)) return;
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
    if (auxBusy.length) return `Working… (${[...new Set(auxBusy)].join(', ')})`;
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
        if (!generationReady(c)) return null;
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
    try {
      const out = await auxLogged('improve', {
        endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model,
        system: subUser(st.improvePrompt || DEFAULT_IMPROVE_PROMPT, `${pName}${personaDesc}`),
        user: `${recent ? `Recent scene:\n\n${recent}\n\n` : ''}Draft:\n\n${draft}`,
        maxTokens: st.improveMaxTokens ?? 400, temperature: st.improveTemp ?? 0.7, stop: st.stopStrings,
      }, c.id);
      if (!out) throw new Error('empty response from the model');
      setComposerInject({ chatId: c.id, text: out, nonce: Date.now() });
    } catch (e) {
      setError(`/improve failed: ${e.message ?? e}`);
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
    if (!recent.trim()) { setComposerInject({ chatId: c.id, hint: 'Nothing to recap yet.', nonce: Date.now() }); return; }
    try {
      const out = await auxLogged('recap', {
        endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model,
        system: (st.recapPrompt || DEFAULT_RECAP_PROMPT).replaceAll('{{words}}', String(st.recapWords ?? 400)),
        user: `Roleplay excerpt (last ${n} messages):\n\n${recent}`,
        maxTokens: st.recapMaxTokens ?? 700, temperature: st.recapTemp ?? 0.4, stop: st.stopStrings,
      }, c.id);
      if (!out) throw new Error('empty response from the model');
      setModal({ kind: 'recap', text: out });
    } catch (e) {
      setError(`/recap failed: ${e.message ?? e}`);
    }
  }

  async function memoryCommand(c, n) {
    setComposerInject({ chatId: c.id, hint: 'Generating memory…', nonce: Date.now() });
    try {
      const text = await generateMemory(c, n);
      if (!text) { setComposerInject({ chatId: c.id, hint: 'Nothing to summarize yet.', nonce: Date.now() }); return; }
      // Merge-on-write: re-read the chat after the aux call and overwrite
      // only memoryStore (manual /memory: cursor untouched).
      const cur = ref.current.chats[c.id];
      if (!cur) { setComposerInject({ chatId: c.id, hint: null, nonce: Date.now() }); return; }
      const store = pushMemory(cur, text);
      saveChat({ ...cur, memoryStore: { ...store, cursor: cur.memoryStore?.cursor ?? 0 } });
      setComposerInject({ chatId: c.id, hint: `Memory saved (${store.memories.length} total).`, nonce: Date.now() });
    } catch (e) {
      setComposerInject({ chatId: c.id, hint: null, nonce: Date.now() });
      setError(`/memory failed: ${e.message ?? e}`);
    }
  }

  // ---- per-message actions ----
  const onEdit = (nodeId, text) => {
    if (genRef.current) return; // no tree surgery mid-generation
    const c = ref.current.chats[ui.chatId]; const n = c?.messages[nodeId];
    if (!n) return;
    const swipes = n.swipes.slice();
    swipes[n.activeSwipe] = { ...swipes[n.activeSwipe], text };
    saveChat({ ...c, messages: { ...c.messages, [nodeId]: { ...n, swipes, edited: true } } });
  };
  const onRegenerate = (nodeId) => {
    const c = ref.current.chats[ui.chatId]; const n = c?.messages[nodeId];
    if (!n || genRef.current || !generationReady(c)) return;
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
    if (!toks?.length || !generationReady(c)) return;
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
    // touch: false — browsing swipes changes no tree state; the chat must not
    // re-sort to the top of the sidebar.
    saveChat({ ...c, messages: { ...c.messages, [nodeId]: { ...n, activeSwipe: next } } }, { touch: false });
  };
  const onSwipeTo = (nodeId, idx) => {
    const c = ref.current.chats[ui.chatId]; const n = c?.messages[nodeId];
    if (!n || idx < 0 || idx >= n.swipes.length) return;
    saveChat({ ...c, messages: { ...c.messages, [nodeId]: { ...n, activeSwipe: idx } } }, { touch: false });
  };
  const onBranch = (nodeId) => {
    const c = ref.current.chats[ui.chatId];
    if (!c) return;
    const b = branchChat(c, nodeId); // deep-copies messages + memoryStore
    upsertChat(b.id, b);
    setUi(u => ({ ...u, chatId: b.id }));
  };
  const onRewind = (nodeId) => {
    if (genRef.current) return; // no tree surgery mid-generation
    const c = ref.current.chats[ui.chatId];
    if (c) saveChat(rewindChat(c, nodeId)); // rolls memoryStore back too
  };
  const onDeleteMsg = (nodeId) => {
    if (genRef.current) return; // no tree surgery mid-generation
    const c = ref.current.chats[ui.chatId]; const n = c?.messages[nodeId];
    if (!n?.parentId) return;
    const messages = deleteSubtree(c.messages, nodeId);
    const leaf = messages[c.activeLeafId] ? c.activeLeafId : n.parentId;
    saveChat({ ...c, messages, activeLeafId: leaf });
  };

  // ---- scenarios / personas / chats ----
  const onSaveScenario = (draft) => { upsertScenario(draft.id, draft); setModal(null); };
  // Deleting a scenario/character/persona leaves dangling links in chats that
  // reference it — the confirm names the affected-chat count so it's an
  // informed choice. (Sidebar/PersonaManager call these handlers directly.)
  const onDeleteScenario = (id) => {
    const refs = Object.values(ref.current.chats).filter(c => c.scenarioId === id).length;
    const name = ref.current.scenarios[id]?.name ?? id;
    if (!confirm(`Delete scenario "${name}"?${refs ? `\n${refs} chat(s) use it — they keep working but lose its lore/prompt.` : ''}`)) return;
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
    // Remember the persona choice for the next New chat (per-device; the
    // explicit default persona, when set, takes precedence — see NewChatModal).
    setUi(u => ({ ...u, lastPersonaId: pid ?? null, ...(scen
      ? { chatId: c.id, scenarioId: scen.id, characterId: null }
      : { chatId: c.id, scenarioId: null, characterId: char.id }), ...(isMobile ? { sidebarCollapsed: true } : {}) }));
    setModal(null);
  };
  const onDeleteCharacter = (id) => {
    const refs = Object.values(ref.current.chats).filter(c => c.characterIds?.includes(id)).length;
    const name = ref.current.characters[id]?.name ?? id;
    if (!confirm(`Delete character "${name}"?${refs ? `\n${refs} chat(s) link to it — the link becomes inert.` : ''}`)) return;
    removeCharacter(id); // links dangle in scenarios/chats — resolveCharacters skips them
    if (ui.characterId === id) setUi(u => ({ ...u, characterId: null }));
  };
  const onDeleteChat = (id) => {
    // Abort generation in flight for this chat before removing it.
    if (generating?.chatId === id) genRef.current?.abort.abort();
    removeChat(id);
    // Drop per-chat session state too, or it lingers for the whole session.
    setManifests(m => { if (!(id in m)) return m; const n = { ...m }; delete n[id]; return n; });
    setSuggestions(s => (s?.chatId === id ? null : s));
    if (ui.chatId === id) setUi(u => ({ ...u, chatId: null }));
  };

  // Generate an assistant reply as a child of a user message (defaults to the
  // active leaf). A new assistant child becomes the active leaf, so repeated
  // calls create sibling assistant branches — same semantics as swipes.
  const onGenerateReply = (nodeId = null) => {
    const c = ref.current.chats[ui.chatId];
    if (!c || genRef.current || auxBusy.length || !generationReady(c)) return;
    const parent = c.messages[nodeId ?? c.activeLeafId];
    if (!parent || parent.role !== 'user') return;
    const { chat: c1, id } = appendMessage(c, parent.id, 'assistant', '');
    upsertChat(c1.id, { ...c1, updatedAt: Date.now() });
    runGeneration(c1, id, { fresh: true });
  };

  // ---- export / import ----
  // A scenario export is a BUNDLE: the scenario plus its linked global
  // characters (scenario.characterIds), so the file works standalone on
  // import. The legacy single-scenario type stays importable (below).
  const onExportScenario = (id) => {
    const s = scenarios[id];
    if (!s) return;
    downloadJSON(`fictionpad-scenario-${s.name ?? id}.json`, {
      type: 'fictionpad-scenario-bundle', version: 1,
      data: { scenario: s, characters: (s.characterIds ?? []).map(cid => characters[cid]).filter(Boolean) },
    });
  };
  const onExportChat = (c) =>
    downloadJSON(`fictionpad-chat-${c.name}.json`, { type: 'fictionpad-chat', version: 1, data: c });
  const onExportCharacter = (id) =>
    downloadJSON(`fictionpad-character-${characters[id]?.name ?? id}.json`, { type: 'fictionpad-character', version: 1, data: characters[id] });
  const onImport = async () => {
    const obj = await pickJSONFile();
    if (!obj) return;
    if (obj.__error) return setError(`Import failed: ${obj.__error}`);
    if (obj.type === 'fictionpad-scenario' && obj.data?.name != null) {
      // Legacy single-scenario export: fresh id, never clobbers an existing one.
      const s = { ...obj.data, id: uid() };
      upsertScenario(s.id, s);
      setUi(u => ({ ...u, scenarioId: s.id }));
    } else if (obj.type === 'fictionpad-scenario-bundle' && obj.data?.scenario?.name != null) {
      // Bundle: upsert scenario + linked characters by id (last write wins,
      // same as the migration helpers).
      const s = obj.data.scenario;
      if (!s.id) s.id = uid();
      upsertScenario(s.id, s);
      for (const ch of obj.data.characters ?? [])
        if (ch?.id && ch.name != null) upsertCharacter(ch.id, ch);
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
      setError('Unrecognized JSON: expected a FictionPad scenario, character or chat export. Full backups import via Settings → Connection.');
    }
  };

  // ---- full backup (Settings → Connection): everything in one JSON ----
  // serverToken is per-device and NEVER leaves the machine — stripped here on
  // export and ignored on import (same rule as the Meta/app.settings sync).
  const onExportAll = () => {
    const { serverToken, ...rest } = settingsRaw ?? {};
    downloadJSON(`fictionpad-backup-${new Date().toISOString().slice(0, 10)}.json`, {
      type: 'fictionpad-backup', version: 1, exportedAt: Date.now(),
      data: { scenarios, chats, personas, characters, settings: rest },
    });
  };
  // Upserts everything by id (last write wins — entities absent from the file
  // are kept). Returns { note, settings } for the Settings modal, null when
  // the picker was cancelled; throws on invalid input.
  const onImportAll = async () => {
    const obj = await pickJSONFile();
    if (!obj) return null;
    if (obj.__error) throw new Error(`not valid JSON (${obj.__error})`);
    if (obj.type !== 'fictionpad-backup' || !obj.data || typeof obj.data !== 'object')
      throw new Error('not a FictionPad backup file (expected type "fictionpad-backup") — scenario/character/chat files import from the sidebar instead.');
    const d = obj.data;
    const counts = { scenarios: 0, chats: 0, characters: 0, personas: 0 };
    for (const s of Object.values(d.scenarios ?? {}))
      if (s?.id && s.name != null) { upsertScenario(s.id, s); counts.scenarios++; }
    // Chats upsert through the same path as normal edits, so importing over
    // the currently open chat replaces the live copy instead of forking state.
    for (const c of Object.values(d.chats ?? {}))
      if (c?.id && c.messages) { upsertChat(c.id, c); counts.chats++; }
    for (const ch of Object.values(d.characters ?? {}))
      if (ch?.id && ch.name != null) { upsertCharacter(ch.id, ch); counts.characters++; }
    for (const p of Object.values(d.personas ?? {}))
      if (p?.id && p.name != null) { upsertPersona(p.id, p); counts.personas++; }
    let applied = null;
    if (d.settings && typeof d.settings === 'object') {
      const { serverToken, ...rest } = d.settings; // any serverToken in the file is dropped
      applied = rest;
      // One setSettings commit → the settings-sync effect uploads it once.
      setSettings(prev => ({ ...rest, serverToken: prev?.serverToken ?? '' }));
    }
    const parts = Object.entries(counts).map(([k, n]) => `${n} ${k}`);
    if (applied) parts.push('settings');
    return { note: `Imported ${parts.join(', ')}.`, settings: applied };
  };
  // Server .db backup: fetch (anchor navigation can't send the Bearer header),
  // then save the blob under the server's Content-Disposition filename. On a
  // Basic-auth deployment a stale Bearer earns a 401 — retry bare so the
  // browser's cached Basic creds take over (mirrors ServerDBAdapter).
  const onServerBackup = async () => {
    const tok = ref.current.settings.serverToken ?? '';
    let res = await fetch('/backup', { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
    if (res.status === 401 && tok) res = await fetch('/backup');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const m = (res.headers.get('Content-Disposition') ?? '').match(/filename="([^"]+)"/);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = m?.[1] ?? 'fictionpad-backup.db';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const onPreview = (chatId = ui.chatId) => {
    const c = ref.current.chats[chatId];
    if (!c) return;
    const st = ref.current.settings;
    // Same platform-prompt composition as runGeneration so the preview counts
    // the speaker/tools prompts too. Semantic activation is NOT rerun here
    // (async embeddings) — the preview is keyword-trigger lore only.
    const auto = resolveLimits(st, c.settings?.model || st.model);
    const { messages, manifest: man } = assemblePrompt({
      scenario: ref.current.scenarios[c.scenarioId],
      persona: c.personaId ? ref.current.personas[c.personaId] : null,
      chat: c, settings: { ...st,
        // Match runGeneration's merge: both per-chat overrides shadow the
        // auto-resolved globals, or the preview's budget/reserve disagree
        // with real sends.
        contextLength: c.settings?.contextLength ?? auto.contextLength,
        maxTokens: c.settings?.maxTokens ?? auto.maxTokens },
      platformPrompt: buildPlatformPrompt(st),
      characters: ref.current.characters,
    });
    // Surface the keyword-only caveat when smart pieces could have fired.
    if (st.embeddingModel && mergedLorePieces(ref.current.scenarios[c.scenarioId], c, ref.current.characters)
        .some(p => p && p.enabled !== false && !p.pinned && p.smart))
      man.warnings.push('Preview: semantic activation not run (embeddings) — semantic pieces show keyword-trigger results only.');
    setManifestFor(c.id, man, messages);
  };

  // Suggestions fire after every swipe and would flood the aux list — hidden
  // unless the user opts in (Settings → Features). Entries are per-chat: each
  // inspector (drawer, chat panel) shows only its own chat's aux calls.
  const shownAuxLog = (chatId) => {
    const list = settings.auxShowSuggestions ? auxLog : auxLog.filter(a => a.kind !== 'suggestions');
    return list.filter(a => !a.chatId || a.chatId === chatId);
  };

  // Ribbon pane toggles: «/» edge arrows on phones always, and on desktop when
  // the Appearance setting asks for them; otherwise the brand/Inspector labels.
  const ribbonArrows = isMobile || settings.sidebarArrows;
  // Inset the centered title by the actual toggle-button widths so a long chat
  // name ellipsizes instead of sliding under them.
  const leftBtnRef = useRef(null), rightBtnRef = useRef(null);
  const [btnW, setBtnW] = useState({ l: 0, r: 0 });
  useEffect(() => {
    const l = leftBtnRef.current?.offsetWidth ?? 0, r = rightBtnRef.current?.offsetWidth ?? 0;
    if (l !== btnW.l || r !== btnW.r) setBtnW({ l, r });
  }, [viewportW, ribbonArrows]);

  return html`
    <div class="app ${sidebarCollapsed ? '' : 'sb-open'} ${dragging ? 'dragging' : ''}">
      ${isMobile && (!sidebarCollapsed || ui.drawer) && html`
        <div class="scrim" onClick=${() => { if (!sidebarCollapsed) toggleSidebar(); closeDrawer(); }} />`}
      <div class="topbar">
        <div class="topbar-inner">
          <span ref=${leftBtnRef} style=${{ display: 'inline-flex', flex: 'none' }}>
            ${ribbonArrows
              ? html`<button class="btn small ghost ${sidebarCollapsed ? '' : 'active'}" title=${sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
                  onClick=${toggleSidebar}>${sidebarCollapsed ? '»' : '«'}</button>`
              : html`<button class="btn small ghost ${sidebarCollapsed ? '' : 'active'}"
                  title=${sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'} onClick=${toggleSidebar}>FictionPad</button>`}
          </span>
          ${chat && html`<div class="mid"
            style=${{ left: `${(isMobile ? 8 : 14) + padL + btnW.l + 6}px`, right: `${(isMobile ? 8 : 14) + padR + btnW.r + 6}px` }}>
            <span class="title">${chat.name}</span>
            <button class="btn small ghost" title="Close chat"
              onClick=${() => setUi(u => ({ ...u, chatId: null }))}>✕</button>
            <span class="sub">${chat.scenarioId
              ? (scenarios[chat.scenarioId]?.name ?? '(missing scenario)')
              : ((chat.characterIds ?? []).map(id => characters[id]?.name).filter(Boolean).join(', ') || '(no scenario)')} · ${personaName}</span>
          </div>`}
          ${generating && generating.chatId !== chat?.id && html`
            <span class="hint" style=${{ fontStyle: 'normal', flex: 'none' }}
              title=${`Generating in "${chats[generating.chatId]?.name ?? 'another chat'}"`}>generating…</span>`}
          <span class="spacer"></span>
          <span ref=${rightBtnRef} style=${{ display: 'inline-flex', flex: 'none' }}>
            ${ribbonArrows
              ? html`<button class="btn small ghost ${ui.drawer ? 'active' : ''}"
                  title="Inspector / Samplers / Memory / Chat panel"
                  onClick=${() => ui.drawer ? closeDrawer() : toggleDrawer(lastDrawerTabRef.current ?? 'inspector')}>${ui.drawer ? '»' : '«'}</button>`
              : html`<button class="btn small ghost ${ui.drawer ? 'active' : ''}"
                  title="Inspector panel (Inspector / Samplers / Memory / Chat tabs)"
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
        onSelectChat=${(id) => setUi(u => ({ ...u, chatId: id,
          // On phones the sidebar is an overlay — close it so the chat shows.
          ...(isMobile ? { sidebarCollapsed: true } : {}) }))}
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
        collapsed=${sidebarCollapsed && !peekLeft}
        peek=${peekLeft} peekLeave=${peekLeft ? () => setPeek(null) : null}
        onDeleteChat=${onDeleteChat}
        onChatAction=${chatAction}
        onChatContextMenu=${(chatId, x, y) => setCtxMenu({ chatId, x, y })}
        onScenarioContextMenu=${(id, x, y) => setCtxMenu({ x, y, items: [
          { label: 'New chat', fn: () => setModal({ kind: 'newChat', scenarioId: id }) },
          { label: 'Edit', fn: () => setModal({ kind: 'scenario', scenario: scenarios[id] }) },
          { label: 'Export JSON', fn: () => onExportScenario(id) },
          '-',
          { label: 'Delete…', fn: () => onDeleteScenario(id), danger: true },
        ] })}
        onCharacterContextMenu=${(id, x, y) => setCtxMenu({ x, y, items: [
          { label: 'New chat', fn: () => setModal({ kind: 'newChat', characterId: id }) },
          { label: 'Edit', fn: () => setModal({ kind: 'character', character: characters[id] ?? null }) },
          { label: 'Export JSON', fn: () => onExportCharacter(id) },
          '-',
          { label: 'Delete…', fn: () => onDeleteCharacter(id), danger: true },
        ] })}
        storageKind=${storageKind} saveRetrying=${saveRetrying}
        width=${peekLeft ? clampPane(ui.sbWidth ?? autoPaneW) : sbW} onDragStart=${paneDragStart('left')} onResetWidth=${() => resetPaneWidth('left')} />
      ${settings.edgePeek !== false && !isMobile && sidebarCollapsed && html`
        <div class="pane-edge left" onPointerEnter=${peekEnter('left')} onPointerLeave=${peekCancel} />`}
      ${settings.edgePeek !== false && !isMobile && !ui.drawer && html`
        <div class="pane-edge right" onPointerEnter=${peekEnter('right')} onPointerLeave=${peekCancel} />`}
      <div class="center-col" style=${{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, paddingLeft: padL, paddingRight: padR }}>
        ${storageFailed && html`<div class="banner">IndexedDB unavailable — data will not persist across reloads.</div>`}
        ${saveFailed && html`<div class="banner">${saveFailed}</div>`}
        ${error && html`<div class="banner">${error}<button class="btn small ghost" onClick=${() => setError(null)}>✕</button></div>`}
        <div style=${{ flex: 1, display: 'flex', minHeight: 0 }}>
          <${ErrorBoundary} name="chat">
            <${ChatPane} chat=${chat} persona=${persona} characterNames=${characterNames} characterColors=${characterColors}
              dateFormat=${settings.dateFormat} showThinking=${settings.showThinking !== false}
              generating=${generating?.chatId === chat?.id ? generating : null}
              suggestions=${suggestions}
              onPickSuggestion=${(s) => setComposerInject({ chatId: ui.chatId, text: s, nonce: Date.now() })}
              onRerollSuggestions=${() => {
                const c = ref.current.chats[ui.chatId];
                if (c && !auxBusy.length) fetchSuggestions(c, c.activeLeafId);
              }}
              composerInject=${composerInject} auxBusy=${auxBusy}
              onSubmitInput=${handleInput}
              onStop=${() => { genRef.current?.abort.abort(); for (const c of auxCtls.current) c.abort(); }}
              onEdit=${onEdit} onRegenerate=${onRegenerate} onSwipe=${onSwipe} onSwipeTo=${onSwipeTo}
              onBranch=${onBranch} onRewind=${onRewind} onDeleteMsg=${onDeleteMsg}
              onGenerateReply=${onGenerateReply} onReply=${onGenerateReply} onRegenFromToken=${onRegenFromToken} />
          <//>
        </div>
      </div>
      <${RightDrawer}
        chat=${chat} tab=${ui.drawer ?? (peekRight ? peekTab ?? lastDrawerTabRef.current ?? 'inspector' : null)}
        onTab=${(t) => peekRight ? setPeekTab(t) : setUi(u => ({ ...u, drawer: t }))}
        peek=${peekRight} peekLeave=${peekRight ? () => setPeek(null) : null}
        manifest=${manifest} realCounts=${realCounts} onPreview=${() => onPreview()} auxLog=${shownAuxLog(ui.chatId)}
        cap=${settings.memoryCap ?? MEMORY_CAP}
        personas=${personas} scenario=${chat ? scenarios[chat.scenarioId] : null} characters=${characters}
        settings=${settings} onUpdateSettings=${updateSettings}
        onExport=${() => chat && onExportChat(chat)}
        onDelete=${() => { if (chat && confirm(`Delete chat "${chat.name}"?`)) onDeleteChat(chat.id); }}
        dateFormat=${settings.dateFormat} memoryEvery=${settings.memoryEvery}
        onUpdateChat=${saveChat}
        onSummarize=${() => chat && summarizeNow(chat)} summarizing=${summarizing}
        width=${peekRight ? clampPane(ui.dwWidth ?? autoPaneW) : dwW} onDragStart=${paneDragStart('right')} onResetWidth=${() => resetPaneWidth('right')}
        onGenerate=${runGen}
        onClose=${peekRight ? () => setPeek(null) : closeDrawer} />
      </div>
    </div>
    ${modal?.kind === 'scenario' && html`
      <${ErrorBoundary} name="scenario editor"><${ScenarioEditor} scenario=${modal.scenario} characters=${characters} onSave=${onSaveScenario} onGenerate=${runGen} onClose=${() => setModal(null)} /><//>`}
    ${modal?.kind === 'character' && html`
      <${ErrorBoundary} name="character editor"><${CharacterEditor} character=${modal.character} scenarios=${scenarios}
        chatLinkCount=${modal.character ? Object.values(chats).filter(c => c.characterIds?.includes(modal.character.id)).length : 0}
        onUpsert=${upsertCharacter} onGenerate=${runGen} onClose=${() => setModal(null)} /><//>`}
    ${modal?.kind === 'personas' && html`
      <${ErrorBoundary} name="personas"><${PersonaManager} personas=${personas} onUpsert=${upsertPersona}
        defaultPersonaId=${settings.defaultPersonaId ?? ''}
        onSetDefault=${(id) => updateSettings({ defaultPersonaId: id })}
        onRemove=${(id) => {
          const refs = Object.values(ref.current.chats).filter(c => c.personaId === id).length;
          const name = ref.current.personas[id]?.name ?? id;
          if (confirm(`Delete persona "${name}"?${refs ? `\n${refs} chat(s) use it — they fall back to the default {{user}} name.` : ''}`)) {
            if ((settings.defaultPersonaId ?? '') === id) updateSettings({ defaultPersonaId: '' });
            removePersona(id);
          }
        }}
        onClose=${() => setModal(null)} /><//>`}
    ${modal?.kind === 'settings' && html`
      <${ErrorBoundary} name="settings"><${SettingsModal} settings=${settings} theme=${theme} onThemeChange=${setTheme}
        accent=${accent} onAccentChange=${setAccent} initialDraft=${settingsDraft}
        onOpenLogitBias=${(draft) => { setSettingsDraft(draft ?? null); setModal({ kind: 'logitBias' }); }}
        storageKind=${storageKind} onUpload=${migrateUpload} onDownload=${migrateDownload}
        onExportAll=${onExportAll} onImportAll=${onImportAll} onServerBackup=${onServerBackup}
        onSave=${(s) => { setSettingsDraft(null); setSettings(prev => ({ ...s, logitBias: prev?.logitBias ?? s.logitBias ?? {} })); setModal(null); }}
        onClose=${() => { setSettingsDraft(null); setModal(null); }} /><//>`}
    ${modal?.kind === 'logitBias' && html`
      <${ErrorBoundary} name="logit bias"><${LogitBiasModal}
        logitBias=${settings.logitBias ?? {}}
        onChange=${(map) => setSettings(s => ({ ...(s ?? {}), logitBias: map }))}
        onTokenize=${(prompt) => tokenize({ endpoint: effectiveEndpoint(settings, storageKind === 'server'), apiKey: settings.apiKey, serverToken: settings.serverToken, model: settings.model, prompt })}
        onClose=${() => setModal(settingsDraft ? { kind: 'settings' } : null)} /><//>`}
    ${modal?.kind === 'newChat' && (scenarios[modal.scenarioId] || characters[modal.characterId]) && html`
      <${ErrorBoundary} name="new chat"><${NewChatModal} scenario=${scenarios[modal.scenarioId] ?? null}
        character=${characters[modal.characterId] ?? null} personas=${personas}
        initialPersonaId=${(settings.defaultPersonaId && personas[settings.defaultPersonaId]) ? settings.defaultPersonaId
          : (ui.lastPersonaId && personas[ui.lastPersonaId]) ? ui.lastPersonaId : ''}
        onCreate=${(pid, newName) => createChat({ scenarioId: modal.scenarioId ?? null, characterId: modal.characterId ?? null }, pid, newName)}
        onClose=${() => setModal(null)} /><//>`}
    ${modal?.kind === 'recap' && html`
      <${ErrorBoundary} name="recap"><${RecapModal} text=${modal.text} onClose=${() => setModal(null)}
        onSaveMemory=${() => {
          const c = ref.current.chats[ui.chatId];
          if (c) {
            const store = pushMemory(c, modal.text);
            saveChat({ ...c, memoryStore: { ...store, cursor: c.memoryStore?.cursor ?? 0 } });
          }
        }} /><//>`}
    ${modal?.kind === 'chatPanel' && chats[modal.chatId] && html`
      <${ErrorBoundary} name="chat panel"><${ChatPanelModal}
        chat=${chats[modal.chatId]} tab=${modal.tab}
        onTab=${(tab) => setModal(m => ({ ...m, tab }))}
        manifest=${manifests[modal.chatId]?.manifest ?? null}
        realCounts=${modal.chatId === ui.chatId ? realCounts : null}
        onPreview=${() => onPreview(modal.chatId)} auxLog=${shownAuxLog(modal.chatId)}
        cap=${settings.memoryCap ?? MEMORY_CAP}
        personas=${personas} scenario=${scenarios[chats[modal.chatId]?.scenarioId]} characters=${characters} onUpdateChat=${saveChat}
        settings=${settings} onUpdateSettings=${updateSettings}
        dateFormat=${settings.dateFormat} memoryEvery=${settings.memoryEvery}
        onSummarize=${() => summarizeNow(chats[modal.chatId])} summarizing=${summarizing}
        onGenerate=${runGen}
        onExport=${() => onExportChat(chats[modal.chatId])}
        onDelete=${() => { if (confirm(`Delete chat "${chats[modal.chatId].name}"?`)) { onDeleteChat(modal.chatId); setModal(null); } }}
        onClose=${() => setModal(null)} /><//>`}
    ${ctxMenu && html`
      <${ContextMenu} x=${ctxMenu.x} y=${ctxMenu.y} onClose=${() => setCtxMenu(null)}
        items=${ctxMenu.items ?? [
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
  Sidebar, CharacterEditor, ScenarioEditor, NewChatModal, LORE_TEMPLATES, newLoreFromTemplate,
  LorePieceEditor, chatSearchText, matchExcerpt };