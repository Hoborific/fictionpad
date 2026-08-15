// ============================================================================
// HELPERS — export/import, misc UI utilities.
// ============================================================================
function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function downloadJSON(filename, obj) {
  downloadBlob(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }), filename);
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    // Dismissing the dialog without picking fires oncancel (Chrome/FF 91+);
    // without this the promise never settles and imports silently hang.
    input.oncancel = () => resolve(null);
    input.click();
  });
}

// Decode an image source URL (data:, blob:, http(s)) into an
// HTMLImageElement. Rejects on decode failure.
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not decode image'));
    img.src = src;
  });
}

// Decode an image file into an HTMLImageElement via an object URL (revoked
// once the load settles). Rejects on decode failure.
function loadImageFromFile(file) {
  const url = URL.createObjectURL(file);
  return loadImage(url).then(
    (img) => { URL.revokeObjectURL(url); return img; },
    () => { URL.revokeObjectURL(url); throw new Error('could not decode image file'); });
}

// Draw `img` scaled so its longest edge is at most maxEdge (aspect kept,
// never upscaled) and return a data URL. Browsers without WebP encode
// silently return PNG from toDataURL — acceptable.
function downscaleImageToDataURL(img, maxEdge, type = 'image/webp', quality = 0.85) {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  return cv.toDataURL(type, quality);
}

// Crop the square source rect (sx, sy, sSize) out of `img` and return it as
// an out×out data URL (avatar pipeline). Same WebP→PNG fallback note.
function cropSquareToDataURL(img, sx, sy, sSize, out = 256, type = 'image/webp', quality = 0.85) {
  const cv = document.createElement('canvas');
  cv.width = out; cv.height = out;
  cv.getContext('2d').drawImage(img, sx, sy, sSize, sSize, 0, 0, out, out);
  return cv.toDataURL(type, quality);
}

async function pickJSONFile() {
  const file = await pickFile('.json,application/json');
  if (!file) return null;
  try { return JSON.parse(await file.text()); }
  catch (e) { return { __error: String(e) }; }
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
//   string  — send-checkbox + text input, or a dropdown when the def carries
//             a comma-separated choices list (e.g. reasoning_effort:
//             "low, medium, high"); the chosen string is sent verbatim
const customSamplerFields = (st) => (st?.customSamplers ?? [])
  .filter(d => d?.key?.trim() && !SAMPLER_FIELD_MAP[d.key.trim()])
  .map(d => {
    const options = String(d.choices ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const type = d.type === 'boolean' ? 'boolean' : d.type === 'string' ? 'string' : 'number';
    return {
      key: d.key.trim(),
      label: d.name?.trim() || d.key.trim(),
      type,
      min: Number.isFinite(d.min) ? d.min : 0,
      max: Number.isFinite(d.max) ? d.max : 1,
      step: Number.isFinite(d.step) && d.step > 0 ? d.step : 0.01,
      def: type === 'boolean' ? d.def !== false
        : type === 'string' ? String(d.def ?? options[0] ?? '')
        : (Number.isFinite(d.def) ? d.def : 0),
      options,
      custom: true,
    };
  });
const allSamplerFields = (st) => [...SAMPLER_FIELDS, ...customSamplerFields(st)];

// Samplers minus the user-disabled keys — the set actually sent. Values stay
// in settings.samplers while disabled, so re-enabling restores the tuned
// number instead of resetting it.
const enabledSamplers = (st) => Object.fromEntries(
  Object.entries(st?.samplers ?? {}).filter(([k]) => !(st?.disabledSamplers ?? []).includes(k)));

// Value editor for a sampler field — true/false select for booleans, dropdown
// for strings with a choices list (a stored value outside the list is kept as
// an extra option, never silently dropped), plain text input for free-form
// strings, NumInput otherwise. Shared by every surface that edits a sampler
// set (per-chat overrides, scenario defaults), so the rows can't drift.
const samplerValueCtl = (f, value, onChange) => f.type === 'boolean'
  ? html`<select value=${String(value !== false)} onChange=${(e) => onChange(e.target.value === 'true')}>
      <option value="true">true</option><option value="false">false</option></select>`
  : f.type === 'string'
    ? (f.options?.length
      ? html`<select value=${String(value ?? f.def ?? '')} onChange=${(e) => onChange(e.target.value)}>
          ${(value != null && value !== '' && !f.options.includes(String(value))
            ? [String(value), ...f.options] : f.options)
            .map(o => html`<option key=${o} value=${o}>${o}</option>`)}</select>`
      : html`<input type="text" value=${String(value ?? '')} placeholder=${f.def || f.key}
          onInput=${(e) => onChange(e.target.value)} />`)
    : html`<${NumInput} value=${value} min=${f.min} max=${f.max} step=${f.step} fallback=${f.def}
      onCommit=${onChange} />`;

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

