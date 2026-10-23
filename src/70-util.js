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

// Save a data: URL (or any URL) as a file — the image counterpart of
// downloadBlob. In-memory images are always data URLs (imgref sentinels only
// exist at the persistence boundary), so no fetch/decode step is needed.
function downloadDataURL(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

// "A portrait of Mia" + data:image/webp;… → "a-portrait-of-mia.webp". Blank
// names fall back to a timestamp; the extension comes from the data-URL mime.
// `num` is the 1-based take number of a multi-take image slot: takes past the
// first get a "-2"/"-3" suffix so re-rolls of one image don't all save under
// the same filename.
function imageFilename(name, url, num = 0) {
  const base = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 60);
  const mime = /^data:image\/([a-z0-9+.-]+)/i.exec(String(url))?.[1] ?? '';
  const ext = { 'jpeg': 'jpg', 'svg+xml': 'svg' }[mime] ?? mime ?? '';
  const suffix = num > 1 ? `-${num}` : '';
  return `${base || `image-${Date.now()}`}${suffix}.${ext || 'png'}`;
}

// Full-length PNG snapshot of the chat log (`.chatlog`) — the whole rendered
// conversation, not just the scrolled-into-view part. Zero-dep: the log is
// cloned, re-laid-out offscreen at full content height, serialized into an
// SVG foreignObject with the app's own stylesheet embedded, and rasterized
// via <img> + canvas. An SVG loaded as an image may only load data: URL
// subresources — which is all the chat column ever renders (avatars,
// generated images) — so the canvas stays untainted and exportable.
async function snapshotChatLogPNG(filename) {
  const el = document.querySelector('.chatlog');
  if (!el) throw new Error('chat pane not found');
  const width = Math.ceil(el.getBoundingClientRect().width);
  if (!width) throw new Error('chat pane is not visible');
  // The app's own stylesheet text (same-document <style>, always readable in
  // the single-file build).
  let css = '';
  for (const sheet of document.styleSheets) {
    try { for (const rule of sheet.cssRules) css += rule.cssText + '\n'; } catch { /* no cross-origin sheets in this build */ }
  }
  // Theme colors are inline custom properties on <html>; inside the SVG
  // document `:root` is the <svg> element, so every var() would resolve to
  // nothing. Copy each custom property defined anywhere in the CSS onto the
  // wrapper element with its currently-computed value.
  const rootCS = getComputedStyle(document.documentElement);
  const varNames = [...new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]))];
  const vars = varNames.map(n => `${n}:${rootCS.getPropertyValue(n)};`).join('');
  // Full-height clone: strip the scroll constraints, lay out offscreen at the
  // live width, measure, serialize. Scrollable sub-regions (thinking boxes)
  // are expanded too, or the snapshot would keep their on-screen clipping.
  const clone = el.cloneNode(true);
  clone.style.cssText = `width:${width}px;height:auto;max-height:none;overflow:visible;flex:none;`;
  for (const n of clone.querySelectorAll('.rail-body, .rail-wrap, .think-body, .think'))
    n.style.cssText += ';max-height:none;overflow:visible;';
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;';
  host.appendChild(clone);
  document.body.appendChild(host);
  // Cloned <img> elements re-decode asynchronously — measuring before they
  // size themselves undercounts the height and cuts off the tail of the chat
  // (invisible on short chats whose images are still warm). Wait for every
  // image (and webfonts) before measuring.
  await Promise.all([...clone.querySelectorAll('img')].map(i => {
    if (i.complete && i.naturalWidth) return null;
    return (i.decode ? i.decode() : new Promise(r => { i.onload = i.onerror = r; })).catch(() => {});
  }));
  await (document.fonts?.ready ?? Promise.resolve());
  const cloneTop = clone.getBoundingClientRect().top;
  const height = Math.ceil(clone.getBoundingClientRect().height);
  // Message-row boundaries, for cut points that never slice a bubble.
  const rows = [...clone.querySelectorAll(':scope > .msg, :scope > .ctx-horizon')].map(n => {
    const r = n.getBoundingClientRect();
    return { top: r.top - cloneTop, bottom: r.bottom - cloneTop };
  }).sort((a, b) => a.top - b.top);
  host.remove();
  if (!height) throw new Error('nothing to snapshot');
  // Canvas guard: browsers cap canvas dimensions (16384px on mobile Safari,
  // 32767 on Firefox, more elsewhere) and total pixels. The SVG is vector —
  // drawImage at any scale re-renders it crisply, so the scale never drops
  // below the device pixel ratio to fit a tall chat: the render TILES
  // vertically into part files (name-1.png, name-2.png, …) at full resolution
  // instead of downscaling into illegibility or clipping the tail. Cuts snap
  // to message-row tops — a message that would straddle a boundary moves
  // whole to the next part; a single message taller than a full part is the
  // only case still cut mid-row (nothing can fit it whole).
  const MAX_SIDE = 32767, MAX_AREA = 64e6;
  const scale = Math.min(3, window.devicePixelRatio || 1, MAX_SIDE / width);
  const outW = Math.max(1, Math.round(width * scale));
  const fullH = Math.max(1, Math.round(height * scale));
  const tileH = Math.max(1, Math.min(MAX_SIDE, Math.floor(MAX_AREA / outW)));
  const cap = tileH / scale; // canvas px per part → CSS px
  const cuts = [0];
  let start = 0;
  for (const { top, bottom } of rows) {
    if (bottom - start > cap && top - start > 0) {
      const cut = Math.floor(top);
      if (cut > cuts[cuts.length - 1]) { cuts.push(cut); start = cut; }
    }
  }
  cuts.push(height);
  const parts = cuts.length - 1;
  if (parts > 16) throw new Error(`chat is too tall even tiled (${height}px) — use /export json or /export md`);
  // Base text/background come from <body>, which does not exist inside the
  // SVG — re-apply them on the wrapper. Kept in a CSS rule (not an inline
  // attribute) so quoted font-family values can't break the XML attribute.
  const bodyCS = getComputedStyle(document.body);
  const bg = rootCS.getPropertyValue('--c-bg').trim() || bodyCS.backgroundColor;
  css += `\n.snapwrap{${vars}width:${width}px;margin:0;font-family:${bodyCS.fontFamily};font-size:${bodyCS.fontSize};line-height:${bodyCS.lineHeight};color:${bodyCS.color};background:${bg};}`;
  const xhtml = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="snapwrap"><style><![CDATA[${css.replace(/]]>/g, ']] >')}]]></style>${xhtml}</div>` +
    `</foreignObject></svg>`;
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = () => rej(new Error('snapshot render failed'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  // Rasterize one canvas per part: the whole SVG is drawn into each with its
  // top shifted up by the part's (message-snapped) offset, so every part
  // renders at full resolution. A platform refusing the canvas (memory
  // pressure) fails the export with a hint rather than shipping a blank file.
  const dot = filename.lastIndexOf('.');
  const stem = dot === -1 ? filename : filename.slice(0, dot);
  const ext = dot === -1 ? '' : filename.slice(dot);
  for (let p = 0; p < parts; p++) {
    const off = Math.round(cuts[p] * scale);
    const h = Math.round(cuts[p + 1] * scale) - off;
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable — use /export json or /export md');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, outW, h);
    ctx.drawImage(img, 0, -off, outW, fullH);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error(`PNG encode failed on part ${p + 1}/${parts} — use /export json or /export md`);
    downloadBlob(blob, parts > 1 ? `${stem}-${p + 1}${ext}` : filename);
  }
}

// Plain-text transcript of the active branch as Markdown: persona name on
// user messages, the same speaker resolution the chat column uses on
// assistant replies (multi-speaker swipes split into per-speaker blocks).
// Thinking, tool machinery and swipe alternates are display concerns — only
// the viewed take's text (and image notes) are exported.
function chatTranscriptMarkdown(chat, personaName = 'User', characterNames = []) {
  const path = getActivePath(chat.messages, chat.activeLeafId);
  const out = [`# ${chat.name || 'FictionPad chat'}`, '',
    `_Exported from FictionPad · ${fmtDate(Date.now(), 'dd/mm/yyyy')}_`, ''];
  for (const node of path) {
    const swipe = node.swipes?.[node.activeSwipe ?? 0];
    if (!swipe) continue;
    const text = subUser(swipe.text ?? '', personaName);
    const imgNotes = (swipe.images ?? [])
      .filter(i => i && !i.pending && !i.error)
      .map(i => `_\\[image${i.prompt ? `: ${i.prompt}` : ''}\\]_`);
    if (node.role === 'user') {
      out.push(`**${personaName}:**`, '', text, ...imgNotes, '');
      continue;
    }
    if (node.role !== 'assistant') continue;
    const segments = splitSpeakerSegments(text, characterNames);
    if (segments?.length > 1) {
      for (const seg of segments)
        out.push(`**${seg.speaker ?? 'Narrator'}:**`, '', seg.text, '');
      out.push(...imgNotes, '');
      continue;
    }
    const speaker = swipe.speaker ?? detectSpeaker(text, characterNames) ?? 'Narrator';
    const body = speaker !== 'Narrator' ? stripSpeakerPrefix(text, speaker) : text;
    if (!body.trim() && !imgNotes.length) continue; // tool-only placeholder etc.
    out.push(`**${speaker}:**`, '', body, ...imgNotes, '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    let timer = null;
    // Fallback for browsers without input.oncancel (older WebKit): the picker
    // holds focus, so the window regaining it with no change event within a
    // beat means the dialog was dismissed — settle null.
    const onFocus = () => { timer = setTimeout(() => settle(null), 400); };
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('focus', onFocus); };
    const settle = (file) => { cleanup(); resolve(file); };
    input.onchange = () => settle(input.files?.[0] ?? null);
    // Dismissing the dialog without picking fires oncancel (Chrome/FF 91+) —
    // the fast path. Without either hook the promise never settles and
    // imports silently hang.
    input.oncancel = () => settle(null);
    window.addEventListener('focus', onFocus);
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
  // Prefill is NOT a request param: openaiChatStream strips it from the body
  // and appends it as a trailing assistant message the model continues from.
  { key: 'prefill',            label: 'Prefill', type: 'string', def: '<|think|>' },
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
//   list    — send-checkbox + comma-separated input; the entries are sent as
//             a JSON string array (e.g. vLLM's bad_words: "a, b" → ["a","b"])
const parseListDef = (v) => Array.isArray(v) ? v.map(s => String(s).trim()).filter(Boolean)
  : String(v ?? '').split(',').map(s => s.trim()).filter(Boolean);
const customSamplerFields = (st) => (st?.customSamplers ?? [])
  .filter(d => d?.key?.trim() && !SAMPLER_FIELD_MAP[d.key.trim()])
  .map(d => {
    const options = String(d.choices ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const type = d.type === 'boolean' ? 'boolean' : d.type === 'string' ? 'string' : d.type === 'list' ? 'list' : 'number';
    return {
      key: d.key.trim(),
      label: d.name?.trim() || d.key.trim(),
      type,
      min: Number.isFinite(d.min) ? d.min : 0,
      max: Number.isFinite(d.max) ? d.max : 1,
      step: Number.isFinite(d.step) && d.step > 0 ? d.step : 0.01,
      def: type === 'boolean' ? d.def !== false
        : type === 'string' ? String(d.def ?? options[0] ?? '')
        : type === 'list' ? parseListDef(d.def)
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
// strings, a comma-separated ListInput for lists (array value sent verbatim),
// NumInput otherwise. Shared by every surface that edits a sampler
// set (per-chat overrides, scenario defaults), so the rows can't drift.
const samplerValueCtl = (f, value, onChange) => f.type === 'boolean'
  ? html`<select value=${String(value ?? f.def ?? true)} onChange=${(e) => onChange(e.target.value === 'true')}>
      <option value="true">true</option><option value="false">false</option></select>`
  : f.type === 'string'
    ? (f.options?.length
      ? html`<select value=${String(value ?? f.def ?? '')} onChange=${(e) => onChange(e.target.value)}>
          ${(value != null && value !== '' && !f.options.includes(String(value))
            ? [String(value), ...f.options] : f.options)
            .map(o => html`<option key=${o} value=${o}>${o}</option>`)}</select>`
      : html`<input type="text" value=${String(value ?? '')} placeholder=${f.def || f.key}
          onInput=${(e) => onChange(e.target.value)} />`)
    : f.type === 'list'
      ? html`<${ListInput} delim=',' values=${parseListDef(value)}
          placeholder="comma-separated, sent as an array" onChange=${(arr) => onChange(arr)} />`
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

