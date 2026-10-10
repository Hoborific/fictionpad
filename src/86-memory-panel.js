// ============================================================================
// COMPONENTS: MEMORY PANEL — view / pin / edit / delete memories, manual summarize.
// ============================================================================
function MemoryPanel({ chat, onUpdateChat, onSummarize, summarizing, dateFormat, memoryEvery, cap }) {
  const [hi, setHi] = useState(null); // card id flashed by a supersede-badge jump
  const [editId, setEditId] = useState(null); // card id being edited inline
  const [draft, setDraft] = useState('');
  if (!chat) return html`<div class="hint">Select a chat to see its memories.</div>`;
  const memories = [...(chat.memoryStore?.memories ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const setStore = (mems) => onUpdateChat({ ...chat, memoryStore: { ...chat.memoryStore, memories: mems } }, { touch: false });
  // Last summary/lore-pass failure: the pass skipped its window on purpose
  // (no re-banner loop) but recorded the error here so it isn't invisible.
  // Dismiss just drops the record; a successful pass clears its own kind.
  const lastError = chat.memoryStore?.lastError;
  const dismissError = () => {
    const { lastError: _drop, ...rest } = chat.memoryStore ?? { memories: [], cursor: 0 };
    onUpdateChat({ ...chat, memoryStore: rest }, { touch: false });
  };
  // Superseded badge → scroll to the replacement card and flash its border.
  const jumpTo = (id) => {
    setHi(id);
    if (typeof document !== 'undefined')
      document.getElementById(`mem-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  // Restore a superseded card: drop the supersede marks so the note shows
  // again on branches where the supersede point had hidden it. The newer
  // replacement card is untouched.
  const restore = (m) => setStore(chat.memoryStore.memories.map(x => {
    if (x.id !== m.id) return x;
    const { supBy, supAtMsgs, supAtMsg, ...rest } = x;
    return rest;
  }));
  // Direct USER edit — deliberately rewind-exempt (a present-tense action,
  // per the rollback rules), so the text is rewritten in place: no stamps,
  // no revision log, pin/supersede state untouched. Editing a superseded
  // note is allowed; it stays hidden by derivation.
  const startEdit = (m) => { setEditId(m.id); setDraft(m.text); };
  const saveEdit = (m) => {
    const text = draft.trim();
    if (text) setStore(chat.memoryStore.memories.map(x => x.id === m.id ? { ...x, text } : x));
    setEditId(null);
  };
  return html`
    <div>
      <div style=${{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' }}>
        <span class="hint" style=${{ flex: 1 }}>
          ${memories.length}/${cap ?? MEMORY_CAP} memories · auto-summary every ${memoryEvery ?? MEMORY_EVERY} messages
        </span>
        <button class="btn small" disabled=${summarizing} onClick=${() => onSummarize()}>
          ${summarizing ? 'Summarizing…' : 'Summarize now'}</button>
      </div>
      ${lastError && html`
        <div class="mem-item" style=${{ borderColor: 'var(--c-warning)' }}>
          <div class="row">
            <span class="warn" style=${{ flex: 1 }}>
              ⚠\uFE0E ${lastError.kind === 'lore' ? 'Lore maintenance' : 'Auto-summary'} failed — that window was skipped.${lastError.at ? ` ${fmtDate(lastError.at, dateFormat)}` : ''}
            </span>
            <button class="btn small" title="Dismiss — the next successful pass clears this too" onClick=${dismissError}>✕</button>
          </div>
          ${lastError.error ? html`<div class="text">${lastError.error}</div>` : null}
        </div>`}
      ${memories.length === 0 && html`<div class="hint">No memories yet. They are created automatically as the chat grows, and are versioned with the chat (branches fork them, rewinds roll them back).</div>`}
      ${memories.map(m => html`
        <div class="mem-item ${hi === m.id ? 'hi' : ''}" key=${m.id} id=${`mem-${m.id}`}>
          <div class="row">
            ${m.pinned && !m.supBy && html`<span class="pill pinned">pinned</span>`}
            ${m.supBy && html`<span class="pill" role="button" style=${{ cursor: 'pointer' }}
              title="Revised by the lore pass — hidden from context on branches past the revision point; the original text is kept for rewind and older branches. Click to jump to the replacement."
              onClick=${() => jumpTo(m.supBy)}>superseded</span>`}
            <span class="hint" style=${{ flex: 1 }}>${fmtDate(m.createdAt, dateFormat)}</span>
            ${!m.supBy && html`<button class="btn small" onClick=${() => setStore(chat.memoryStore.memories.map(x => x.id === m.id ? { ...x, pinned: !x.pinned } : x))}>
              ${m.pinned ? 'unpin' : 'pin'}</button>`}
            ${m.supBy && html`<button class="btn small" title="Clear the supersede marks — this note shows again where the revision had hidden it"
              onClick=${() => restore(m)}>restore</button>`}
            ${editId !== m.id && html`<button class="btn small" title="Edit memory text — rewritten in place (a deliberate edit, so rewinds do not roll it back)"
              onClick=${() => startEdit(m)}>✎\uFE0E</button>`}
            <button class="btn small danger" title="Delete memory" onClick=${() => setStore(chat.memoryStore.memories.filter(x => x.id !== m.id))}>✕</button>
          </div>
          ${editId === m.id ? html`
            <textarea class="edit" rows=${3} style=${{ width: '100%', marginTop: '4px' }} value=${draft} onInput=${(e) => setDraft(e.target.value)} />
            <div style=${{ display: 'flex', gap: '6px', marginTop: '4px' }}>
              <button class="btn small primary" disabled=${!draft.trim()} onClick=${() => saveEdit(m)}>Save</button>
              <button class="btn small" onClick=${() => setEditId(null)}>Cancel</button>
            </div>` : html`
            <div class="text">${m.text}</div>`}
          ${m.revNote && html`<div class="hint" style=${{ marginTop: '4px' }}
            title="Change summary recorded by the maintenance pass">change: ${m.revNote}</div>`}
        </div>`)}
    </div>`;
}
