// ============================================================================
// COMPONENTS: PERSONA MANAGER
// ============================================================================
function PersonaManager({ personas, onUpsert, onRemove, onClose, defaultPersonaId, onSetDefault, onGenerateAvatar = null }) {
  const [editing, setEditing] = useState(null); // draft persona or null
  const [dirty, setDirty] = useState(false);
  const list = Object.values(personas).sort((a, b) => a.name.localeCompare(b.name));
  const startEdit = (p) => { setEditing(p); setDirty(false); };
  const edit = (next) => { setDirty(true); setEditing(next); };
  const cancelEdit = async () => { if (!dirty || await uiConfirm('Discard unsaved changes?', { danger: true, okLabel: 'Discard' })) setEditing(null); };
  const guardClose = async () => {
    if (editing && dirty && !await uiConfirm('Discard unsaved changes?', { danger: true, okLabel: 'Discard' })) return;
    onClose();
  };
  return html`
    <${Modal} title="Personas" onClose=${guardClose}>
      ${editing ? html`
        <label class="field"><span>Name — replaces {{user}} everywhere</span>
          <input type="text" value=${editing.name} onInput=${(e) => edit({ ...editing, name: e.target.value })} /></label>
        <${AvatarField} draft=${editing} set=${(patch) => edit({ ...editing, ...patch })} onGenerateAvatar=${onGenerateAvatar} />
        <label class="field"><span>Description — sent to the AI as "{{user}} is …"</span>
          <textarea rows=${5} value=${editing.description} onInput=${(e) => edit({ ...editing, description: e.target.value })} /></label>
        <div style=${{ display: 'flex', gap: '8px' }}>
          <button class="btn primary" disabled=${!editing.name.trim()}
            onClick=${() => { onUpsert(editing.id, editing); setEditing(null); }}>Save</button>
          <button class="btn" onClick=${cancelEdit}>Cancel</button>
        </div>` : html`
        <button class="btn" onClick=${() => startEdit({ id: uid(), name: '', description: '', avatar: '', avatarFull: '' })}>+ New persona</button>
        <div style=${{ marginTop: '10px' }}>
          ${list.length === 0 && html`<div class="hint">No personas yet. A persona feeds the {{user}} macro.</div>`}
          ${list.map(p => html`
            <div class="side-item" key=${p.id}>
              <span class="name">${p.name}${defaultPersonaId === p.id && html` <span class="pill">default</span>`}</span>
              <span class="tools" style=${{ display: 'flex' }}>
                <button class="btn small ${defaultPersonaId === p.id ? 'primary' : ''}"
                  title=${defaultPersonaId === p.id ? 'Default for new chats — click to clear' : 'Make default for new chats'}
                  onClick=${() => onSetDefault(defaultPersonaId === p.id ? '' : p.id)}>★</button>
                <button class="btn small" onClick=${() => startEdit(deepClone(p))}>edit</button>
                <button class="btn small danger" title="Delete persona" onClick=${() => onRemove(p.id)}>✕</button>
              </span>
            </div>`)}
        </div>`}
    <//>`;
}

