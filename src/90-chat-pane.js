const NO_KIDS = []; // stable identity for MessageItem's memo (childless nodes)

function ChatPane({ chat, persona, characterNames, characterColors, avatars = null, avatarsOn = false, generating, genElsewhere = false, suggestions, onPickSuggestion, onRerollSuggestions,
                  onSubmitInput, onStop, composerInject, onConsumeInject = null, auxBusy = [], dateFormat, showThinking, imagesEnabled = false, horizon = null, scrollTargetRef = null, kbdSel = null, cmdArgs = null, queueCount = 0, ...actions }) {
  const logRef = useRef(null);
  const path = useMemo(() => getActivePath(chat?.messages, chat?.activeLeafId), [chat]);
  // Branch data for the swipe-nav badge / branch popover: parentId → children,
  // oldest first. Keyed on the messages map so identities stay stable across
  // unrelated re-renders (MessageItem memo compares prop identities). The map
  // identity changes per streamed token, so kid arrays are cached: when every
  // child node object is unchanged (only the streaming node gets a fresh
  // identity per token) the previous array is reused, keeping branchKids
  // identity stable for every unaffected parent.
  const kidsCacheRef = useRef(new Map()); // parentId → last kids array
  const kidsByParent = useMemo(() => {
    const map = new Map();
    for (const n of Object.values(chat?.messages ?? {})) {
      if (!n?.parentId) continue;
      if (!map.has(n.parentId)) map.set(n.parentId, []);
      map.get(n.parentId).push(n);
    }
    const prev = kidsCacheRef.current;
    const cache = new Map();
    for (const [pid, kids] of map) {
      kids.sort((a, b) => ((a.swipes?.[0]?.createdAt ?? 0) - (b.swipes?.[0]?.createdAt ?? 0)) || (a.id < b.id ? -1 : 1));
      const old = prev.get(pid);
      const stable = old && old.length === kids.length && kids.every((k, i) => k === old[i]) ? old : kids;
      cache.set(pid, stable);
      map.set(pid, stable);
    }
    kidsCacheRef.current = cache;
    return map;
  }, [chat?.messages]);
  // Memory pills: path position → count of memories stamped there (atLen), so
  // the message where an auto-summary fired shows it and can jump to the
  // Memory tab. Only cards visible on this path count — branch-hidden
  // (off-path atMsg) and superseded (a supPointsOf point on path) ones hide
  // by derivation; rewind never deletes them, so without the filter stale
  // pills would linger.
  const memByLen = useMemo(() => {
    const m = new Map();
    const pathIds = new Set(path.map(n => n.id));
    for (const mem of chat?.memoryStore?.memories ?? []) {
      if (!Number.isFinite(mem?.atLen)) continue;
      if (mem.atMsg != null && !pathIds.has(mem.atMsg)) continue;
      if (supPointsOf(mem).some(id => pathIds.has(id))) continue;
      m.set(mem.atLen, (m.get(mem.atLen) ?? 0) + 1);
    }
    return m;
  }, [chat?.memoryStore, path]);
  // Stick-to-bottom: follow content growth only while the user is pinned to
  // the bottom zone (~80px). Programmatic scrolls are flagged so they don't
  // unpin/re-pin themselves via the scroll listener.
  const pinnedRef = useRef(true);
  const programmaticRef = useRef(false);
  const lastTopRef = useRef(0); // for detecting user-initiated upward scrolls
  const [pinned, setPinned] = useState(true);
  // Real user scroll gestures (touch drag / wheel) — used to tell deliberate
  // scrolls from layout-driven clamp events (content shrinking on regenerate,
  // mobile keyboard dismiss, meta-row collapse all shift scrollTop without the
  // user touching anything and must NOT unpin the follow).
  const gestureRef = useRef(false);
  const gestureTimer = useRef(0);
  const noteGesture = () => {
    gestureRef.current = true;
    clearTimeout(gestureTimer.current);
    gestureTimer.current = setTimeout(() => { gestureRef.current = false; }, 300);
  };
  // Programmatic scroll-to-bottom: flag the scroll listener, then clear the
  // flag on the next frame regardless — when already at bottom no scroll event
  // fires, and waiting for one would swallow the next genuine user scroll.
  // (A real scroll event fires before rAF callbacks, so the listener still
  // gets first crack at the flag.)
  const scrollElToBottom = (el) => {
    programmaticRef.current = true;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => { programmaticRef.current = false; });
  };
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
    scrollElToBottom(el);
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
    // Unpin on upward scrolls only when they're user-driven (an active
    // gesture) or land clearly away from the bottom. Layout-driven clamp
    // events — content shrinking on regenerate, keyboard dismiss, meta-row
    // collapse — move scrollTop up with no gesture and dist ≈ 0; those must
    // not unpin, or generation stops following and "jump to latest" appears.
    if (top < lastTopRef.current - 1 && (gestureRef.current || dist > 80)) p = false;
    else if (dist < 40) p = true; // deliberately scrolling to the bottom re-pins
    lastTopRef.current = top;
    if (p !== pinnedRef.current) { pinnedRef.current = p; setPinned(p); }
    computeJump();
  };
  useEffect(() => { // follow growth only when pinned
    const el = logRef.current;
    // Branch swap (swipe that re-derived the leaf, branch picker/view jump):
    // keep the acted message on screen instead of force-following to the new
    // branch's bottom — the tail changed, not the user's reading position.
    const tgt = scrollTargetRef?.current;
    if (tgt && tgt.chatId === chat?.id) {
      scrollTargetRef.current = null;
      const leafChanged = path[path.length - 1]?.id !== seenLeafRef.current;
      if (el && leafChanged) {
        skipLeafScrollRef.current = true; // the seenLeaf effect must not bottom-scroll after us
        pinnedRef.current = false;
        setPinned(false);
        const nodeEl = el.querySelector(`[data-mid="${tgt.nodeId}"]`);
        if (nodeEl) {
          const r = nodeEl.getBoundingClientRect();
          const lr = el.getBoundingClientRect();
          if (r.top < lr.top + 8 || r.top > lr.bottom - 80) { // not comfortably visible
            programmaticRef.current = true;
            el.scrollTop += (r.top - lr.top) - 12; // settle near the top of the log
            requestAnimationFrame(() => { programmaticRef.current = false; });
          }
        }
        computeJump();
        return;
      }
    }
    if (pinnedRef.current) {
      if (el) scrollElToBottom(el);
    } else computeJump(); // content grew while unpinned — jump may newly apply
  }, [chat, generating, suggestions]);
  useEffect(() => { // new chat → start pinned at the bottom
    pinnedRef.current = true;
    setPinned(true);
    setShowJump(false);
    const el = logRef.current;
    if (el) scrollElToBottom(el);
  }, [chat?.id]);
  // Explicit intents = go to the bottom and stay there: starting a generation
  // (send / regenerate / ▶⁺ / generate-response) and sending your own message
  // (a fresh user-role leaf) both force-pin, even if you were scrolled up.
  const wasGenRef = useRef(false);
  useEffect(() => {
    if (generating && !wasGenRef.current) scrollToBottom();
    wasGenRef.current = !!generating;
  }, [generating]);
  const seenLeafRef = useRef(null);
  const skipLeafScrollRef = useRef(false); // set when a branch-swap scroll already handled the leaf change
  useEffect(() => {
    const leafId = path[path.length - 1]?.id;
    const role = path[path.length - 1]?.role;
    if (leafId && leafId !== seenLeafRef.current) {
      if (role === 'user' && seenLeafRef.current !== null && !skipLeafScrollRef.current) scrollToBottom();
      skipLeafScrollRef.current = false;
      seenLeafRef.current = leafId;
    }
  }, [path]);
  // Keyboard message selection (↑/↓ in Main): highlight only while the node
  // is on the active path; scroll it into view (a third down) when needed.
  const selId = kbdSel && path.some(n => n.id === kbdSel) ? kbdSel : null;
  useEffect(() => {
    if (!selId) return;
    const el = logRef.current;
    const nodeEl = el?.querySelector(`[data-mid="${selId}"]`);
    if (!el || !nodeEl) return;
    const r = nodeEl.getBoundingClientRect();
    const lr = el.getBoundingClientRect();
    if (r.top < lr.top + 8 || r.bottom > lr.bottom - 8) {
      pinnedRef.current = false;
      setPinned(false);
      programmaticRef.current = true;
      el.scrollTop += (r.top - lr.top) - el.clientHeight / 3;
      requestAnimationFrame(() => { programmaticRef.current = false; });
      computeJump();
    }
  }, [selId]);
  // Per-chat composer drafts (ephemeral, session-only — never persisted). The
  // Composer remounts per chat (key=chat.id) and seeds from this map; edits
  // flow back via onDraft, so an unsent draft survives any number of chat
  // switches. A successful send reports '' and clears only that chat's entry.
  const draftsRef = useRef(new Map());
  const onDraft = (chatId, text) => {
    if (text) draftsRef.current.set(chatId, text);
    else draftsRef.current.delete(chatId);
  };
  // Send acceptance is Main's own report: onSubmitInput returns a hint string
  // (draft kept), null (consumed), or genGuard's promise resolving null/false
  // once the freshness check settles — the Composer awaits it and keeps or
  // clears its draft on that signal. No timer-based verification here: the
  // v4.12 freshness await made a setTimeout guess race and false-restore.
  const onComposerSubmit = (text) => onSubmitInput(text);
  if (!chat) return html`
    <div class="main"><div class="chatlog"><div class="empty">
      <div style=${{ fontSize: '22px' }}>FictionPad</div>
      <div>Create a scenario in the sidebar, then start a chat from it.<br/>
      Configure an OpenAI-compatible endpoint in Settings to begin generating.</div>
    </div></div></div>`;
  const personaName = persona?.name?.trim() || 'User';
  const leaf = path[path.length - 1];
  // Swipe is part of the match: suggestions fetched for one take must not
  // render under another take of the same leaf (swiped mid-flight).
  const showSugg = !generating && leaf?.role === 'assistant'
    && suggestions?.chatId === chat.id && suggestions?.nodeId === leaf.id
    && suggestions?.swipe === leaf.activeSwipe;
  // Impersonate chip: below the suggestion chips when those are on, the only
  // chip otherwise. Click-triggered only — no aux call until asked.
  // genElsewhere: a generation is running in ANOTHER chat — one at a time is
  // the rule, so this chat's generation affordances stand down too (the
  // composer still shows ■ Stop below, making the busy state visible).
  const showImpChip = !generating && !genElsewhere && !auxBusy.length && leaf?.role === 'assistant' && !!actions.onImpersonate;
  return html`
    <div class="main">
      <div class="chatlog" ref=${logRef} onScroll=${onLogScroll} onWheel=${noteGesture} onTouchMove=${noteGesture}>
        ${path.map((node, i) => html`
          <${React.Fragment} key=${node.id}>
          ${horizon && horizon.id === node.id && html`
            <div class="ctx-horizon" title="The context window is full — everything above this line was outside the last generation's prompt (lore and memories cover older facts).">
              <span>last generation saw from here down · ${horizon.dropped} older message${horizon.dropped === 1 ? '' : 's'} out of context</span>
            </div>`}
          <${MessageItemMemo} node=${node} index=${i + 1} isRoot=${!node.parentId} isLeaf=${node.id === leaf?.id}
            chatId=${chat?.id ?? null}
            selected=${node.id === selId}
            personaName=${personaName} characterNames=${characterNames} characterColors=${characterColors}
            avatars=${avatars} avatarsOn=${avatarsOn}
            streaming=${generating?.nodeId === node.id}
            generating=${!!generating}
            auxBusy=${auxBusy.length > 0}
            dateFormat=${dateFormat} showThinking=${showThinking}
            memCount=${memByLen.get(i + 1) ?? 0} onOpenMemory=${actions.onOpenMemory}
            branchKids=${kidsByParent.get(node.id) ?? NO_KIDS} childOnPathId=${path[i + 1]?.id ?? null}
            onEdit=${actions.onEdit} onRegenerate=${actions.onRegenerate} onSwipe=${actions.onSwipe}
            onSwipeTo=${actions.onSwipeTo} onJump=${actions.onJump} onOpenBranches=${actions.onOpenBranches}
            onOpenCharacter=${actions.onOpenCharacter}
            onImgSwipe=${actions.onImgSwipe} onImgRegen=${actions.onImgRegen} imagesEnabled=${imagesEnabled}
            onBranch=${actions.onBranch} onRewind=${actions.onRewind} onDelete=${actions.onDeleteMsg}
            onReply=${actions.onReply} onRegenFromToken=${actions.onRegenFromToken} />
          <//>`)}
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
        ${showImpChip && html`
          <div class="sugg-row imp-row">
            <button class="sugg-chip imp-chip" title="The AI drafts your next message into the composer (/impersonate) — edit, then send"
              onClick=${() => actions.onImpersonate()}>✦ Draft my reply…</button>
          </div>`}
      </div>
      ${showJump && html`
        <button class="jump-latest" title="Scroll to the latest message" onClick=${scrollToBottom}>↓ Jump to latest</button>`}
      ${!generating && !genElsewhere && !auxBusy.length && leaf?.role === 'user' && html`
        <div class="gen-reply">
          <button class="btn gen-pill" onClick=${() => actions.onGenerateReply()}>✦ Generate response</button>
        </div>`}
      ${queueCount > 0 && html`
        <div class="queue-notice">
          <span>✦ ${queueCount} lore proposal${queueCount === 1 ? '' : 's'} await review</span>
          <button class="btn small" onClick=${() => actions.onOpenQueue()}>Review</button>
          <button class="btn small ghost" title="Hide until the pending count changes" onClick=${() => actions.onDismissQueueNotice()}>✕</button>
        </div>`}
      <${Composer} key=${chat.id} chatId=${chat.id} generating=${!!generating || genElsewhere} busy=${auxBusy.length > 0}
        initialText=${draftsRef.current.get(chat.id) ?? ''} onDraft=${onDraft} cmdArgs=${cmdArgs}
        onSubmit=${onComposerSubmit} onStop=${onStop} inject=${composerInject} onConsumeInject=${onConsumeInject} />
    </div>`;
}

