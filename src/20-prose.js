// ============================================================================
// RP PROSE + SPEAKER helpers.
// ============================================================================
// Wrap quoted dialogue in <span class="dialogue"> before markdown parsing
// (marked passes inline HTML through). Skips fenced code blocks; quotes inside
// inline `code` spans still get wrapped (accepted limitation).
// A straight quote only OPENS dialogue when it looks like one: not after a
// letter/digit (5ft8", rock"in') and not before whitespace/end — otherwise a
// stray inch-mark would pair with the next real quote and eat the text in
// between. Unterminated quotes are left raw. Curly “…” pairs unambiguously.
function wrapDialogue(md) {
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
      if (end === -1) { out += ch; i++; continue; }
      out += `<span class="dialogue">${line.slice(i, end + 1)}</span>`;
      i = end + 1;
    }
    return out;
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

// Remove the leading `Name:` / `**Name:**` / `*Name*` speaker prefix for
// display — the meta row already labels who is speaking, so showing the
// prefix in the bubble too breaks immersion.
function stripSpeakerPrefix(text, name) {
  if (!text || !name) return text;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`^\\s*\\*{0,2}\\s*${esc}\\s*\\*{0,2}\\s*:\\s*`, 'i').exec(text)
        ?? new RegExp(`^\\s*\\*{1,2}\\s*${esc}\\s*\\*{1,2}\\s*`, 'i').exec(text);
  return m ? text.slice(m[0].length) : text;
}

const hueForName = (name) => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
};

