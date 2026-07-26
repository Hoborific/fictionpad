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
const APP_VERSION = '__APP_VERSION__';
