function ChatPane({ chat, persona, characterNames, generating, suggestions, onPickSuggestion, onRerollSuggestions,
                  onSubmitInput, onStop, composerInject, auxBusy, dateFormat, ...actions }) {
  const logRef = useRef(null);
  const path = useMemo(() => getActivePath(chat?.messages, chat?.activeLeafId), [chat]);
  // Stick-to-bottom: follow content growth only while the user is pinned to
  // the bottom zone (~80px). Programmatic scrolls are flagged so they don't
  // unpin/re-pin themselves via the scroll listener.
  const pinnedRef = useRef(true);
  const programmaticRef = useRef(false);
  const lastTopRef = useRef(0); // for detecting user-initiated upward scrolls
  const [pinned, setPinned] = useState(true);
  // "Jump to latest" is deliberately shy: it only appears once the latest
  // message (e.g. the one being generated) is entirely scrolled out of view —
  // not merely when the user nudges up a few px from the bottom.
  const [showJump, setShowJump] = useState(false);
  const computeJump = () => {
    const el = logRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const msgs = el.querySelectorAll(':scope > .msg');
    const lastH = msgs.length ? msgs[msgs.length - 1].offsetHeight : 0;
    const show = dist > lastH + 40;
    setShowJump(prev => prev === show ? prev : show);
  };
  const scrollToBottom = () => {
    const el = logRef.current;
    if (!el) return;
    programmaticRef.current = true;
    el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setPinned(true);
    setShowJump(false);
  };
  const onLogScroll = () => {
    const el = logRef.current;
    if (!el) return;
    const top = el.scrollTop;
    if (programmaticRef.current) { programmaticRef.current = false; lastTopRef.current = top; return; }
    const dist = el.scrollHeight - top - el.clientHeight;
    let p = pinnedRef.current;
    // Any user-initiated upward scroll unpins immediately — during streaming,
    // an 80px threshold just snaps you back before you can escape it.
    if (top < lastTopRef.current - 1) p = false;
    else if (dist < 40) p = true; // deliberately scrolling to the bottom re-pins
    lastTopRef.current = top;
    if (p !== pinnedRef.current) { pinnedRef.current = p; setPinned(p); }
    computeJump();
  };
  useEffect(() => { // follow growth only when pinned
    const el = logRef.current;
    if (pinnedRef.current) {
      if (el) { programmaticRef.current = true; el.scrollTop = el.scrollHeight; }
    } else computeJump(); // content grew while unpinned — jump may newly apply
  }, [chat, generating, suggestions]);
  useEffect(() => { // new chat → start pinned at the bottom
    pinnedRef.current = true;
    setPinned(true);
    setShowJump(false);
    const el = logRef.current;
    if (el) { programmaticRef.current = true; el.scrollTop = el.scrollHeight; }
  }, [chat?.id]);
  if (!chat) return html`
    <div class="main"><div class="chatlog"><div class="empty">
      <div style=${{ fontSize: '22px' }}>FictionPad</div>
      <div>Create a scenario in the sidebar, then start a chat from it.<br/>
      Configure an OpenAI-compatible endpoint in Settings to begin generating.</div>
    </div></div></div>`;
  const personaName = persona?.name?.trim() || 'User';
  const leaf = path[path.length - 1];
  const showSugg = !generating && leaf?.role === 'assistant'
    && suggestions?.chatId === chat.id && suggestions?.nodeId === leaf.id;
  return html`
    <div class="main">
      <div class="chatlog" ref=${logRef} onScroll=${onLogScroll}>
        ${path.map((node, i) => html`
          <${MessageItem} key=${node.id} node=${node} index=${i + 1} isRoot=${!node.parentId} isLeaf=${node.id === leaf?.id}
            personaName=${personaName} characterNames=${characterNames}
            streaming=${generating?.nodeId === node.id}
            generating=${!!generating}
            dateFormat=${dateFormat}
            onEdit=${actions.onEdit} onRegenerate=${actions.onRegenerate} onSwipe=${actions.onSwipe}
            onSwipeTo=${actions.onSwipeTo}
            onBranch=${actions.onBranch} onRewind=${actions.onRewind} onDelete=${actions.onDeleteMsg}
            onReply=${actions.onReply} onRegenFromToken=${actions.onRegenFromToken} />`)}
        ${showSugg && html`
          <div class="sugg-row">
            ${suggestions.loading
              ? html`<span class="hint">Thinking of options…</span>`
              : html`
                  ${(suggestions.swipe === leaf.activeSwipe ? suggestions.items ?? [] : []).map((s, i) => html`
                    <button key=${i} class="sugg-chip" onClick=${() => onPickSuggestion(s)}>${s}</button>`)}
                  <button class="btn small ghost" title="Re-roll suggestions" onClick=${onRerollSuggestions}>⟳</button>
                `}
          </div>`}
      </div>
      ${showJump && html`
        <button class="jump-latest" title="Scroll to the latest message" onClick=${scrollToBottom}>↓ Jump to latest</button>`}
      ${!generating && leaf?.role === 'user' && html`
        <div class="gen-reply">
          <button class="btn primary" onClick=${() => actions.onGenerateReply()}>✦ Generate response</button>
        </div>`}
      <${Composer} generating=${!!generating} busy=${auxBusy} onSubmit=${onSubmitInput} onStop=${onStop} inject=${composerInject} />
    </div>`;
}

