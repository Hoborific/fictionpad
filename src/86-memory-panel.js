// ============================================================================
// COMPONENTS: MEMORY PANEL — view / pin / delete memories, manual summarize.
// ============================================================================
function MemoryPanel({ chat, onUpdateChat, onSummarize, summarizing, dateFormat, memoryEvery, cap }) {
  const [hi, setHi] = useState(null); // card id flashed by a supersede-badge jump
  if (!chat) return html`<div class="hint">Select a chat to see its memories.</div>`;
  const memories = [...(chat.memoryStore?.memories ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const setStore = (mems) => onUpdateChat({ ...chat, memoryStore: { ...chat.memoryStore, memories: mems } }, { touch: false });
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
  return html`
    <div>
      <div style=${{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' }}>
        <span class="hint" style=${{ flex: 1 }}>
          ${memories.length}/${cap ?? MEMORY_CAP} memories · auto-summary every ${memoryEvery ?? MEMORY_EVERY} messages
        </span>
        <button class="btn small" disabled=${summarizing} onClick=${() => onSummarize()}>
          ${summarizing ? 'Summarizing…' : 'Summarize now'}</button>
      </div>
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
            <button class="btn small danger" title="Delete memory" onClick=${() => setStore(chat.memoryStore.memories.filter(x => x.id !== m.id))}>✕</button>
          </div>
          <div class="text">${m.text}</div>
          ${m.revNote && html`<div class="hint" style=${{ marginTop: '4px' }}
            title="Change summary recorded by the maintenance pass">change: ${m.revNote}</div>`}
        </div>`)}
    </div>`;
}
