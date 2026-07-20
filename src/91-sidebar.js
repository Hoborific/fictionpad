// ============================================================================
// COMPONENTS: SIDEBAR
// ============================================================================
function Sidebar({ scenarios, chats, selectedScenarioId, selectedChatId, onSelectScenario, onSelectChat,
                  onNewScenario, onEditScenario, onDeleteScenario, onNewChat, onExportScenario, onImport,
                  onOpenPersonas, onOpenSettings, collapsed, onToggleCollapse, onDeleteChat,
                  storageKind, saveRetrying,
                  width, onDragStart, onResetWidth, onChatAction, onChatContextMenu }) {
  const chatList = Object.values(chats)
    .filter(c => !selectedScenarioId || c.scenarioId === selectedScenarioId)
    .sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0));
  const scenarioList = Object.values(scenarios).sort((a, b) => a.name.localeCompare(b.name));
  // Long-press (touch) → same context menu as right-click. Cancelled by movement.
  const lp = useRef(null);
  const lpStart = (e, id) => {
    if (e.pointerType === 'mouse') return;
    const { clientX: x, clientY: y } = e;
    lp.current = { x, y, timer: setTimeout(() => { lp.current = null; onChatContextMenu(id, x, y); }, 500) };
  };
  const lpCancel = (e) => {
    if (!lp.current) return;
    if (e.type === 'pointermove'
        && Math.abs(e.clientX - lp.current.x) < 10 && Math.abs(e.clientY - lp.current.y) < 10) return;
    clearTimeout(lp.current.timer);
    lp.current = null;
  };
  const act = (e, id, action) => { e.stopPropagation(); onChatAction(id, action); };
  return html`
    <div class="sidebar ${collapsed ? 'collapsed' : ''}"
      style=${{ width: collapsed ? 0 : width, minWidth: collapsed ? 0 : width }}>
      <div class="head">
        <h1>FictionPad</h1>
        <button class="btn small ghost" title="Personas" onClick=${onOpenPersonas}>Personas</button>
        <button class="btn small ghost" title="Settings" onClick=${onOpenSettings}>⚙\uFE0E</button>
        <button class="btn small ghost" title="Collapse sidebar" onClick=${onToggleCollapse}>«</button>
      </div>
      <div class="scroll">
        <div class="side-section">
          <div class="title">Scenarios
            <button class="btn small ghost" title="New scenario" onClick=${onNewScenario}>＋</button>
          </div>
          ${scenarioList.length === 0 && html`<div class="hint" style=${{ padding: '0 6px' }}>No scenarios yet.</div>`}
          ${scenarioList.map(s => html`
            <div class="side-item ${s.id === selectedScenarioId ? 'selected' : ''}" key=${s.id}
              onClick=${() => onSelectScenario(s.id === selectedScenarioId ? null : s.id)}>
              <span class="name">${s.name}</span>
              <span class="tools">
                <button class="btn small ghost" title="New chat from this scenario"
                  onClick=${(e) => { e.stopPropagation(); onNewChat(s.id); }}>✉\uFE0E</button>
                <button class="btn small ghost" title="Edit"
                  onClick=${(e) => { e.stopPropagation(); onEditScenario(s.id); }}>✎</button>
                <button class="btn small ghost" title="Export JSON"
                  onClick=${(e) => { e.stopPropagation(); onExportScenario(s.id); }}>⤓</button>
                <button class="btn small ghost" title="Delete"
                  onClick=${(e) => { e.stopPropagation(); confirm(`Delete scenario "${s.name}"? Its chats are NOT deleted.`) && onDeleteScenario(s.id); }}>✕</button>
              </span>
            </div>`)}
        </div>
        <div class="side-section">
          <div class="title">Chats${selectedScenarioId ? '' : ' (all)'}</div>
          ${chatList.length === 0 && html`<div class="hint" style=${{ padding: '0 6px' }}>No chats yet. Use ✉\uFE0E on a scenario.</div>`}
          ${chatList.map(c => html`
            <div class="side-item chat ${c.id === selectedChatId ? 'selected' : ''}" key=${c.id}
              onClick=${() => onSelectChat(c.id)}
              onContextMenu=${(e) => { e.preventDefault(); onChatContextMenu(c.id, e.clientX, e.clientY); }}
              onPointerDown=${(e) => lpStart(e, c.id)}
              onPointerMove=${lpCancel} onPointerUp=${lpCancel} onPointerCancel=${lpCancel}>
              <span class="name">${c.name}</span>
              <span class="tools">
                <button class="btn small ghost" title="Inspector"
                  onClick=${(e) => act(e, c.id, 'inspector')}>▦</button>
                <button class="btn small ghost" title="Rename"
                  onClick=${(e) => act(e, c.id, 'rename')}>✎</button>
                <button class="btn small ghost" title="Export JSON"
                  onClick=${(e) => act(e, c.id, 'export')}>⤓</button>
                <button class="btn small ghost" title="Delete chat"
                  onClick=${(e) => act(e, c.id, 'delete')}>✕</button>
              </span>
            </div>`)}
        </div>
      </div>
      <div class="foot">
        <button class="btn small" onClick=${onImport}>Import JSON</button>
        <span class="hint ${saveRetrying ? 'warn' : ''}" style=${{ marginLeft: 'auto', alignSelf: 'center' }}
          title=${saveRetrying
            ? 'Some edits could not be saved (server unreachable) — they are queued and retried automatically.'
            : storageKind === 'server'
              ? 'Scenarios, personas and chats are stored on this server (shared).'
              : 'Data is stored locally in this browser.'}>
          ${saveRetrying ? '⚠\uFE0E saving…' : storageKind === 'server' ? 'server storage' : 'local storage'}</span>
      </div>
      ${!collapsed && html`<div class="pane-handle right" title="Drag to resize · double-click to reset"
        onPointerDown=${(e) => { e.preventDefault(); onDragStart(e.clientX); }}
        onDoubleClick=${onResetWidth} />`}
    </div>`;
}

