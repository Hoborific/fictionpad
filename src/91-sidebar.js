// ============================================================================
// COMPONENTS: SIDEBAR — collapsible Scenarios / Characters / Chats sections.
// A collapsed section still shows the entries tied to the open chat (its
// scenario, its linked global characters, the chat itself) so the current
// context never vanishes. Collapse state persists in fictionpad.ui.
// ============================================================================
function Sidebar({ scenarios, chats, characters, selectedScenarioId, selectedCharacterId, selectedChatId,
                  onSelectScenario, onSelectCharacter, onSelectChat,
                  onNewScenario, onEditScenario, onDeleteScenario, onNewChat,
                  onNewCharacter, onEditCharacter, onDeleteCharacter, onNewCharacterChat,
                  onExportScenario, onExportCharacter, onImport,
                  onOpenPersonas, onOpenSettings, collapsed, onDeleteChat,
                  sideCollapsed, onToggleSection,
                  storageKind, saveRetrying,
                  width, onDragStart, onResetWidth, onChatAction, onChatContextMenu }) {
  const openChat = chats[selectedChatId] ?? null;
  const chatList = Object.values(chats)
    .filter(c => selectedScenarioId ? c.scenarioId === selectedScenarioId
      : selectedCharacterId ? (c.characterIds ?? []).includes(selectedCharacterId)
      : true)
    .sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0));
  const scenarioList = Object.values(scenarios).sort((a, b) => a.name.localeCompare(b.name));
  const characterList = Object.values(characters ?? {}).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  // Entries that stay visible while their section is collapsed: whatever the
  // open chat is built from.
  const pinScenarioId = openChat?.scenarioId ?? null;
  const pinCharIds = new Set([
    ...(scenarios[openChat?.scenarioId]?.characterIds ?? []),
    ...(openChat?.characterIds ?? []),
  ].filter(id => characters?.[id]));
  const shownScenarios = sideCollapsed.scenarios ? scenarioList.filter(s => s.id === pinScenarioId) : scenarioList;
  const shownCharacters = sideCollapsed.characters ? characterList.filter(c => pinCharIds.has(c.id)) : characterList;
  const shownChats = sideCollapsed.chats ? chatList.filter(c => c.id === selectedChatId) : chatList;
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
  const sectionTitle = (key, label, onAdd, addTitle) => html`
    <div class="title">
      <span class="t-toggle" onClick=${() => onToggleSection(key)}>
        ${sideCollapsed[key] ? '▸' : '▾'} ${label}
      </span>
      ${onAdd && html`<button class="btn small ghost" title=${addTitle} onClick=${onAdd}>＋</button>`}
    </div>`;
  return html`
    <div class="sidebar ${collapsed ? 'collapsed' : ''}"
      style=${{ width: collapsed ? 0 : width, minWidth: collapsed ? 0 : width }}>
      <div class="scroll">
        <div class="side-section">
          ${sectionTitle('scenarios', 'Scenarios', onNewScenario, 'New scenario')}
          ${shownScenarios.length === 0 && !sideCollapsed.scenarios
            && html`<div class="hint" style=${{ padding: '0 6px' }}>No scenarios yet.</div>`}
          ${shownScenarios.map(s => html`
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
          ${sectionTitle('characters', 'Characters', onNewCharacter, 'New character')}
          ${shownCharacters.length === 0 && !sideCollapsed.characters
            && html`<div class="hint" style=${{ padding: '0 6px' }}>No characters yet.</div>`}
          ${shownCharacters.map(c => html`
            <div class="side-item ${c.id === selectedCharacterId ? 'selected' : ''}" key=${c.id}
              onClick=${() => onSelectCharacter(c.id === selectedCharacterId ? null : c.id)}>
              <span class="name">${c.name}</span>
              <span class="tools">
                <button class="btn small ghost" title="New chat with this character"
                  onClick=${(e) => { e.stopPropagation(); onNewCharacterChat(c.id); }}>✉\uFE0E</button>
                <button class="btn small ghost" title="Edit"
                  onClick=${(e) => { e.stopPropagation(); onEditCharacter(c.id); }}>✎</button>
                <button class="btn small ghost" title="Export JSON"
                  onClick=${(e) => { e.stopPropagation(); onExportCharacter(c.id); }}>⤓</button>
                <button class="btn small ghost" title="Delete"
                  onClick=${(e) => { e.stopPropagation(); confirm(`Delete character "${c.name}"? Scenario/chat links become inert.`) && onDeleteCharacter(c.id); }}>✕</button>
              </span>
            </div>`)}
        </div>
        <div class="side-section">
          ${sectionTitle('chats', `Chats${(selectedScenarioId || selectedCharacterId) ? '' : ' (all)'}`, null, null)}
          ${shownChats.length === 0 && !sideCollapsed.chats && html`<div class="hint" style=${{ padding: '0 6px' }}>No chats yet. Use ✉\uFE0E on a scenario or character.</div>`}
          ${shownChats.map(c => html`
            <div class="side-item chat ${c.id === selectedChatId ? 'selected' : ''}" key=${c.id}
              onClick=${() => onSelectChat(c.id)}
              onContextMenu=${(e) => { e.preventDefault(); onChatContextMenu(c.id, e.clientX, e.clientY); }}
              onPointerDown=${(e) => lpStart(e, c.id)}
              onPointerMove=${lpCancel} onPointerUp=${lpCancel} onPointerCancel=${lpCancel}>
              <span class="name">${c.name}</span>
              <span class="tools">
                <button class="btn small ghost" title="Chat panel (options / inspector / memory)"
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
        <button class="btn small ghost" onClick=${onImport}>Import</button>
        <button class="btn small ghost" title="Personas" onClick=${onOpenPersonas}>Personas</button>
        <button class="btn small ghost" onClick=${onOpenSettings}>Settings</button>
        <span class="hint ${saveRetrying ? 'warn' : ''}" style=${{ marginLeft: 'auto', alignSelf: 'center' }}
          title=${saveRetrying
            ? 'Some edits could not be saved (server unreachable) — they are queued and retried automatically.'
            : storageKind === 'server'
              ? 'Scenarios, personas, characters and chats are stored on this server (shared).'
              : 'Data is stored locally in this browser.'}>
          ${saveRetrying ? '⚠\uFE0E saving…' : storageKind === 'server' ? 'server storage' : 'local storage'}</span>
      </div>
      ${!collapsed && html`<div class="pane-handle right" title="Drag to resize · double-click to reset"
        onPointerDown=${(e) => { e.preventDefault(); onDragStart(e.clientX); }}
        onDoubleClick=${onResetWidth} />`}
    </div>`;
}
