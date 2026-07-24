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

