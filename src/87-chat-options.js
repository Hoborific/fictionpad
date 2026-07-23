// ============================================================================
// COMPONENTS: CHAT OPTIONS TAB — per-chat settings.
// ============================================================================
function ChatOptions({ chat, personas, scenario, characters, onUpdateChat, onExport, onDelete }) {
  if (!chat) return html`<div class="hint">Select a chat first.</div>`;
  const pieces = Array.isArray(chat.lorePieces) ? chat.lorePieces : [];
  const allPieces = mergedLorePieces(scenario, chat, characters);
  const linkedChars = resolveCharacters(scenario, chat, characters);
  const setPieces = (lorePieces) => onUpdateChat({ ...chat, lorePieces });
  return html`
    <div>
      <label class="field"><span>Chat name</span>
        <input type="text" value=${chat.name} onInput=${(e) => onUpdateChat({ ...chat, name: e.target.value })} /></label>
      <label class="field"><span>Persona ({{user}})</span>
        <select value=${chat.personaId ?? ''} onChange=${(e) => onUpdateChat({ ...chat, personaId: e.target.value || null })}>
          <option value="">— none ({{user}} → "User") —</option>
          ${Object.values(personas).map(p => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}
        </select></label>
      <label class="field"><span>Model override (this chat only; blank = global chat model)</span>
        <input type="text" value=${chat.settings?.model ?? ''} placeholder="(global)"
          onInput=${(e) => onUpdateChat({ ...chat, settings: { ...(chat.settings ?? {}), model: e.target.value.trim() || undefined } })} /></label>
      ${linkedChars.length > 0 && html`
        <div class="hint">Linked characters (global cards — edits apply live everywhere): ${linkedChars.map(p => p.title).join(', ')}</div>`}
      <label class="field"><span>Custom instructions — appended to the system layer for this chat only</span>
        <textarea rows=${4} value=${chat.customInstructions ?? ''}
          onInput=${(e) => onUpdateChat({ ...chat, customInstructions: e.target.value })} /></label>
      <label class="field"><span>Author's note — sticky steering injected after custom instructions; "note"-action tools append here</span>
        <textarea rows=${2} value=${chat.authorsNote ?? ''}
          onInput=${(e) => onUpdateChat({ ...chat, authorsNote: e.target.value })} /></label>
      ${Object.keys(chat.vars ?? {}).length > 0 && html`
        <div class="hint">Story variables (usable as {{var:name}}): ${Object.entries(chat.vars).map(([k, v]) => `${k} = ${v}`).join(' · ')}</div>`}
      ${(chat.loreQueue ?? []).length > 0 && html`
        <div class="field">
          <span>Suggested lore — awaiting review (${chat.loreQueue.length})</span>
          <div class="hint">Proposed by the model or the extraction pass. Accept moves it into this chat's lore as yours; dismiss discards it.</div>
          ${chat.loreQueue.map(q => html`
            <div class="lore-card" key=${q.id}>
              <div class="lc-head">
                <span class="t">${q.title || '(untitled)'}</span>
                <span class="pill">${q.source === 'extract' ? 'extracted' : 'tool'}</span>
                <button class="btn small" onClick=${() => onUpdateChat(acceptQueuedLore(chat, q.id))}>accept</button>
                <button class="btn small danger" onClick=${() => onUpdateChat(dismissQueuedLore(chat, q.id))}>✕</button>
              </div>
              <div class="hint" style=${{ padding: '2px 8px 6px' }}>${toPreview(q.content, 160)}</div>
            </div>`)}
        </div>`}
      <div class="field">
        <span>Lore — this chat only (${pieces.length})
          <button class="btn small" style=${{ marginLeft: '8px' }}
            onClick=${() => setPieces([...pieces, newLorePiece()])}>+ add piece</button>
        </span>
        <div class="hint">Merged over the scenario's lore at generation time (chat wins on a shared id). Characters added here join speaker colours, /pov, and smart activation for this chat only.</div>
        ${pieces.map(p => html`
          <${LorePieceCard} key=${p.id} piece=${p} allPieces=${allPieces}
            onChange=${(next) => setPieces(pieces.map(q => q.id === p.id ? next : q))}
            onRemove=${() => setPieces(pieces.filter(q => q.id !== p.id))} />`)}
      </div>
      <div style=${{ display: 'flex', gap: '6px' }}>
        <button class="btn small" onClick=${onExport}>Export chat JSON</button>
        <button class="btn small danger" onClick=${onDelete}>Delete chat</button>
      </div>
    </div>`;
}

