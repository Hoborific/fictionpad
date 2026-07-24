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

// Collapsible reasoning box (delta.reasoning_content — vLLM/DeepSeek/etc.).
// Collapsed by default, streaming or not — the header still shows live that
// thinking is in progress ("Thinking…").
function ThinkBox({ text, streaming }) {
  const [open, setOpen] = useState(false);
  return html`
    <div class="think">
      <button class="think-head" onClick=${() => setOpen(!open)}>
        <span class="think-caret">${open ? '▾' : '▸'}</span> Thinking${streaming ? '…' : ''}</button>
      ${open && html`<div class="think-body">${text}</div>`}
    </div>`;
}

function MessageItem({ node, index, isRoot, isLeaf, personaName, characterNames, streaming, generating, dateFormat, showThinking, onEdit, onRegenerate, onSwipe, onSwipeTo, onBranch, onRewind, onDelete, onReply, onRegenFromToken }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [showProbs, setShowProbs] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false); // mobile: actions collapsed behind ›
  const [metaOpen, setMetaOpen] = useState(false); // mobile: meta details collapsed behind ›
  const [toolsOpen, setToolsOpen] = useState(false); // gear pill: per-swipe tool-call popover
  // Auto-hide the actions/meta/tools popovers when tapping anywhere else.
  useEffect(() => {
    if (!actionsOpen && !metaOpen && !toolsOpen) return;
    const onDown = (e) => {
      if (!e.target.closest?.('.actions, .actions-toggle')) setActionsOpen(false);
      if (!e.target.closest?.('.meta-details, .meta-toggle')) setMetaOpen(false);
      if (!e.target.closest?.('.tools-pop, .tools-toggle')) setToolsOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [actionsOpen, metaOpen, toolsOpen]);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y } — right-click on the message
  const swipe = node.swipes[node.activeSwipe] ?? { text: '' };
  // Fit-based meta collapse (phones): the row renders fully expanded and steps
  // down one level at a time until it fits — each level drops one more detail
  // from the inline row, right to left (model, edited, gen time, date, #),
  // then the action icons (t6). Never measured mid-stream (the row is widest
  // while generating); re-probes from t0 on swipe change and row resizes.
  // Pre-paint, so no flash.
  // The t1–t6 hiding rules exist only inside `@media (max-width: 700px)`, so
  // the whole fit-measurement is pointless (and wastes up to 6 renders per
  // message) on wider viewports — gate every step on it.
  const metaCollapseApplies = () => window.matchMedia('(max-width: 700px)').matches;
  const metaRef = useRef(null);
  const [metaLevel, setMetaLevel] = useState(0);
  useEffect(() => {
    const el = metaRef.current; if (!el || !metaCollapseApplies()) return;
    let seen = false; // RO fires once on observe — skip that, react only to real resizes
    const ro = new ResizeObserver(() => { if (seen) setMetaLevel(0); seen = true; });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const prevSwipeRef = useRef(swipe);
  useLayoutEffect(() => {
    if (prevSwipeRef.current !== swipe) { // swipe switched → re-probe from t0
      prevSwipeRef.current = swipe;
      if (metaLevel) { setMetaLevel(0); return; }
    }
    const el = metaRef.current;
    if (!el || streaming || !metaCollapseApplies()) return;
    if (el.scrollWidth > el.clientWidth + 1 && metaLevel < 6) setMetaLevel(l => l + 1);
  }, [metaLevel, streaming, swipe]);
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
  // Reasoning channel (swipe.think): collapsible box atop the bubble.
  const thinkBox = !isUser && !editing && showThinking !== false && swipe.think
    ? html`<${ThinkBox} text=${subUser(swipe.think, personaName)} streaming=${streaming} />`
    : null;

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
  // Multi-speaker split: one swipe, several `Name:` parts → one
  // bubble per part. Rendering only; storage/swipes/probs are untouched.
  const segments = (isUser || isOOC) ? null : splitSpeakerSegments(text, characterNames);
  const multi = (segments?.length ?? 0) > 1;
  // Multi-speaker swipe: the header names everyone who spoke, in speaking
  // order (first appearance), each with its own colour.
  const multiSpeakers = multi ? [...new Set(segments.map((s) => s.speaker ?? 'Narrator'))] : null;
  // #, date, gen time, edited, model collapse behind the › toggle on phones
  // (desktop shows them inline via .meta-details { display: contents }).
  const hasMetaDetails = !!(index != null || swipe.createdAt || Number.isFinite(swipe.genMs) || node.edited || swipe.modelId);
  return html`
    <div class="msg ${isUser ? 'user' : 'assistant'} ${isOOC ? 'ooc' : ''}"
      onContextMenu=${(e) => {
        // Keep the native menu when the user has text selected (copy etc.).
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}>
      <div class="meta ${metaLevel ? `t${metaLevel}` : ''}" ref=${metaRef}>
        ${isUser ? html`<span class="who">${personaName}</span>`
          : multiSpeakers ? multiSpeakers.map((name, i) => html`${i > 0 ? ', ' : ''}<span key=${name}
              class="who ${name !== 'Narrator' ? 'speaker' : ''}"
              style=${name !== 'Narrator' ? { '--speaker-h': hueForName(name) } : null}>${name}</span>`)
          : html`<span class="who ${isCharacter ? 'speaker' : ''}"
              style=${isCharacter ? { '--speaker-h': hueForName(speaker) } : null}>${speaker}</span>`}
        ${swipe.interrupted && html`<span class="warn" title="The connection ended before the model finished — this reply is partial. Regenerate to replace it.">⚠\uFE0E interrupted</span>`}
        ${(swipe.toolCalls ?? []).length > 0 && html`
          <button class="pill tools-toggle" title="Tool calls made during this generation — click to view"
            onClick=${() => setToolsOpen(!toolsOpen)}>⚙\uFE0E ${swipe.toolCalls.length}</button>
          ${toolsOpen && html`
            <span class="tools-pop">
              ${swipe.toolCalls.map((t, i) => html`
                <span key=${i} class="tools-row ${t.ok ? '' : 'failed'}">
                  <span>${t.ok ? '✓' : '✕'} <b>${t.name || '(unparsed)'}</b>${t.note ? html`<span class="tools-note"> — ${t.note}</span>` : null}</span>
                  ${t.args && t.args !== '{}' && html`<span class="tools-args">${t.args}</span>`}
                </span>`)}
            </span>`}`}
        ${hasMetaDetails && html`
          <button class="btn small ghost meta-toggle" title="Message info"
            onClick=${() => setMetaOpen(!metaOpen)}>${metaOpen ? '⌄' : '›'}</button>`}
        <span class="meta-details ${metaOpen ? 'open' : ''}" onClick=${() => setMetaOpen(false)}>
          ${index != null && html`<span class="md-index">#${index}</span>`}
          ${swipe.createdAt && html`<span class="md-date">${fmtDate(swipe.createdAt, dateFormat)}</span>`}
          ${Number.isFinite(swipe.genMs) && html`<span class="md-gentime" title="Generation time, prompt to completion">${(swipe.genMs / 1000).toFixed(1)}s</span>`}
          ${node.edited && html`<span class="md-edited">(edited)</span>`}
          ${swipe.modelId && html`<span class="md-model">${swipe.modelId}</span>`}
        </span>
        <span class="grow" style=${{ flex: 1 }}></span>
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
      ${multi && !editing && !(showProbs && hasProbs) ? segments.map((seg, si) => html`
        <div key=${si} class="bubble seg ${dragX !== 0 ? 'dragging' : ''}"
          style=${{ transform: dragX ? `translateX(${dragX}px)` : null }}
          ...${gestureHandlers}>
          ${si === 0 && thinkBox}
          <div class="seg-who ${seg.speaker ? 'speaker' : ''}"
            style=${seg.speaker ? { '--speaker-h': hueForName(seg.speaker) } : null}>${seg.speaker ?? 'Narrator'}</div>
          <div class=${streaming && si === segments.length - 1 ? 'streaming-cursor' : ''}><${ThrottledMarkdown} text=${seg.text} prose streaming=${streaming && si === segments.length - 1} /></div>
        </div>`) : html`
      <div class="bubble ${dragX !== 0 ? 'dragging' : ''}"
        style=${{ transform: dragX ? `translateX(${dragX}px)` : null }}
        ...${gestureHandlers}>
        ${thinkBox}
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
            : html`<div class=${streaming ? 'streaming-cursor' : ''}><${ThrottledMarkdown} text=${displayText} prose streaming=${streaming} /></div>`}
      </div>`}
      ${ctxMenu && html`
        <${ContextMenu} x=${ctxMenu.x} y=${ctxMenu.y} onClose=${() => setCtxMenu(null)}
          items=${[
            ...(hasProbs ? [{ label: 'Token probabilities', fn: () => setShowProbs(!showProbs) }] : []),
            { label: 'Edit', fn: () => { setDraft(swipe.text); setEditing(true); }, disabled: generating },
            isUser
              ? { label: 'Reply from here', fn: () => onReply(node.id) }
              : { label: 'Regenerate (new swipe)', fn: () => onRegenerate(node.id) },
            { label: 'Branch from here', fn: () => onBranch(node.id) },
            ...(!isRoot ? [
              '-',
              { label: 'Rewind to here', fn: () => confirm('Rewind the chat to this message? Later messages stay in the tree but leave the active branch; memories are rolled back.') && onRewind(node.id), disabled: generating },
              { label: 'Delete message (and its branch)', fn: () => confirm('Delete this message and everything after it in its branch?') && onDelete(node.id), danger: true, disabled: generating },
            ] : []),
          ]} />`}
    </div>`;
}

// Streaming markdown throttle: re-parsing the whole accumulated reply with
// marked on every token is O(n²) on the main thread. While `streaming`, the
// rendered text flushes at most once per ~50ms (the latest text is always kept
// in a ref); when streaming ends the exact full text renders immediately via
// the direct path. Non-streaming messages are never throttled.
function ThrottledMarkdown({ text, prose = false, streaming = false }) {
  const [shown, setShown] = useState(text);
  const latestRef = useRef(text);
  latestRef.current = text;
  useEffect(() => {
    if (!streaming) return; // settled: the exact text renders via the direct path
    setShown(latestRef.current); // stream (re)started: sync once, then tick
    const iv = setInterval(() => setShown(s => (s === latestRef.current ? s : latestRef.current)), 50);
    return () => clearInterval(iv);
  }, [streaming]);
  return html`<${Markdown} text=${streaming ? shown : text} prose=${prose} streaming=${streaming} />`;
}

// Memoized MessageItem: the chat pane re-renders the whole message list per
// streamed token, but the other messages don't change. The action callbacks
// from App get fresh identities every render — they are behaviourally stable
// (they read live state via ref.current; the only render-scope capture is
// ui.chatId, and a chat switch always changes the node identities as well), so
// a props-equal that compares everything except functions is safe here.
const MessageItemMemo = React.memo(MessageItem, (a, b) => {
  for (const k in a) {
    if (typeof a[k] === 'function' && typeof b[k] === 'function') continue;
    if (a[k] !== b[k]) return false;
  }
  return true;
});

