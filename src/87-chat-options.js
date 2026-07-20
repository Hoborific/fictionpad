// ============================================================================
// COMPONENTS: CHAT OPTIONS TAB — per-chat settings.
// ============================================================================
function ChatOptions({ chat, personas, onUpdateChat, onExport, onDelete }) {
  if (!chat) return html`<div class="hint">Select a chat first.</div>`;
  return html`
    <div>
      <label class="field"><span>Chat name</span>
        <input type="text" value=${chat.name} onInput=${(e) => onUpdateChat({ ...chat, name: e.target.value })} /></label>
      <label class="field"><span>Persona ({{user}})</span>
        <select value=${chat.personaId ?? ''} onChange=${(e) => onUpdateChat({ ...chat, personaId: e.target.value || null })}>
          <option value="">— none ({{user}} → "User") —</option>
          ${Object.values(personas).map(p => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}
        </select></label>
      <label class="field"><span>Model override (this chat only; blank = global chat model)</span>
        <input type="text" value=${chat.settings?.model ?? ''} placeholder="(global)"
          onInput=${(e) => onUpdateChat({ ...chat, settings: { ...(chat.settings ?? {}), model: e.target.value.trim() || undefined } })} /></label>
      <label class="field"><span>Custom instructions — appended to the system layer for this chat only</span>
        <textarea rows=${4} value=${chat.customInstructions ?? ''}
          onInput=${(e) => onUpdateChat({ ...chat, customInstructions: e.target.value })} /></label>
      <div style=${{ display: 'flex', gap: '6px' }}>
        <button class="btn small" onClick=${onExport}>Export chat JSON</button>
        <button class="btn small danger" onClick=${onDelete}>Delete chat</button>
      </div>
    </div>`;
}

