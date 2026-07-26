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
