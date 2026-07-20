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
  contextLength: 8192,
  maxTokens: LENGTH_PRESETS.medium.maxTokens,
  responseLength: 'medium',
  // Editable length instruction appended to the prompt tail; '' = no directive.
  // Follows the preset's default text until the user edits it.
  lengthDirective: LENGTH_PRESETS.medium.directive,
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
  const [draft, setDraft] = useState(() => {
    const d = deepClone(settings);
    // Pre-fill from the active preset so saving an untouched form keeps the
    // current directive instead of blanking it.
    d.lengthDirective ??= LENGTH_PRESETS[d.responseLength ?? 'medium']?.directive ?? '';
    return d;
  });
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
    try { setModels(await listModels({ endpoint: effectiveEndpoint(draft, storageKind === 'server'), apiKey: draft.apiKey, serverToken: draft.serverToken })); }
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
      <label class="field"><span>Date format — message stamps, memories, chat names</span>
        <select value=${draft.dateFormat ?? 'dd/mm/yyyy'} onChange=${(e) => set({ dateFormat: e.target.value })}>
          ${Object.keys(DATE_FORMATS).map(f => html`<option key=${f} value=${f}>${f}</option>`)}
        </select></label>
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
          <span class="hint">Often a separate model name from the chat model; Fetch above populates the list.</span>
        </label>
        <label class="field"><span>Semantic threshold (0–1)</span>
          <input type="number" min="0" max="1" step="0.05" value=${draft.semanticThreshold ?? 0.55}
            onInput=${(e) => set({ semanticThreshold: Number(e.target.value) })} />
          <span class="hint">Cosine similarity a smart lore piece needs to inject. Near-misses show in the Inspector.</span>
        </label>
      </div>
      <div class="grid3">
        <label class="field"><span>Context length (tokens)</span>
          <input type="number" value=${draft.contextLength} onInput=${(e) => set({ contextLength: Number(e.target.value) })} /></label>
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
          <input type="number" value=${draft.maxTokens} onInput=${(e) => set({ maxTokens: Number(e.target.value) })} /></label>
      </div>
      <label class="field"><span>Length directive — instruction appended to the prompt (blank = none)</span>
        <textarea rows=${2} value=${draft.lengthDirective ?? ''}
          onInput=${(e) => set({ lengthDirective: e.target.value })} /></label>
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

