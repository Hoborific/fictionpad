// ============================================================================
// COMPONENTS: CHAT PANEL — the former right pane as a tabbed modal sheet
// (Inspector / Memory / Chat). Centered dialog on desktop, full-screen sheet
// on phones (CSS .modal.sheet).
// ============================================================================
const PANEL_TABS = { inspector: 'Inspector', memory: 'Memory', chat: 'Chat' };

// Shared tab body for ChatPanelModal and RightDrawer — same three branches,
// same props. Without a chat, only the drawer can be open, and it shows a hint.
function PanelBody({ chat, tab, manifest, realCounts, onPreview, auxLog, personas, scenario, characters,
                    onUpdateChat, onSummarize, summarizing, onExport, onDelete, dateFormat, memoryEvery, cap }) {
  return html`
    <div class="pbody">
      ${!chat && html`<div class="hint">Select a chat to inspect its context and memories.</div>`}
      ${chat && tab === 'inspector' && html`
        <${ContextInspector} manifest=${manifest} hasChat=${true} onPreview=${onPreview} realCounts=${realCounts} auxLog=${auxLog} />`}
      ${chat && tab === 'memory' && html`
        <${MemoryPanel} chat=${chat} onUpdateChat=${onUpdateChat} onSummarize=${onSummarize} summarizing=${summarizing} dateFormat=${dateFormat} memoryEvery=${memoryEvery} cap=${cap} />`}
      ${chat && tab === 'chat' && html`
        <${ChatOptions} chat=${chat} personas=${personas} scenario=${scenario} characters=${characters}
          onUpdateChat=${onUpdateChat} onExport=${onExport} onDelete=${onDelete} />`}
    </div>`;
}

function ChatPanelModal({ chat, tab, onTab, manifest, realCounts, onPreview, auxLog, personas, scenario, characters,
                         onUpdateChat, onSummarize, summarizing, onExport, onDelete, onClose, dateFormat, memoryEvery, cap }) {
  return html`
    <${Modal} title=${chat.name} cls="sheet" onClose=${onClose}>
      <div class="ptabs">
        ${Object.entries(PANEL_TABS).map(([t, label]) => html`
          <button key=${t} class=${tab === t ? 'active' : ''} onClick=${() => onTab(t)}>${label}</button>`)}
      </div>
      <${PanelBody} chat=${chat} tab=${tab} manifest=${manifest} realCounts=${realCounts} onPreview=${onPreview}
        auxLog=${auxLog} personas=${personas} scenario=${scenario} characters=${characters}
        onUpdateChat=${onUpdateChat} onSummarize=${onSummarize} summarizing=${summarizing}
        onExport=${onExport} onDelete=${onDelete} dateFormat=${dateFormat} memoryEvery=${memoryEvery} cap=${cap} />
    <//>`;
}

// ============================================================================
// COMPONENTS: RIGHT DRAWER — docked Inspector/Memory/Chat pane (the per-chat
// modal above remains for chat-row/context-menu entry). Fixed overlay on the
// right like the left sidebar, drag-resizable on desktop, slide-in overlay on
// phones.
// ============================================================================
function RightDrawer({ chat, tab, onTab, manifest, realCounts, onPreview, auxLog,
                      personas, scenario, characters, onExport, onDelete,
                      onUpdateChat, onSummarize, summarizing,
                      width, onDragStart, onResetWidth, onClose, dateFormat, memoryEvery, cap }) {
  return html`
    <div class="drawer ${tab ? '' : 'collapsed'}"
      style=${{ width: tab ? width : 0, minWidth: tab ? width : 0 }}>
      <div class="head">
        <div class="ptabs">
          ${Object.entries(PANEL_TABS).map(([t, label]) => html`
            <button key=${t} class=${tab === t ? 'active' : ''} onClick=${() => onTab(t)}>${label}</button>`)}
        </div>
        <button class="btn small ghost" title="Close panel" onClick=${onClose}>✕</button>
      </div>
      <${PanelBody} chat=${chat} tab=${tab} manifest=${manifest} realCounts=${realCounts} onPreview=${onPreview}
        auxLog=${auxLog} personas=${personas} scenario=${scenario} characters=${characters}
        onUpdateChat=${onUpdateChat} onSummarize=${onSummarize} summarizing=${summarizing}
        onExport=${onExport} onDelete=${onDelete} dateFormat=${dateFormat} memoryEvery=${memoryEvery} cap=${cap} />
      ${tab && html`<div class="pane-handle left" title="Drag to resize · double-click to reset"
        onPointerDown=${(e) => { e.preventDefault(); onDragStart(e.clientX); }}
        onDoubleClick=${onResetWidth} />`}
    </div>`;
}
