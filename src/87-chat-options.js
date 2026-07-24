// ============================================================================
// COMPONENTS: CHAT OPTIONS TAB — per-chat settings.
// ============================================================================
function ChatOptions({ chat, personas, scenario, characters, onUpdateChat, onExport, onDelete }) {
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
            onClick=${() => setPieces([...pieces, newLorePiece()])}>+ add piece</button>
        </span>
        <div class="hint">Merged over the scenario's lore at generation time (chat wins on a shared id). Characters added here join speaker colours, /pov, and semantic activation for this chat only.</div>
        ${pieces.map(p => html`
          <${LorePieceCard} key=${p.id} piece=${p} allPieces=${allPieces}
            onChange=${(next) => setPieces(pieces.map(q => q.id === p.id ? next : q))}
            onRemove=${() => setPieces(pieces.filter(q => q.id !== p.id))} />`)}
      </div>
      <div style=${{ display: 'flex', gap: '6px' }}>
        <button class="btn small" onClick=${() => onExport()}>Export chat JSON</button>
        <button class="btn small danger" onClick=${() => onDelete()}>Delete chat</button>
      </div>
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

