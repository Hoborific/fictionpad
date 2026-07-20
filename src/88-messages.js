// ============================================================================
// COMPONENTS: MESSAGE + COMPOSER + CHAT PANE
// ============================================================================
// ============================================================================
// COMPONENTS: PROBS VIEW — per-token spans with probability tint + hover
// popover (top-10 alternatives, click to branch generation from that token).
// ============================================================================
const visibleTok = (t) => String(t ?? '').replace(/ /g, '␣').replace(/\t/g, '⇥').replace(/\n/g, '↵\n');
const probPct = (lp) => lp == null ? null : Math.exp(lp) * 100;

function ProbsView({ tokens, onPick }) {
  return html`
    <div class="probs-view">
      ${tokens.map((t, i) => {
        if (t.logprob == null) // no prob data for this chunk: plain span, no popover
          return html`<span key=${i}>${t.text}</span>`;
        const pct = probPct(t.logprob);
        const bg = pct == null ? 'transparent'
          : `color-mix(in oklch, color-mix(in oklch, var(--c-good) ${Math.round(pct)}%, var(--c-danger)) 30%, transparent)`;
        return html`
          <span key=${i} class="tok" style=${{ background: bg }}>${t.text}<span class="pop">
            <div class="pop-row head"><span class="tt">${visibleTok(t.text) || '∅'}</span>
              <span class="pc">${pct == null ? 'n/a' : pct.toFixed(1) + '%'}</span></div>
            ${(t.top ?? []).map((alt, j) => {
              const ap = probPct(alt.logprob);
              return html`<div key=${j} class="pop-row alt" onClick=${() => onPick(i, alt.token)}>
                <span class="rank">#${j + 1}</span><span class="tt">${visibleTok(alt.token)}</span>
                <span class="pc">${ap == null ? '' : ap.toFixed(1) + '%'}</span></div>`;
            })}
            <div class="pop-row alt" onClick=${() => onPick(i, null)}><span class="tt">↻ from here</span></div>
          </span></span>`;
      })}
    </div>`;
}

function MessageItem({ node, index, isRoot, isLeaf, personaName, characterNames, streaming, generating, dateFormat, onEdit, onRegenerate, onSwipe, onSwipeTo, onBranch, onRewind, onDelete, onReply, onRegenFromToken }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [showProbs, setShowProbs] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false); // mobile: actions collapsed behind ›
  const [metaOpen, setMetaOpen] = useState(false); // mobile: meta details collapsed behind ›
  // Auto-hide the actions/meta popovers when tapping anywhere else.
  useEffect(() => {
    if (!actionsOpen && !metaOpen) return;
    const onDown = (e) => {
      if (!e.target.closest?.('.actions, .actions-toggle')) setActionsOpen(false);
      if (!e.target.closest?.('.meta-details, .meta-toggle')) setMetaOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [actionsOpen, metaOpen]);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y } — right-click on the message
  const swipe = node.swipes[node.activeSwipe] ?? { text: '' };
  const text = subUser(swipe.text, personaName);
  const isUser = node.role === 'user';
  const isOOC = /^\[OOC:/i.test(text.trim());
  const hasProbs = !isUser && Array.isArray(swipe.tokens) && swipe.tokens.length > 0;
  const speaker = isUser ? null : (swipe.speaker ?? detectSpeaker(text, characterNames) ?? 'Narrator');
  const isCharacter = !!speaker && speaker !== 'Narrator';
  // The speaker is already labeled in the meta row — hide the `Name:` prefix.
  const displayText = isCharacter ? stripSpeakerPrefix(text, speaker) : text;
  const n = node.activeSwipe + 1, m = node.swipes.length;
  const isLeafAssistant = isLeaf && !isUser;
  const showNav = m > 1 || isLeafAssistant;
  const usedIdx = Number.isInteger(node.usedSwipe) ? node.usedSwipe : null;
  const atUsed = usedIdx === node.activeSwipe;

  // Horizontal swipe gesture (touch/pen only) mirroring the swipe navigator:
  // left = next swipe / ▶⁺ on the leaf, right = previous swipe.
  const [dragX, setDragX] = useState(0);
  const gestureRef = useRef(null);
  const gestureHandlers = (isUser || generating) ? {} : {
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse' || editing) return;
      gestureRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, consumed: false };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    },
    onPointerMove: (e) => {
      const g = gestureRef.current;
      if (!g || g.id !== e.pointerId) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (g.consumed) return; // one action per gesture
      if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) {
        g.consumed = true;
        setDragX(0);
        if (dx < 0) { // swipe left: next swipe, or generate on the leaf's last
          if (n < m) onSwipe(node.id, 1);
          else if (isLeafAssistant) onRegenerate(node.id);
        } else if (n > 1) { // swipe right: back
          onSwipe(node.id, -1);
        }
        return;
      }
      // sub-threshold feedback, only while clearly horizontal-dominant
      setDragX(Math.abs(dx) > 2 * Math.abs(dy) ? Math.max(-30, Math.min(30, dx * 0.3)) : 0);
    },
    onPointerUp: () => { gestureRef.current = null; setDragX(0); },
    onPointerCancel: () => { gestureRef.current = null; setDragX(0); },
  };
  return html`
    <div class="msg ${isUser ? 'user' : 'assistant'} ${isOOC ? 'ooc' : ''}"
      onContextMenu=${(e) => {
        // Keep the native menu when the user has text selected (copy etc.).
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}>
      <div class="meta">
        <span class="who ${isCharacter ? 'speaker' : ''}"
          style=${isCharacter ? { '--speaker-h': hueForName(speaker) } : null}>${isUser ? personaName : speaker}</span>
        ${index != null && html`<span>#${index}</span>`}
        ${swipe.createdAt && html`<span>${fmtDate(swipe.createdAt, dateFormat)}</span>`}
        ${Number.isFinite(swipe.genMs) && html`<span title="Generation time, prompt to completion">${(swipe.genMs / 1000).toFixed(1)}s</span>`}
        ${(node.edited || swipe.modelId) && html`
          <button class="btn small ghost meta-toggle" title="Message info"
            onClick=${() => setMetaOpen(!metaOpen)}>${metaOpen ? '⌄' : '›'}</button>`}
        <span class="meta-details ${metaOpen ? 'open' : ''}" onClick=${() => setMetaOpen(false)}>
          ${node.edited && html`<span>(edited)</span>`}
          ${swipe.modelId && html`<span>${swipe.modelId}</span>`}
        </span>
        <span style=${{ flex: 1 }}></span>
        <span class="actions ${streaming ? 'always' : ''} ${actionsOpen ? 'open' : ''}"
          onClick=${() => setActionsOpen(false)}>
          ${hasProbs && html`<button class="btn small ghost ${showProbs ? 'primary' : ''}" title="Token probabilities"
            onClick=${() => setShowProbs(!showProbs)}>▦</button>`}
          <button class="btn small ghost" title="Edit" disabled=${generating}
            onClick=${() => { setDraft(swipe.text); setEditing(true); }}>✎</button>
          ${!isUser && html`<button class="btn small ghost" title="Regenerate (new swipe)" disabled=${generating}
            onClick=${() => onRegenerate(node.id)}>↻</button>`}
          ${isUser && html`<button class="btn small ghost" title="Reply from here (generate assistant response)" disabled=${generating}
            onClick=${() => onReply(node.id)}>↻</button>`}
          <button class="btn small ghost" title="Branch from here" disabled=${generating}
            onClick=${() => onBranch(node.id)}>⑂</button>
          ${!isRoot && html`<button class="btn small ghost" title="Rewind to here" disabled=${generating}
            onClick=${() => confirm('Rewind the chat to this message? Later messages stay in the tree but leave the active branch; memories are rolled back.') && onRewind(node.id)}>⏮\uFE0E</button>`}
          ${!isRoot && html`<button class="btn small ghost" title="Delete message (and its branch)" disabled=${generating}
            onClick=${() => confirm('Delete this message and everything after it in its branch?') && onDelete(node.id)}>✕</button>`}
        </span>
        <button class="btn small ghost actions-toggle" title="Message actions"
          onClick=${() => setActionsOpen(!actionsOpen)}>${actionsOpen ? '‹' : '›'}</button>
${showNav && html`
          <span class="swipes">
            <button class="btn small ghost" disabled=${generating || n <= 1} onClick=${() => onSwipe(node.id, -1)}>◀\uFE0E</button>
            <span>${n}/${m}</span>
            ${usedIdx != null && html`
              <span class="used-dot ${atUsed ? '' : 'jump'}"
                title=${atUsed ? 'This is the version the conversation continued from' : `The conversation continued from swipe ${usedIdx + 1} — click to view`}
                onClick=${() => !atUsed && onSwipeTo(node.id, usedIdx)}>${atUsed ? '●' : '○'}</span>`}
            ${n < m
              ? html`<button class="btn small ghost" disabled=${generating} onClick=${() => onSwipe(node.id, 1)}>▶\uFE0E</button>`
              : isLeafAssistant
                ? html`<button class="btn small ghost gen" title="Generate a new version" disabled=${generating}
                    onClick=${() => onRegenerate(node.id)}>▶\uFE0E⁺</button>`
                : html`<button class="btn small ghost" disabled>▶\uFE0E</button>`}
          </span>`}
        
      </div>
      <div class="bubble ${dragX !== 0 ? 'dragging' : ''}"
        style=${{ transform: dragX ? `translateX(${dragX}px)` : null }}
        ...${gestureHandlers}>
        ${editing ? html`
          <textarea class="edit" value=${draft} onInput=${(e) => setDraft(e.target.value)} />
          <div style=${{ display: 'flex', gap: '6px' }}>
            <button class="btn small primary" onClick=${() => { onEdit(node.id, draft); setEditing(false); }}>Save</button>
            <button class="btn small" onClick=${() => setEditing(false)}>Cancel</button>
          </div>` :
          streaming && !displayText
            // Generating but no first token yet (slow backend waking up, model
            // loading, middleware holding the connection) — don't look dead.
            ? html`<div class="waiting" title="Waiting for the first token…"><span>●\uFE0E</span><span>●\uFE0E</span><span>●\uFE0E</span></div>` :
          showProbs && hasProbs
            ? html`<${ProbsView} tokens=${swipe.tokens} onPick=${(i, alt) => onRegenFromToken(node.id, i, alt)} />` :
          isOOC
            ? html`<div class="plain ${streaming ? 'streaming-cursor' : ''}">${displayText}</div>`
            : html`<div class=${streaming ? 'streaming-cursor' : ''}><${Markdown} text=${displayText} prose /></div>`}
      </div>
      ${ctxMenu && html`
        <${ContextMenu} x=${ctxMenu.x} y=${ctxMenu.y} onClose=${() => setCtxMenu(null)}
          items=${[
            ...(hasProbs ? [{ label: 'Token probabilities', fn: () => setShowProbs(!showProbs) }] : []),
            { label: 'Edit', fn: () => { setDraft(swipe.text); setEditing(true); } },
            isUser
              ? { label: 'Reply from here', fn: () => onReply(node.id) }
              : { label: 'Regenerate (new swipe)', fn: () => onRegenerate(node.id) },
            { label: 'Branch from here', fn: () => onBranch(node.id) },
            ...(!isRoot ? [
              '-',
              { label: 'Rewind to here', fn: () => confirm('Rewind the chat to this message? Later messages stay in the tree but leave the active branch; memories are rolled back.') && onRewind(node.id) },
              { label: 'Delete message (and its branch)', fn: () => confirm('Delete this message and everything after it in its branch?') && onDelete(node.id), danger: true },
            ] : []),
          ]} />`}
    </div>`;
}

