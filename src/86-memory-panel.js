// ============================================================================
// COMPONENTS: MEMORY PANEL — view / pin / delete memories, manual summarize.
// ============================================================================
function MemoryPanel({ chat, onUpdateChat, onSummarize, summarizing, dateFormat, memoryEvery, cap }) {
  if (!chat) return html`<div class="hint">Select a chat to see its memories.</div>`;
  const memories = [...(chat.memoryStore?.memories ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const setStore = (mems) => onUpdateChat({ ...chat, memoryStore: { ...chat.memoryStore, memories: mems } }, { touch: false });
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
        <div class="mem-item" key=${m.id}>
          <div class="row">
            ${m.pinned && html`<span class="pill pinned">pinned</span>`}
            ${m.supBy && html`<span class="pill" title="Revised by the lore pass — hidden from context on branches past the revision point; the original text is kept for rewind and older branches">superseded</span>`}
            <span class="hint" style=${{ flex: 1 }}>${fmtDate(m.createdAt, dateFormat)}</span>
            <button class="btn small" onClick=${() => setStore(chat.memoryStore.memories.map(x => x.id === m.id ? { ...x, pinned: !x.pinned } : x))}>
              ${m.pinned ? 'unpin' : 'pin'}</button>
            <button class="btn small danger" title="Delete memory" onClick=${() => setStore(chat.memoryStore.memories.filter(x => x.id !== m.id))}>✕</button>
          </div>
          <div class="text">${m.text}</div>
        </div>`)}
    </div>`;
}

