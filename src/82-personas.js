// ============================================================================
// COMPONENTS: PERSONA MANAGER
// ============================================================================
function PersonaManager({ personas, onUpsert, onRemove, onClose }) {
  const [editing, setEditing] = useState(null); // draft persona or null
  const list = Object.values(personas).sort((a, b) => a.name.localeCompare(b.name));
  return html`
    <${Modal} title="Personas" onClose=${onClose}>
      ${editing ? html`
        <label class="field"><span>Name — replaces {{user}} everywhere</span>
          <input type="text" value=${editing.name} onInput=${(e) => setEditing({ ...editing, name: e.target.value })} /></label>
        <label class="field"><span>Description — sent to the AI as "{{user}} is …"</span>
          <textarea rows=${5} value=${editing.description} onInput=${(e) => setEditing({ ...editing, description: e.target.value })} /></label>
        <div style=${{ display: 'flex', gap: '8px' }}>
          <button class="btn primary" disabled=${!editing.name.trim()}
            onClick=${() => { onUpsert(editing.id, editing); setEditing(null); }}>Save</button>
          <button class="btn" onClick=${() => setEditing(null)}>Cancel</button>
        </div>` : html`
        <button class="btn" onClick=${() => setEditing({ id: uid(), name: '', description: '' })}>+ New persona</button>
        <div style=${{ marginTop: '10px' }}>
          ${list.length === 0 && html`<div class="hint">No personas yet. A persona feeds the {{user}} macro.</div>`}
          ${list.map(p => html`
            <div class="side-item" key=${p.id}>
              <span class="name">${p.name}</span>
              <span class="tools" style=${{ display: 'flex' }}>
                <button class="btn small" onClick=${() => setEditing(deepClone(p))}>edit</button>
                <button class="btn small danger" onClick=${() => confirm(`Delete persona "${p.name}"?`) && onRemove(p.id)}>✕</button>
              </span>
            </div>`)}
        </div>`}
    <//>`;
}

