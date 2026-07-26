// ============================================================================
// COMPONENTS: NEW CHAT MODAL (scenario or global character → pick persona)
// ============================================================================
function NewChatModal({ scenario, character, personas, initialPersonaId, onCreate, onClose }) {
  const list = Object.values(personas).sort((a, b) => a.name.localeCompare(b.name));
  // Preselect the default/last-used persona when one is passed in — the
  // inline name field still applies once the user selects "— none —".
  const [personaId, setPersonaId] = useState(initialPersonaId ?? '');
  const [newName, setNewName] = useState('');
  return html`
    <${Modal} title=${`New chat — ${scenario?.name ?? character?.name ?? ''}`} onClose=${onClose}
      footer=${html`<button class="btn primary" onClick=${() => onCreate(personaId, newName)}>Start chat</button>`}>
      ${character && !scenario && html`
        <div class="hint">Direct chat with ${character.name} — no scenario. The character's greeting opens the chat; its card behaves like a linked character (edits apply live).</div>`}
      <label class="field"><span>Persona ({{user}})</span>
        <select value=${personaId} onChange=${(e) => setPersonaId(e.target.value)}>
          <option value="">— none ({{user}} → "User") —</option>
          ${list.map(p => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}
        </select></label>
      <label class="field"><span>…or create a persona inline (used when nothing is selected above)</span>
        <input type="text" placeholder="New persona name" value=${newName} onInput=${(e) => setNewName(e.target.value)} />
      </label>
    <//>`;
}

// ============================================================================
// COMPONENTS: RECAP MODAL (/recap result — copy or save as memory)
// ============================================================================
function RecapModal({ text, onSaveMemory, onClose }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  return html`
    <${Modal} title="Recap" wide onClose=${onClose}
      footer=${html`
        <button class="btn" disabled=${copied}
          onClick=${async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch {} }}>
          ${copied ? 'Copied ✓' : 'Copy'}</button>
        <button class="btn primary" disabled=${saved}
          onClick=${() => { onSaveMemory(); setSaved(true); }}>
          ${saved ? 'Saved ✓' : 'Save as memory'}</button>
      `}>
      <div style=${{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>${text}</div>
    <//>`;
}

// ============================================================================
// COMPONENTS: CONTEXT MENU (chat rows — right-click / long-press)
// ============================================================================
function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  const style = {
    left: Math.max(4, Math.min(x, window.innerWidth - 190)),
    top: Math.max(4, Math.min(y, window.innerHeight - items.length * 34 - 12)),
  };
  return html`
    <div class="ctx-menu" ref=${ref} style=${style}>
      ${items.map((it, i) => it === '-'
        ? html`<div key=${i} class="ctx-sep" />`
        : html`<button key=${i} class="ctx-item ${it.danger ? 'danger' : ''}" disabled=${!!it.disabled}
            onClick=${() => { if (it.disabled) return; onClose(); it.fn(); }}>${it.label}</button>`)}
    </div>`;
}

