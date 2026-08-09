// ============================================================================
// COMPONENTS: SIDEBAR — collapsible Scenarios / Characters / Chats sections.
// A collapsed section still shows the entries tied to the open chat (its
// scenario, its linked global characters, the chat itself) so the current
// context never vanishes. Collapse state persists in fictionpad.ui.
// ============================================================================
// Below this pane width the pane ribbons (sidebar foot, drawer tabs) no longer
// fit on one line — components add a `narrow` class and CSS stacks the ribbons
// instead of squishing/clipping them.
const PANE_NARROW = 270;
// Full-text chat search: the haystack is every swipe text of every node,
// built lazily (only while a query is active) and cached per chat keyed by
// id + updatedAt — a chat's contents only change with updatedAt. Both the raw
// join (for match excerpts) and its lowercase (for matching) are kept.
const chatTextCache = new Map();
function chatSearchText(chat) {
  const key = `${chat.id}@${chat.updatedAt ?? 0}`;
  let hit = chatTextCache.get(key);
  if (!hit) {
    const raw = Object.values(chat.messages ?? {})
      .flatMap(n => (n.swipes ?? []).map(s => s?.text ?? ''))
      .join('\n');
    hit = { raw, lower: raw.toLowerCase() };
    if (chatTextCache.size > 500) chatTextCache.clear();
    chatTextCache.set(key, hit);
  }
  return hit;
}
// ~60 chars of one-line context around a content match, ellipsized at cuts.
function matchExcerpt(raw, i, qlen) {
  const start = Math.max(0, i - 20);
  const end = Math.min(raw.length, i + qlen + 40);
  return (start > 0 ? '…' : '') + raw.slice(start, end).replace(/\s+/g, ' ').trim()
    + (end < raw.length ? '…' : '');
}
function Sidebar({ scenarios, chats, characters, selectedScenarioId, selectedCharacterId, selectedChatId,
                  onSelectScenario, onSelectCharacter, onSelectChat,
                  onNewScenario, onEditScenario, onDeleteScenario, onNewChat,
                  onNewCharacter, onEditCharacter, onDeleteCharacter, onNewCharacterChat,
                  onExportScenario, onExportCharacter, onImport,
                  onOpenPersonas, onOpenSettings, collapsed, onDeleteChat,
                  onScenarioContextMenu, onCharacterContextMenu,
                  sideCollapsed, onToggleSection,
                  storageKind, saveRetrying,
                  width, onDragStart, onResetWidth, onChatAction, onChatContextMenu, peek, peekLeave }) {
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
  // The open chat is always pinned into the list — even when the scenario/
  // character filter would exclude it (chat opened first, filter changed after).
  const baseChats = sideCollapsed.chats ? chatList.filter(c => c.id === selectedChatId) : chatList;
  const pinnedChats = openChat && !baseChats.includes(openChat) ? [openChat, ...baseChats] : baseChats;
  // Chat filter: case-insensitive substring on the chat name, its scenario's
  // name, any linked character's name — or the full message text (every node,
  // every swipe). Name hits render plain; content-only hits show a match
  // excerpt. Non-empty filter ignores the section's collapse state; empty
  // filter = the pinned view above, untouched.
  const [chatFilter, setChatFilter] = useState('');
  const chatQuery = chatFilter.trim().toLowerCase();
  const matchFor = (c) => {
    const nameHit = (c.name ?? '').toLowerCase().includes(chatQuery)
      || (scenarios[c.scenarioId]?.name ?? '').toLowerCase().includes(chatQuery)
      || (c.characterIds ?? []).some(id => (characters?.[id]?.name ?? '').toLowerCase().includes(chatQuery));
    if (nameHit) return { hit: true, excerpt: null };
    const { raw, lower } = chatSearchText(c);
    const i = lower.indexOf(chatQuery);
    return i === -1 ? { hit: false, excerpt: null } : { hit: true, excerpt: matchExcerpt(raw, i, chatQuery.length) };
  };
  const chatMatches = chatQuery ? new Map(chatList.map(c => [c.id, matchFor(c)])) : null;
  const shownChats = chatQuery ? chatList.filter(c => chatMatches.get(c.id).hit) : pinnedChats;
  // Long-press (touch) → same context menu as right-click. Cancelled by movement.
  const lp = useRef(null);
  const lpMenuRef = useRef(false); // menu just opened by long-press — swallow the follow-up click
  const lpStart = (e, id, onMenu = onChatContextMenu) => {
    if (e.pointerType === 'mouse') return;
    lpMenuRef.current = false; // a fresh press supersedes any stale swallow flag
    const { clientX: x, clientY: y } = e;
    lp.current = { x, y, timer: setTimeout(() => { lp.current = null; lpMenuRef.current = true; onMenu(id, x, y); }, 500) };
  };
  // Row click after a long-press must not also fire (the menu just opened).
  const rowClick = (fn) => () => {
    if (lpMenuRef.current) { lpMenuRef.current = false; return; }
    fn();
  };
  const lpCancel = (e) => {
    if (!lp.current) return;
    if (e.type === 'pointermove'
        && Math.abs(e.clientX - lp.current.x) < 10 && Math.abs(e.clientY - lp.current.y) < 10) return;
    clearTimeout(lp.current.timer);
    lp.current = null;
  };
  const act = (e, id, action) => { e.stopPropagation(); onChatAction(id, action); };
  // Chat row thumbnail: the scenario's avatar, else the first linked
  // character's — letter tiles stay a chat-bubble thing, so no image = no icon.
  const chatAvatarEl = (c) => {
    const sc = scenarios[c.scenarioId];
    const ch = sc?.avatar ? null
      : [...(sc?.characterIds ?? []), ...(c.characterIds ?? [])]
        .map(id => characters?.[id]).find(x => x?.avatar);
    const a = sc?.avatar ? { name: sc.name, src: sc.avatar } : ch ? { name: ch.name, src: ch.avatar } : null;
    return a && html`<${Avatar} name=${a.name} src=${a.src} size=${24} />`;
  };
  const sectionTitle = (key, label, onAdd, addTitle) => html`
    <div class="title">
      <span class="t-toggle" onClick=${() => onToggleSection(key)}>
        ${sideCollapsed[key] ? '▸' : '▾'} ${label}
      </span>
      ${onAdd && html`<button class="btn small ghost" title=${addTitle} onClick=${onAdd}>＋</button>`}
    </div>`;
  return html`
    <div class="sidebar ${collapsed ? 'collapsed' : ''} ${!collapsed && width < PANE_NARROW ? 'narrow' : ''} ${peek ? 'peek' : ''}"
      style=${{ width: collapsed ? 0 : width, minWidth: collapsed ? 0 : width }}
      onPointerLeave=${peekLeave}>
      <div class="scroll">
        <div class="side-section">
          ${sectionTitle('scenarios', 'Scenarios', onNewScenario, 'New scenario')}
          ${shownScenarios.length === 0 && !sideCollapsed.scenarios
            && html`<div class="hint" style=${{ padding: '0 6px' }}>No scenarios yet.</div>`}
          ${shownScenarios.map(s => html`
            <div class="side-item ${s.id === selectedScenarioId ? 'selected' : ''}" key=${s.id}
              onClick=${rowClick(() => onSelectScenario(s.id === selectedScenarioId ? null : s.id))}
              onContextMenu=${(e) => { e.preventDefault(); onScenarioContextMenu(s.id, e.clientX, e.clientY); }}
              onPointerDown=${(e) => lpStart(e, s.id, onScenarioContextMenu)}
              onPointerMove=${lpCancel} onPointerUp=${lpCancel} onPointerCancel=${lpCancel}>
              ${s.avatar && html`<${Avatar} name=${s.name} src=${s.avatar} size=${24} />`}
              <span class="name">${s.name}</span>
              <span class="tools">
                <span class="tools-full">
                  <button class="btn small ghost" title="New chat from this scenario"
                    onClick=${(e) => { e.stopPropagation(); onNewChat(s.id); }}>✚</button>
                  <button class="btn small ghost" title="Edit"
                    onClick=${(e) => { e.stopPropagation(); onEditScenario(s.id); }}>✎</button>
                  <button class="btn small ghost" title="Export JSON"
                    onClick=${(e) => { e.stopPropagation(); onExportScenario(s.id); }}>⤓</button>
                  <button class="btn small ghost" title="Delete"
                    onClick=${(e) => { e.stopPropagation(); onDeleteScenario(s.id); }}>✕</button>
                </span>
                <button class="btn small ghost tools-menu" title="Scenario actions"
                  onClick=${(e) => { e.stopPropagation(); onScenarioContextMenu(s.id, e.clientX, e.clientY); }}>⋯</button>
              </span>
            </div>`)}
        </div>
        <div class="side-section">
          ${sectionTitle('characters', 'Characters', onNewCharacter, 'New character')}
          ${shownCharacters.length === 0 && !sideCollapsed.characters
            && html`<div class="hint" style=${{ padding: '0 6px' }}>No characters yet.</div>`}
          ${shownCharacters.map(c => html`
            <div class="side-item ${c.id === selectedCharacterId ? 'selected' : ''}" key=${c.id}
              onClick=${rowClick(() => onSelectCharacter(c.id === selectedCharacterId ? null : c.id))}
              onContextMenu=${(e) => { e.preventDefault(); onCharacterContextMenu(c.id, e.clientX, e.clientY); }}
              onPointerDown=${(e) => lpStart(e, c.id, onCharacterContextMenu)}
              onPointerMove=${lpCancel} onPointerUp=${lpCancel} onPointerCancel=${lpCancel}>
              ${c.avatar && html`<${Avatar} name=${c.name} src=${c.avatar} size=${24} />`}
              <span class="name">${c.name}</span>
              <span class="tools">
                <span class="tools-full">
                  <button class="btn small ghost" title="New chat with this character"
                    onClick=${(e) => { e.stopPropagation(); onNewCharacterChat(c.id); }}>✚</button>
                  <button class="btn small ghost" title="Edit"
                    onClick=${(e) => { e.stopPropagation(); onEditCharacter(c.id); }}>✎</button>
                  <button class="btn small ghost" title="Export JSON"
                    onClick=${(e) => { e.stopPropagation(); onExportCharacter(c.id); }}>⤓</button>
                  <button class="btn small ghost" title="Delete"
                    onClick=${(e) => { e.stopPropagation(); onDeleteCharacter(c.id); }}>✕</button>
                </span>
                <button class="btn small ghost tools-menu" title="Character actions"
                  onClick=${(e) => { e.stopPropagation(); onCharacterContextMenu(c.id, e.clientX, e.clientY); }}>⋯</button>
              </span>
            </div>`)}
        </div>
        <div class="side-section">
          ${sectionTitle('chats', `Chats${(selectedScenarioId || selectedCharacterId) ? '' : ' (all)'}`, null, null)}
          <input type="text" class="chat-search" placeholder="Search…" value=${chatFilter}
            onInput=${(e) => setChatFilter(e.target.value)}
            style=${{ margin: '0 0 6px', padding: '3px 8px', fontSize: '13px' }} />
          ${shownChats.length === 0 && chatQuery
            && html`<div class="hint" style=${{ padding: '0 6px' }}>No chats match.</div>`}
          ${shownChats.length === 0 && !chatQuery && !sideCollapsed.chats && html`<div class="hint" style=${{ padding: '0 6px' }}>No chats yet. Use ✚ on a scenario or character.</div>`}
          ${shownChats.map(c => html`
            <div class="side-item chat ${c.id === selectedChatId ? 'selected' : ''}" key=${c.id}
              onClick=${() => {
                // A long-press already opened the context menu — don't also
                // switch the chat out from underneath it.
                if (lpMenuRef.current) { lpMenuRef.current = false; return; }
                onSelectChat(c.id);
              }}
              onContextMenu=${(e) => { e.preventDefault(); onChatContextMenu(c.id, e.clientX, e.clientY); }}
              onPointerDown=${(e) => lpStart(e, c.id)}
              onPointerMove=${lpCancel} onPointerUp=${lpCancel} onPointerCancel=${lpCancel}>
              ${chatAvatarEl(c)}
              <span class="name">${c.name}${chatMatches?.get(c.id)?.excerpt
                && html`<span class="chat-match">${chatMatches.get(c.id).excerpt}</span>`}</span>
              <span class="tools">
                <span class="tools-full">
                  <button class="btn small ghost" title="Inspector"
                    onClick=${(e) => act(e, c.id, 'inspector')}>▦</button>
                  <button class="btn small ghost" title="Rename"
                    onClick=${(e) => act(e, c.id, 'rename')}>✎</button>
                  <button class="btn small ghost" title="Export JSON"
                    onClick=${(e) => act(e, c.id, 'export')}>⤓</button>
                  <button class="btn small ghost" title="Delete chat"
                    onClick=${(e) => act(e, c.id, 'delete')}>✕</button>
                </span>
                <button class="btn small ghost tools-menu" title="Chat actions"
                  onClick=${(e) => { e.stopPropagation(); onChatContextMenu(c.id, e.clientX, e.clientY); }}>⋯</button>
              </span>
            </div>`)}
        </div>
      </div>
      <div class="foot">
        <button class="btn small ghost" onClick=${onImport}>Import</button>
        <button class="btn small ghost" title="Personas" onClick=${onOpenPersonas}>Personas</button>
        <button class="btn small ghost" onClick=${onOpenSettings}>Settings</button>
        <span class="hint storage-hint ${saveRetrying ? 'warn' : ''}"
          title=${saveRetrying
            ? 'Some edits could not be saved (server unreachable) — they are queued and retried automatically.'
            : storageKind === 'server'
              ? 'Scenarios, personas, characters and chats are stored on this server (shared).'
              : 'Data is stored locally in this browser.'}>
          ${saveRetrying ? '⚠\uFE0E saving…' : storageKind === 'server' ? 'server' : 'local'}</span>
        <span class="hint version" title="FictionPad version">v${APP_VERSION}</span>
      </div>
      ${!collapsed && html`<div class="pane-handle right" title="Drag to resize · double-click to reset"
        onPointerDown=${(e) => { e.preventDefault(); onDragStart(e.clientX); }}
        onDoubleClick=${onResetWidth} />`}
    </div>`;
}
