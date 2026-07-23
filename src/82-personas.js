// ============================================================================
// COMPONENTS: PERSONA MANAGER
// ============================================================================
function PersonaManager({ personas, onUpsert, onRemove, onClose }) {
  const [editing, setEditing] = useState(null); // draft persona or null
  const [dirty, setDirty] = useState(false);
  const list = Object.values(personas).sort((a, b) => a.name.localeCompare(b.name));
  const startEdit = (p) => { setEditing(p); setDirty(false); };
  const edit = (next) => { setDirty(true); setEditing(next); };
  const cancelEdit = () => { if (!dirty || confirm('Discard unsaved changes?')) setEditing(null); };
  const guardClose = () => {
    if (editing && dirty && !confirm('Discard unsaved changes?')) return;
    onClose();
  };
  return html`
    <${Modal} title="Personas" onClose=${guardClose}>
      ${editing ? html`
        <label class="field"><span>Name — replaces {{user}} everywhere</span>
          <input type="text" value=${editing.name} onInput=${(e) => edit({ ...editing, name: e.target.value })} /></label>
        <label class="field"><span>Description — sent to the AI as "{{user}} is …"</span>
          <textarea rows=${5} value=${editing.description} onInput=${(e) => edit({ ...editing, description: e.target.value })} /></label>
        <div style=${{ display: 'flex', gap: '8px' }}>
          <button class="btn primary" disabled=${!editing.name.trim()}
            onClick=${() => { onUpsert(editing.id, editing); setEditing(null); }}>Save</button>
          <button class="btn" onClick=${cancelEdit}>Cancel</button>
        </div>` : html`
        <button class="btn" onClick=${() => startEdit({ id: uid(), name: '', description: '' })}>+ New persona</button>
        <div style=${{ marginTop: '10px' }}>
          ${list.length === 0 && html`<div class="hint">No personas yet. A persona feeds the {{user}} macro.</div>`}
          ${list.map(p => html`
            <div class="side-item" key=${p.id}>
              <span class="name">${p.name}</span>
              <span class="tools" style=${{ display: 'flex' }}>
                <button class="btn small" onClick=${() => startEdit(deepClone(p))}>edit</button>
                <button class="btn small danger" onClick=${() => onRemove(p.id)}>✕</button>
              </span>
            </div>`)}
        </div>`}
    <//>`;
}

