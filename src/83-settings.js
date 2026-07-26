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
  sidebarArrows: false, // desktop: «/» edge arrows instead of the brand/Inspector buttons as pane toggles (phones always use arrows)
  contextLength: 8192,
  maxTokens: LENGTH_PRESETS.medium.maxTokens,
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
  scenarioGenPrompt: DEFAULT_SCENARIO_GEN_PROMPT, // ✦ Generate in the scenario editor
  characterGenPrompt: DEFAULT_CHARACTER_GEN_PROMPT, // ✦ Generate in the character editor
  toolsEnabled: true, // prompt-based tool calling (register_character / add_lore → chat lore)
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
    try { setModels(await listModels({ endpoint: effectiveEndpoint(draft, storageKind === 'server'), apiKey: draft.apiKey, serverToken: draft.serverToken })); }
    catch (e) { setModels(null); setModelsError(describeApiError(e)); }
  };

  // Manual config check (Connection tab): hits /models with the draft
  // endpoint + key and reports reachability, auth, and whether the configured
  // chat model is actually exposed.
  const [testState, setTestState] = useState(null); // null | 'busy' | { ok, msg }
  const testConnection = async () => {
    setTestState('busy');
    try {
      const list = await listModels({ endpoint: effectiveEndpoint(draft, storageKind === 'server'), apiKey: draft.apiKey, serverToken: draft.serverToken });
      const note = draft.model
        ? (list.includes(draft.model) ? `"${draft.model}" is available.` : `warning: "${draft.model}" is NOT among them.`)
        : 'no chat model configured yet.';
      setTestState({ ok: true, msg: `Connected — ${list.length} model(s) exposed; ${note}` });
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

  return html`
    <${Modal} title="Settings" wide onClose=${guardClose}
      footer=${html`<button class="btn ghost" onClick=${guardClose}>Cancel</button>
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
          <label class="field"><span>API key (sent as Bearer token; ${storageKind === 'server' ? 'synced via server settings' : 'stored locally in this browser'})</span>
            <input type="password" value=${draft.apiKey} onInput=${(e) => set({ apiKey: e.target.value })} /></label>
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
        </div>
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
              <button class="btn small" disabled=${!!bakBusy} title="Snapshot of the server's SQLite database (all users of this server)"
                onClick=${serverBackup}>
                ${bakBusy === 'db' ? 'Downloading…' : 'Download server backup (.db)'}</button>
            </div>
            ${migNote && html`<div class="hint" style=${{ marginTop: '4px' }}>${migNote}</div>`}`}
        </div>
        <div class="field"><span>Export / import everything — one JSON with all scenarios, chats, personas, characters and settings</span>
          <div style=${{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button class="btn small" onClick=${onExportAll}>Export everything (.json)</button>
            <button class="btn small" disabled=${!!bakBusy} onClick=${importBackup}>
              ${bakBusy === 'import' ? 'Importing…' : 'Import backup…'}</button>
          </div>
          <div class="hint" style=${{ marginTop: '4px' }}>Import upserts by id (last write wins) — data missing from the file is kept. The server token never leaves this device: stripped from exports, ignored on imports.</div>
          ${bakNote && html`<div class="hint" style=${{ marginTop: '4px' }}>${bakNote}</div>`}
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
          <div class="hint" style=${{ margin: '-6px 0 6px' }}>Cosine similarity a semantic ("smart") lore piece needs to inject. Near-misses show in the Inspector. Blank resets to 0.55.</div>
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
        <div class="field"><span>Samplers</span>
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
          </div>
          <div class="hint">Unchecked params are not sent.</div>
        </div>
        <label class="field"><span>Stop strings — one per line; generation halts at these (server-side)</span>
          <${ListInput} textarea=${true} delim=${'\n'} rows=${3} values=${draft.stopStrings ?? []}
            placeholder="e.g. your EOS marker, if your model emits one"
            onChange=${(stopStrings) => set({ stopStrings })} /></label>
        <div class="field"><span>Per-chat overrides — the knobs offered in the chat panel's Samplers tab</span>
          <div class="sampler-grid">
            ${allSamplerFields(draft).map(f => html`
              <label class="check" key=${f.key} style=${{ margin: 0 }}>
                <input type="checkbox" checked=${(draft.samplerFields ?? []).includes(f.key)}
                  onChange=${(e) => set({ samplerFields: e.target.checked
                    ? [...(draft.samplerFields ?? []), f.key]
                    : (draft.samplerFields ?? []).filter(k => k !== f.key) })} />
                ${f.label}${f.custom ? ' ✦' : ''}</label>`)}
          </div>
          <div class="hint">A per-chat override replaces the global value for that chat only; knobs unchecked here aren't overridable per chat. Context length and max tokens are always overridable.</div>
        </div>
        <div class="field"><span>Custom samplers (${(draft.customSamplers ?? []).length})
          <button class="btn small" style=${{ marginLeft: '8px' }}
            onClick=${() => set({ customSamplers: [...(draft.customSamplers ?? []), { id: uid(), name: '', key: '', type: 'number', min: 0, max: 1, step: 0.01, def: 0 }] })}>+ add sampler</button></span>
          <div class="hint">Backend-specific params (llama.cpp, vLLM extras…). The request key is sent as-is; a dotted key nests — e.g. key <b>chat_template_kwargs.enable_thinking</b> with type boolean sends <b>chat_template_kwargs: ${'{'}enable_thinking: true/false${'}'}</b>. Built-in keys are reserved. Registered samplers join the lists above.</div>
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
              })} />`)}
        </div>
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
          <button class="btn small" onClick=${() => onOpenLogitBias(draft)}>Edit logit bias…</button>
          <span class="hint" style=${{ marginLeft: '8px' }}>${lbCount} ${lbCount === 1 ? 'entry' : 'entries'}</span>
        </div>`}

      ${tab === 'features' && html`
        <div class="field"><span>Enable features</span>
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
          <label class="check">
            <input type="checkbox" checked=${draft.multiSpeaker !== false} onChange=${(e) => set({ multiSpeaker: e.target.checked })} />
            Multi-speaker replies (model may answer as several characters; each part gets its own bubble)
          </label>
        </div>
        ${draft.suggestions && html`
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
        ${promptField('scenarioGenPrompt', 'Scenario generator prompt — ✦ Generate in the scenario editor', DEFAULT_SCENARIO_GEN_PROMPT, 6,
          'The reply contract is one JSON object with the scenario fields; the request and the current draft are sent as context.')}
        ${promptField('characterGenPrompt', 'Character generator prompt — ✦ Generate in the character editor', DEFAULT_CHARACTER_GEN_PROMPT, 4,
          'The reply contract is one JSON object with name, content, keys and greeting.')}
        ${draft.toolsEnabled !== false
          ? promptField('toolsPrompt', 'Tool protocol instructions — appended to the platform prompt; teaches the model the format. {{user}} works here.', TOOLS_PROMPT, 9)
          : html`<div class="hint">Tool protocol prompt hidden — tool calling is off (Features tab).</div>`}
        ${draft.multiSpeaker !== false
          ? promptField('speakerPrompt', 'Multi-speaker instructions — appended to the platform prompt.', SPEAKER_PROMPT, 4)
          : html`<div class="hint">Multi-speaker prompt hidden — multi-speaker is off (Features tab).</div>`}`}
    <//>`;
}
