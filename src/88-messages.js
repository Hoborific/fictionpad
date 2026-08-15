// ============================================================================
// COMPONENTS: MESSAGE + COMPOSER + CHAT PANE
// ============================================================================
// ============================================================================
// COMPONENTS: PROBS VIEW — per-token spans with probability tint + hover
// popover (top-10 alternatives, click to branch generation from that token).
// ============================================================================
const visibleTok = (t) => String(t ?? '').replace(/ /g, '␣').replace(/\t/g, '⇥').replace(/\n/g, '↵\n');
const probPct = (lp) => lp == null ? null : Math.exp(lp) * 100;
// Adaptive precision: near-degenerate distributions (e.g. post-thinking
// replies, where the answer is ~decided) all round to 100.0%/0.0% at 1
// decimal and the view looks broken. Show more digits near the extremes.
const fmtPct = (pct) => pct == null ? null
  : pct >= 99.95 ? pct.toFixed(3) + '%'
  : pct >= 99.5 ? pct.toFixed(2) + '%'
  : pct > 0 && pct < 0.1 ? '<0.1%'
  : pct.toFixed(1) + '%';

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
              <span class="pc">${fmtPct(pct) ?? 'n/a'}</span></div>
            ${(t.top ?? []).map((alt, j) => {
              const ap = probPct(alt.logprob);
              return html`<div key=${j} class="pop-row alt" onClick=${() => onPick(i, alt.token)}>
                <span class="rank">#${j + 1}</span><span class="tt">${visibleTok(alt.token)}</span>
                <span class="pc">${fmtPct(ap) ?? ''}</span></div>`;
            })}
            <div class="pop-row alt" onClick=${() => onPick(i, null)}><span class="tt">↻ from here</span></div>
          </span></span>`;
      })}
    </div>`;
}

// Collapsible reasoning box (delta.reasoning_content — vLLM/DeepSeek/etc.).
// Collapsed by default, streaming or not — the header still shows live that
// thinking is in progress ("Thinking…"), and once the stream ends it carries
// the total thinking time (swipe.thinkMs). The expanded body scrolls via
// RailScroll (hidden native scrollbar, accent rail + bottom fade cues).
function ThinkBox({ text, streaming, thinkMs }) {
  const [open, setOpen] = useState(false);
  return html`
    <div class="think">
      <button class="think-head" onClick=${() => setOpen(!open)}>
        <span class="think-caret">${open ? '▾' : '▸'}</span> Thinking${streaming ? '…'
          : Number.isFinite(thinkMs) ? ` - ${(thinkMs / 1000).toFixed(1)}s` : ''}</button>
      ${open && html`<${RailScroll} className="think-body">${text}<//>`}
    </div>`;
}

// One recorded tool call in the gear popover: ✓/✕ + name + note, and the
// args as a one-line preview that expands to the full JSON on click — the
// swipe stores the untruncated args, truncation is display-only here.
function ToolCallRow({ t }) {
  const [open, setOpen] = useState(false);
  const hasArgs = t.args && t.args !== '{}';
  return html`
    <span class="tools-row ${t.ok ? '' : 'failed'}">
      <span>${t.ok ? '✓' : '✕'} <b>${t.name || '(unparsed)'}</b>${t.note ? html`<span class="tools-note"> — ${t.note}</span>` : null}</span>
      ${hasArgs && html`<span class="tools-args" title=${open ? null : 'Click to view the full arguments'}
        onClick=${() => setOpen(!open)}>${open ? t.args : toPreview(t.args, 140)}</span>`}
    </span>`;
}

// Generated-image attachments on a swipe (v4.10): entries group into SLOTS —
// one placement, one or more takes (per-image swipes). A slot renders once:
// the active take (pending → shimmer, error/no src → dim note with the prompt
// on the tooltip, else the image with click-to-zoom via onZoom), with a
// ◀ n/m ▶⁺ navigator UNDER it whenever there is something to flip or re-roll
// (count > 1 || canRegen) — mirroring the message swipe navigator; ▶⁺ on the
// last take re-rolls JUST that image with the same prompt. A horizontal touch
// swipe on the image itself flips takes too (left = next / ▶⁺ on the last,
// right = back). WHERE a slot renders is MessageItem's call (the active
// take's `pos` vs the speaker segments / visible text end): attached INSIDE
// the reply bubble (head or end) or embedded between markdown blocks when
// genuinely mid-text — free-standing only for a scene break between speaker
// bubbles or an image-only swipe (nothing to attach to).
function SwipeImages({ slots, onZoom, generating = false, canRegen = false, onImgSwipe, onImgRegen }) {
  return html`${(slots ?? []).map((sv) => html`
    <${SwipeImage} key=${sv.slot} sv=${sv} onZoom=${onZoom} generating=${generating}
      canRegen=${canRegen} onImgSwipe=${onImgSwipe} onImgRegen=${onImgRegen} />`)}`;
}

// One image slot: the active take plus its take navigator. Owns its touch
// gesture (touch/pen, 70px horizontal-dominant, one action per gesture — the
// message gestureHandlers pattern) on the wrapper: the pointerdown
// stopPropagation keeps image-born gestures from arming the MESSAGE swipe
// handlers on an ancestor bubble. A consumed gesture swallows the trailing
// click (a >70px drag must not open the lightbox).
function SwipeImage({ sv, onZoom, generating, canRegen, onImgSwipe, onImgRegen }) {
  const { take, activeIdx, count, hasPending } = sv;
  const gestureRef = useRef(null);
  const consumedRef = useRef(false);
  const atLast = activeIdx >= count - 1;
  const regen = () => { if (!generating && !hasPending && canRegen) onImgRegen?.(sv.slot); };
  const gestureHandlers = {
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse') return; // mouse never arms the message gesture either
      e.stopPropagation(); // image-born gestures never trigger message swipes
      consumedRef.current = false; // a stale flag must not eat this gesture's click
      gestureRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    },
    onPointerMove: (e) => {
      const g = gestureRef.current;
      if (!g || g.id !== e.pointerId) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) {
        gestureRef.current = null; // one action per gesture
        consumedRef.current = true; // swallow the click that follows the drag
        if (generating) return; // buttons stand down mid-generation; the gesture matches
        if (dx < 0) { // swipe left: next take, or ▶⁺ re-roll on the last one
          if (!atLast) onImgSwipe?.(sv.slot, 1);
          else regen();
        } else if (activeIdx > 0) { // swipe right: back
          onImgSwipe?.(sv.slot, -1);
        }
      }
    },
    onPointerUp: () => { gestureRef.current = null; },
    onPointerCancel: () => { gestureRef.current = null; },
  };
  return html`
    <div class="swipe-img-wrap" ...${gestureHandlers}>
      ${take?.pending ? html`<div class="img-pending"></div>`
        : take?.error || !take?.src
          ? html`<div class="img-error" title=${take?.prompt ?? ''}>✕\uFE0E image unavailable</div>`
          : html`<img class="swipe-img" src=${take.src} alt=${take.caption || take.prompt || ''}
              onClick=${() => { if (consumedRef.current) { consumedRef.current = false; return; } onZoom?.(take, sv.slot); }} />`}
      ${(count > 1 || canRegen) && html`
        <span class="swipes img-swipes">
          <button class="btn small ghost" title="Previous take" disabled=${generating || activeIdx <= 0}
            onClick=${() => onImgSwipe?.(sv.slot, -1)}>◀\uFE0E</button>
          <span>${activeIdx + 1}/${count}</span>
          ${!atLast
            ? html`<button class="btn small ghost" title="Next take" disabled=${generating}
                onClick=${() => onImgSwipe?.(sv.slot, 1)}>▶\uFE0E</button>`
            : canRegen
              ? html`<button class="btn small ghost gen" title="Generate a new take of this image — same prompt"
                  disabled=${generating || hasPending} onClick=${regen}>▶\uFE0E⁺</button>`
              : html`<button class="btn small ghost" disabled>▶\uFE0E</button>`}
        </span>`}
    </div>`;
}

function MessageItem({ node, index, isRoot, isLeaf, selected = false, personaName, characterNames, characterColors, avatars = null, avatarsOn = false, streaming, generating, auxBusy, dateFormat, showThinking, onEdit, onRegenerate, onSwipe, onSwipeTo, onBranch, onRewind, onDelete, onReply, onRegenFromToken, onImgSwipe, onImgRegen, imagesEnabled = false, memCount = 0, onOpenMemory, branchKids = [], childOnPathId = null, onJump, onOpenBranches }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [showProbs, setShowProbs] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false); // mobile: actions collapsed behind ›
  const [metaOpen, setMetaOpen] = useState(false); // mobile: meta details collapsed behind ›
  const [toolsOpen, setToolsOpen] = useState(false); // gear pill: per-swipe tool-call popover
  const [branchOpen, setBranchOpen] = useState(false); // ⎇ chip: branch-picker popover
  const [branchUp, setBranchUp] = useState(false); // popover flips above the chip near the viewport bottom
  // Auto-hide the actions/meta/tools/branch popovers when tapping anywhere else.
  useEffect(() => {
    if (!actionsOpen && !metaOpen && !toolsOpen && !branchOpen) return;
    const onDown = (e) => {
      if (!e.target.closest?.('.actions, .actions-toggle')) setActionsOpen(false);
      if (!e.target.closest?.('.meta-details, .meta-toggle')) setMetaOpen(false);
      if (!e.target.closest?.('.tools-pop, .tools-toggle')) setToolsOpen(false);
      if (!e.target.closest?.('.branch-pop, .branch-chip')) setBranchOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [actionsOpen, metaOpen, toolsOpen, branchOpen]);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y } — right-click on the message
  const [lightbox, setLightbox] = useState(null); // { src, title, slot? } — avatar/image click-to-expand; slot = live take tracking
  const swipe = node.swipes[node.activeSwipe] ?? { text: '' };
  // Generated-image attachments on the active swipe (v4.10): /image replies
  // and model-attached images. Click expands via the same lightbox as
  // avatars. Entries group into SLOTS (one placement, one or more takes);
  // `swipe.imgUsed[slot]` picks the shown take. The active take carries `pos`
  // (stripped-text offset of its tool block) and the slot renders where the
  // model placed it — see the placement block below. Take handlers resolve
  // the node's ACTIVE swipe at event time, like the message swipe handlers.
  const imgs = Array.isArray(swipe.images) && swipe.images.length ? swipe.images : null;
  const slots = imgs ? groupImageSlots(imgs, swipe.imgUsed).map(g => ({
    slot: g.slot, take: g.active, activeIdx: g.activeIdx, count: g.takes.length,
    hasPending: g.takes.some(t => t?.pending),
  })) : null;
  const canImgRegen = imagesEnabled && !!onImgRegen;
  const imgSlotSwipe = (slot, dir) => onImgSwipe?.(node.id, slot, dir);
  const imgSlotRegen = (slot) => onImgRegen?.(node.id, slot);
  const zoomImg = (im, slot) => setLightbox({ src: im.src, title: im.caption || im.prompt || '', slot });
  // Slot lightboxes track LIVE take state (not the click-time snapshot), so
  // ←/→ take navigation inside the lightbox updates the view in place.
  const lbSlot = lightbox?.slot != null && slots ? slots.find(s => s.slot === lightbox.slot) ?? null : null;
  const lbSrc = lbSlot ? lbSlot.take?.src : lightbox?.src;
  // Fit-based meta collapse (phones): the row renders fully expanded and steps
  // down one level at a time until it fits — each level drops one more detail
  // from the inline row, right to left (model, edited, gen time, date, #),
  // then the action icons (t6). Never measured mid-stream (the row is widest
  // while generating); re-probes from t0 on swipe change and row resizes.
  // Pre-paint, so no flash. Applies at every width: without the t1–t6 rules a
  // contested row shrinks its spans to min-content and wraps mid-item, which
  // reads as a broken two-line row (worst with multi-speaker headers).
  const metaRef = useRef(null);
  const [metaLevel, setMetaLevel] = useState(0);
  useEffect(() => {
    const el = metaRef.current; if (!el) return;
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
    if (!el || streaming) return;
    if (el.scrollWidth > el.clientWidth + 1 && metaLevel < 6) setMetaLevel(l => l + 1);
  }, [metaLevel, streaming, swipe]);
  const text = subUser(swipe.text, personaName);
  const isUser = node.role === 'user';
  const isOOC = /^\[OOC:/i.test(text.trim());
  const hasProbs = !isUser && Array.isArray(swipe.tokens) && swipe.tokens.length > 0;
  // Ribbon token stats, best source first: the backend's reported usage
  // (stream_options include_usage — covers the reasoning tokens too on
  // thinking models), then the aligned logprob tape (real sampled count, but
  // never covers think — estimated on top), then the char estimate (~).
  const tapeLen = hasProbs ? swipe.tokens.length : 0;
  const usageTok = Number.isFinite(swipe.usage?.completion) ? swipe.usage.completion : null;
  const tokEst = usageTok == null && !tapeLen;
  const tokTotal = isUser ? 0
    : usageTok ?? ((tapeLen || estimateTokens(swipe.text)) + (swipe.think ? estimateTokens(swipe.think) : 0));
  // The gen stats render as ONE compact span — "58.7s · 3.5k tok · 59.3 t/s" —
  // so the ribbon stays short and the collapse cascade drops a single unit.
  // Parts appear as they exist: tokens stream live, time/speed once the swipe
  // finishes. Full precision + the count's source live on the tooltip.
  const tokShort = (n) => n >= 10000 ? `${Math.round(n / 1000)}k`
    : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
  const genSecs = Number.isFinite(swipe.genMs) ? swipe.genMs / 1000 : null;
  const genStatParts = [
    genSecs != null ? `${genSecs.toFixed(1)}s` : null,
    tokTotal > 0 ? `${tokEst ? '~' : ''}${tokShort(tokTotal)} tok` : null,
    tokTotal > 0 && genSecs > 0 ? `${(tokTotal / genSecs).toFixed(1)} t/s` : null,
  ].filter(Boolean);
  const genStatTitle = [
    genSecs != null ? `${genSecs.toFixed(1)}s generation time, prompt to completion` : null,
    tokTotal > 0 ? `${tokEst ? '~' : ''}${tokTotal} tokens, thinking included — ${usageTok != null
      ? 'reported by the backend' : tapeLen ? 'logprob count + estimated thinking' : 'estimated from characters'}` : null,
    tokTotal > 0 && genSecs > 0 ? `${(tokTotal / genSecs).toFixed(1)} tokens/s over the whole generation` : null,
  ].filter(Boolean).join(' · ');
  const speaker = isUser ? null : (swipe.speaker ?? detectSpeaker(text, characterNames) ?? 'Narrator');
  const isCharacter = !!speaker && speaker !== 'Narrator';
  // The speaker is already labeled in the meta row — hide the `Name:` prefix.
  // Whitespace-only text (a pre-fix multi-tool reply keeps the newlines that
  // separated its stripped blocks) renders exactly like an empty swipe.
  const rawDisplay = isCharacter ? stripSpeakerPrefix(text, speaker) : text;
  const displayText = rawDisplay.trim() ? rawDisplay : '';
  const n = node.activeSwipe + 1, m = node.swipes.length;
  // Swipe nav on every assistant message: at the last swipe ▶⁺ generates a
  // new take THERE (mid-chain regen forks a branch — the continuation is
  // kept), not just on the leaf.
  const showNav = m > 1 || !isUser;
  // Branch data: branchKids = every child of this node (each one a branch
  // root), childOnPathId = the child the active path follows. The ●/○ marker
  // derives from the path child's fromSwipe (the swipe the conversation
  // actually continued from), falling back to the node's usedSwipe record.
  const pathChild = branchKids.find(k => k.id === childOnPathId) ?? null;
  const usedIdx = Number.isInteger(node.usedSwipe) ? node.usedSwipe : null;
  const continuedIdx = pathChild ? (pathChild.fromSwipe ?? usedIdx) : usedIdx;
  const atUsed = continuedIdx === node.activeSwipe;
  const offPathKids = branchKids.filter(k => k.id !== childOnPathId);
  // Reasoning channel (swipe.think): its own bubble ahead of the reply —
  // visually separated like a speaker segment, but unnamed and collapsible.
  const thinkBubble = !isUser && !editing && showThinking !== false && swipe.think
    ? html`<div class="bubble think-bubble"><${ThinkBox} text=${subUser(swipe.think, personaName)} streaming=${streaming} thinkMs=${swipe.thinkMs} /></div>`
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
        if (dx < 0) { // swipe left: next swipe, or generate a new take here
          if (n < m) onSwipe(node.id, 1);
          else onRegenerate(node.id); // any assistant node — mid-chain forks a branch
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
  // Speaker-name colour: a character card's explicit colour wins; otherwise
  // the hue is hashed from the name (theme supplies saturation/lightness).
  const speakerStyle = (name) => {
    const col = name && characterColors?.[String(name).toLowerCase()];
    return col ? { color: col } : { '--speaker-h': hueForName(name) };
  };
  // Multi-speaker split: one swipe, several `Name:` parts → one
  // bubble per part. Rendering only; storage/swipes/probs are untouched.
  const segments = (isUser || isOOC) ? null : splitSpeakerSegments(text, characterNames);
  const multi = (segments?.length ?? 0) > 1;
  // ---- positional image placement (v4.10) ----
  // A swipe image entry may carry `pos`: the offset in the swipe's stripped
  // text where its ```tool block began. pos indexes swipe.text; the segment
  // offsets and the rendered markdown use the subUser'd text, so map pos
  // through the same substitution before comparing (a removed block always
  // leaves newline separation, so no {{user}} token can straddle pos).
  const posInText = (p) => subUser(String(swipe.text ?? '').slice(0, p), personaName).length;
  const probsShown = showProbs && hasProbs;
  // Free-standing image group: no bubble chrome. It does NOT ride the
  // message's swipe gesture — the image wrapper carries its own take-swipe
  // gesture (a horizontal swipe here flips image takes, not message swipes).
  const swipeImgs = (list, key = null) => html`
    <${SwipeImages} key=${key} slots=${list} onZoom=${zoomImg} generating=${generating}
      canRegen=${canImgRegen} onImgSwipe=${imgSlotSwipe} onImgRegen=${imgSlotRegen} />`;
  const freeImg = (list, key) => html`
    <div key=${key} class="msg-img-free">${swipeImgs(list)}</div>`;
  // Multi-speaker: an image hangs immediately AFTER the bubble of the last
  // segment whose content starts at/before pos — a block sitting in the gap
  // between two segments (their prefix/newline region) therefore lands after
  // the earlier one; pos before the first segment renders ahead of it; no
  // pos (legacy, /image) or past the last segment goes after the last bubble.
  // Placement iterates SLOTS (pos read from the active take — identical
  // across takes), so a multi-take placement renders once.
  const imgGroups = new Map(); // segment index (-1 = before all) → slot views
  if (multi && slots && !editing && !probsShown) {
    for (const sv of slots) {
      let place = segments.length - 1;
      if (Number.isFinite(sv.take?.pos)) {
        const p = posInText(sv.take.pos);
        place = -1;
        for (let si = 0; si < segments.length; si++)
          if (segments[si].start <= p) place = si;
      }
      imgGroups.set(place, [...(imgGroups.get(place) ?? []), sv]);
    }
  }
  // Single bubble: the image rides INSIDE the reply bubble — pos at/past the
  // visible end (trailing whitespace allowed) or absent → attached at the end;
  // pos at the very start → attached at the head; genuinely mid-text → EMBED
  // by splitting the display text at pos into two markdown blocks (the block
  // sat on a fenced line boundary, so the split lands on one too — no markdown
  // construct needs healing across it). A trailing/leading image never floats
  // free-standing next to the bubble — attached reads as part of the reply,
  // not an orphan (the image-only swipe is the exception: nothing to attach).
  let headImgs = null, endImgs = null, embeds = null, embedParts = null, freeImgs = null;
  const imageOnly = !multi && !isUser && !editing && !probsShown && !displayText && !!slots;
  if (!multi && !isUser && !isOOC && !probsShown && !editing && slots && displayText) {
    const prefixLen = text.length - displayText.length; // stripSpeakerPrefix shift
    const visibleEnd = displayText.trimEnd().length;
    for (const sv of slots) {
      const p = Number.isFinite(sv.take?.pos) ? posInText(sv.take.pos) - prefixLen : null;
      if (p == null || p >= visibleEnd) (endImgs ??= []).push(sv);
      else if (p <= 0) (headImgs ??= []).push(sv);
      else (embeds ??= []).push({ p, sv });
    }
    if (embeds) {
      embeds.sort((a, b) => a.p - b.p);
      embedParts = [displayText.slice(0, embeds[0].p),
        ...embeds.map((e, i) => displayText.slice(e.p, embeds[i + 1]?.p))];
    }
  } else if (imageOnly) {
    freeImgs = slots; // image-only swipe: free-standing, no bubble at all
  }
  // Cases that keep the images inside the bubble at the end, as before:
  // user messages, OOC, and the probs view (no markdown to embed into).
  const tailImgs = !multi && slots ? ((isUser || isOOC || probsShown) ? slots : endImgs) : null;
  // Nothing visible to put in a bubble (whitespace-only text — see above —
  // and no in-bubble images; not streaming, editing, or showing probs): skip
  // the shell entirely. The meta row stays — its ⚙ pill shows what happened.
  const hideBubble = imageOnly || (!editing && !streaming && !probsShown && !displayText && !tailImgs);
  // Multi-speaker swipe: the header names everyone who spoke, in speaking
  // order (first appearance), each with its own colour.
  const multiSpeakers = multi ? [...new Set(segments.map((s) => s.speaker ?? 'Narrator'))] : null;
  // Column avatar (avatarsOn): the persona on user messages; on assistant
  // replies the resolved speaker — a MULTI-speaker reply leaves this column
  // bare instead (each segment row carries its own gutter avatar below).
  // Map entries are { src, full }: the 256² thumb renders,
  // the uncropped companion feeds the click-to-expand lightbox. A map miss
  // renders a letter tile for a NAMED character only — an imageless user (no
  // persona image) or the Narrator gets the bare .msg-av slot instead (an
  // alignment spacer; the column itself always renders while avatarsOn).
  const avName = isUser ? personaName : (multi ? (segments[0].speaker ?? 'Narrator') : (speaker ?? 'Narrator'));
  const av = avatars?.[String(avName ?? '').toLowerCase()];
  const avTile = !isUser && avName !== 'Narrator'; // tile fallback is named-character-only
  // #, date, gen stats, edited, model shrink/collapse behind the › toggle when
  // the row overflows at any width (fit-measured per row, t1–t6 stages).
  const hasMetaDetails = !!(index != null || swipe.createdAt || Number.isFinite(swipe.genMs) || node.edited || swipe.modelId);
  // The row's content (meta row, bubbles, branch chip, context menu). With
  // avatars on, it wraps in .msg-body beside the .msg-av column; otherwise it
  // renders directly, exactly as before. The Fragment keeps it one child —
  // a bare multi-root html`` array as a child would trip React's key warning.
  const body = html`<${React.Fragment}>
      <div class="meta ${metaLevel ? `t${metaLevel}` : ''}" ref=${metaRef}>
        ${isUser ? html`<span class="who">${personaName}</span>`
          : multiSpeakers ? multiSpeakers.map((name, i) => html`${i > 0 ? ', ' : ''}<span key=${name}
              class="who ${name !== 'Narrator' ? 'speaker' : ''}"
              style=${name !== 'Narrator' ? speakerStyle(name) : null}>${name}</span>`)
          : html`<span class="who ${isCharacter ? 'speaker' : ''}"
              style=${isCharacter ? speakerStyle(speaker) : null}>${speaker}</span>`}
        ${swipe.interrupted && html`<span class="warn" title="The connection ended before the model finished — this reply is partial. Regenerate to replace it.">⚠\uFE0E interrupted</span>`}
        ${(swipe.toolCalls ?? []).length > 0 && html`
          <button class="pill tools-toggle" title="Tool calls made during this generation — click to view"
            onClick=${() => setToolsOpen(!toolsOpen)}>⚙\uFE0E ${swipe.toolCalls.length}</button>
          ${toolsOpen && html`
            <span class="tools-pop">
              ${swipe.toolCalls.map((t, i) => html`<${ToolCallRow} key=${i} t=${t} />`)}
            </span>`}`}
        ${memCount > 0 && html`
          <button class="pill memory" title=${`${memCount} ${memCount === 1 ? 'memory' : 'memories'} recorded at this point in the chat — open the Memory tab`}
            onClick=${() => onOpenMemory?.()}>▤ ${memCount}</button>`}
        ${hasMetaDetails && html`
          <button class="btn small ghost meta-toggle" title="Message info"
            onClick=${() => setMetaOpen(!metaOpen)}>${metaOpen ? '⌄' : '›'}</button>`}
        <span class="meta-details ${metaOpen ? 'open' : ''}" onClick=${() => setMetaOpen(false)}>
          ${index != null && html`<span class="md-index">#${index}</span>`}
          ${swipe.createdAt && html`<span class="md-date">${fmtDate(swipe.createdAt, dateFormat)}</span>`}
          ${genStatParts.length > 0 && html`<span class="md-gen" title=${genStatTitle}>${genStatParts.join(' · ')}</span>`}
          ${node.edited && html`<span class="md-edited">(edited)</span>`}
          ${swipe.modelId && html`<span class="md-model" title=${swipe.modelId}>${swipe.modelId}</span>`}
        </span>
        <span class="grow" style=${{ flex: 1 }}></span>
        <span class="actions ${streaming ? 'always' : ''} ${actionsOpen ? 'open' : ''}"
          onClick=${() => setActionsOpen(false)}>
          ${hasProbs && html`<button class="btn small ghost ${showProbs ? 'primary' : ''}" title="Token probabilities"
            onClick=${() => setShowProbs(!showProbs)}>▦</button>`}
          <button class="btn small ghost" title="Edit" disabled=${generating}
            onClick=${() => { setDraft(swipe.text); setEditing(true); }}>✎</button>
          ${!isUser && html`<button class="btn small ghost" title="Regenerate (new swipe)" disabled=${generating || auxBusy}
            onClick=${() => onRegenerate(node.id)}>↻</button>`}
          ${isUser && html`<button class="btn small ghost" title="Reply from here (generate assistant response)" disabled=${generating || auxBusy}
            onClick=${() => onReply(node.id)}>↻</button>`}
          <button class="btn small ghost" title="Fork to a new chat (copies everything up to this message)" disabled=${generating}
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
            <button class="btn small ghost" title="Previous swipe" disabled=${generating || n <= 1} onClick=${() => onSwipe(node.id, -1)}>◀\uFE0E</button>
            <span>${n}/${m}</span>
            ${continuedIdx != null && html`
              <span class="used-dot ${atUsed ? '' : 'jump'}"
                title=${atUsed ? 'This is the version the conversation continued from' : `The conversation continued from swipe ${continuedIdx + 1} — click to view`}
                onClick=${() => !atUsed && onSwipeTo(node.id, continuedIdx)}>${atUsed ? '●' : '○'}</span>`}
            ${n < m
              ? html`<button class="btn small ghost" title="Next swipe" disabled=${generating} onClick=${() => onSwipe(node.id, 1)}>▶\uFE0E</button>`
              : !isUser
                ? html`<button class="btn small ghost gen" title="Generate a new version here — the current continuation is kept as a branch" disabled=${generating || auxBusy}
                    onClick=${() => onRegenerate(node.id)}>▶\uFE0E⁺</button>`
                : html`<button class="btn small ghost" disabled>▶\uFE0E</button>`}
          </span>`}

      </div>
      ${multi && !editing && !probsShown ? html`
        ${thinkBubble}
        ${imgGroups.get(-1) ? freeImg(imgGroups.get(-1), 'img-pre') : null}
        ${segments.map((seg, si) => {
          // Each segment is a mini-message: the speaker's avatar hangs in the
          // gutter beside its own bubble (image / named-character tile / bare
          // slot — the message-level column stays an empty spacer in this
          // mode), the name chip above the bubble. Same per-character
          // differentiation a single-speaker reply gets.
          const segName = seg.speaker ?? 'Narrator';
          const segAv = avatarsOn ? avatars?.[segName.toLowerCase()] : null;
          return html`
          <div key=${si} class="seg-row">
            ${avatarsOn && html`<div class="msg-av">
              ${(segAv?.src || seg.speaker) && html`<${Avatar} name=${segName} src=${segAv?.src ?? ''} size=${40}
                onClick=${segAv?.src ? () => setLightbox({ src: segAv.full, title: segName }) : null} />`}
            </div>`}
            <div class="seg-col">
              <div class="seg-who ${seg.speaker ? 'speaker' : ''}"
                style=${seg.speaker ? speakerStyle(seg.speaker) : null}>${segName}</div>
              <div class="bubble seg ${dragX !== 0 ? 'dragging' : ''}"
                style=${{ transform: dragX ? `translateX(${dragX}px)` : null }}
                ...${gestureHandlers}>
                <div class=${streaming && si === segments.length - 1 ? 'streaming-cursor' : ''}><${ThrottledMarkdown} text=${seg.text} prose streaming=${streaming && si === segments.length - 1} /></div>
              </div>
            </div>
          </div>
          ${imgGroups.get(si) ? freeImg(imgGroups.get(si), `img-${si}`) : null}`;})}` : html`
      ${thinkBubble}
      ${!hideBubble && html`<div class="bubble ${dragX !== 0 ? 'dragging' : ''}"
        style=${{ transform: dragX ? `translateX(${dragX}px)` : null }}
        ...${gestureHandlers}>
        ${!editing && headImgs && swipeImgs(headImgs)}
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
          probsShown
            ? html`<${ProbsView} tokens=${swipe.tokens} onPick=${(i, alt) => onRegenFromToken(node.id, i, alt)} />` :
          isOOC
            ? html`<div class="plain ${streaming ? 'streaming-cursor' : ''}">${displayText}</div>` :
          embeds
            // A mid-text image splits the markdown at its block's position —
            // the fence sat on a line boundary, so both halves parse cleanly.
            ? html`${embedParts.map((part, pi) => html`
              ${pi > 0 ? swipeImgs([embeds[pi - 1].sv], `ei${pi}`) : null}
              ${part ? html`<div key=${`ep${pi}`} class=${streaming ? 'streaming-cursor' : ''}><${ThrottledMarkdown} text=${part} prose streaming=${streaming} /></div>` : null}`)}` :
          // Only a user message with nothing but images renders no text block
          // (an assistant image-only swipe skips the bubble entirely).
          displayText || !imgs
            ? html`<div class=${streaming ? 'streaming-cursor' : ''}><${ThrottledMarkdown} text=${displayText} prose streaming=${streaming} /></div>`
            : null}
        ${!editing && tailImgs && swipeImgs(tailImgs)}
      </div>`}
      ${freeImgs ? freeImg(freeImgs, 'img-post') : null}`}
      ${offPathKids.length > 0 && html`
        <div class="branch-chip-row">
          <button class="branch-chip" disabled=${generating}
            title="This message has continuations on other branches — click to compare or switch"
            onClick=${(e) => {
              if (!branchOpen) {
                // Flip up when the popover wouldn't fit below the chip (a
                // truncated pseudo-branch sits at the bottom of the chat).
                const r = e.currentTarget.getBoundingClientRect();
                setBranchUp(window.innerHeight - r.bottom < 300);
              }
              setBranchOpen(!branchOpen);
            }}>⎇ ${offPathKids.length} other ${offPathKids.length === 1 ? 'branch' : 'branches'} from here ${branchOpen ? '▴' : '▾'}</button>
          ${branchOpen && html`
            <span class="tools-pop branch-pop ${branchUp ? 'above' : ''}">
              ${branchKids.map(k => {
                const cur = k.id === childOnPathId;
                const kFrom = k.fromSwipe ?? usedIdx ?? 0;
                return html`
                  <button key=${k.id} class="branch-row ${cur ? 'current' : ''}" disabled=${generating || cur}
                    title=${cur ? 'This is the branch you are on' : 'Switch to this branch'}
                    onClick=${() => { setBranchOpen(false); onJump(k.id); }}>
                    <span class="ct-dot ${k.role}"></span>
                    ${kFrom !== node.activeSwipe && html`<span class="branch-sw">swipe ${kFrom + 1}</span>`}
                    <span class="branch-text">${toPreview(activeText(k), 80) || '(empty)'}</span>
                    ${cur && html`<span class="branch-cur">current</span>`}
                  </button>`;
              })}
              <button class="branch-row branch-tree" onClick=${() => { setBranchOpen(false); onOpenBranches?.(); }}>⎇ View all branches</button>
            </span>`}
        </div>`}
      ${ctxMenu && html`
        <${ContextMenu} x=${ctxMenu.x} y=${ctxMenu.y} onClose=${() => setCtxMenu(null)}
          items=${[
            ...(hasProbs ? [{ label: 'Token probabilities', fn: () => setShowProbs(!showProbs) }] : []),
            { label: 'Edit', fn: () => { setDraft(swipe.text); setEditing(true); }, disabled: generating },
            isUser
              ? { label: 'Reply from here', fn: () => onReply(node.id), disabled: generating || auxBusy }
              : { label: 'Regenerate (new swipe)', fn: () => onRegenerate(node.id), disabled: generating || auxBusy },
            { label: 'Fork to new chat', fn: () => onBranch(node.id) },
            ...(!isRoot ? [
              '-',
              { label: 'Rewind to here', fn: () => confirm('Rewind the chat to this message? Later messages stay in the tree but leave the active branch; memories are rolled back.') && onRewind(node.id), disabled: generating },
              { label: 'Delete message (and its branch)', fn: () => confirm('Delete this message and everything after it in its branch?') && onDelete(node.id), danger: true, disabled: generating },
            ] : []),
          ]} />`}<//>`;
  return html`
    <div class="msg ${isUser ? 'user' : 'assistant'} ${isOOC ? 'ooc' : ''} ${selected ? 'kbdsel' : ''} ${avatarsOn ? 'with-av' : ''}" data-mid=${node.id}
      onContextMenu=${(e) => {
        // Keep the native menu when the user has text selected (copy etc.).
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}>
      ${avatarsOn && html`
        <div class="msg-av">
          ${!(multi && !editing && !probsShown) && (av?.src || avTile) && html`
            <${Avatar} name=${avName ?? ''} src=${av?.src ?? ''} size=${40}
              onClick=${av?.src ? () => setLightbox({ src: av.full, title: avName }) : null} />`}
        </div>`}
      ${avatarsOn ? html`<div class="msg-body">${body}</div>` : body}
      ${lightbox && lbSrc && html`<${Lightbox} src=${lbSrc}
        title=${lbSlot ? (lbSlot.take?.caption || lbSlot.take?.prompt || '') : lightbox.title}
        onClose=${() => setLightbox(null)}
        ...${lbSlot && lbSlot.count > 1 ? {
          onPrev: lbSlot.activeIdx > 0 ? () => imgSlotSwipe(lbSlot.slot, -1) : null,
          onNext: lbSlot.activeIdx < lbSlot.count - 1 ? () => imgSlotSwipe(lbSlot.slot, 1) : null,
          pos: `${lbSlot.activeIdx + 1}/${lbSlot.count}`,
        } : {}} />`}
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


// ============================================================================
// COMPONENTS: BRANCH PANEL — the message graph condensed to its branch
// structure. Single-child runs collapse into one segment ("#start · preview ·
// N msg"), so long chats render a handful of items, not one per message; only
// branch points (≥ 2 children) fork, and swipe alternatives that nothing
// continues from don't appear (those stay inline-arrow territory).
// Two renderings: the indent-guided outline (default — degenerates the most
// gracefully) and a sparse top-down graph (fork depth grows downward —
// mouse-wheel friendly — with SVG bezier edges on a fixed grid, no library),
// swapped via the Graph/Outline toggle. Active path highlighted, leaf marked,
// click = switch.
// ============================================================================
function BranchPanel({ chat, personaName = 'User', generating = false, onJump }) {
  const messages = chat.messages ?? {};
  const kidsOf = new Map();
  const roots = [];
  for (const n of Object.values(messages)) {
    if (!n) continue;
    if (n.parentId && messages[n.parentId]) {
      if (!kidsOf.has(n.parentId)) kidsOf.set(n.parentId, []);
      kidsOf.get(n.parentId).push(n);
    } else roots.push(n);
  }
  const byAge = (a, b) => ((a.swipes?.[0]?.createdAt ?? 0) - (b.swipes?.[0]?.createdAt ?? 0)) || (a.id < b.id ? -1 : 1);
  for (const kids of kidsOf.values()) kids.sort(byAge);
  roots.sort(byAge);
  const activeIds = pathIdSet(messages, chat.activeLeafId);
  // swipe tag for a branch, only when the siblings continue DIFFERENT parent
  // swipes (same-swipe siblings need no disambiguation).
  const swipeTagOf = (kid, kids) => {
    const parent = messages[kid.parentId];
    if ((parent?.swipes?.length ?? 1) < 2) return null;
    const froms = new Set(kids.map(k => k.fromSwipe ?? parent?.usedSwipe ?? 0));
    return froms.size > 1 ? `swipe ${(kid.fromSwipe ?? parent?.usedSwipe ?? 0) + 1}` : null;
  };
  // Condensed segments, shared by both renderers. `num` is the segment's
  // 1-based message position (root = 1, like the chat log's # meta) so a
  // branch forking at #78 vs #108 reads correctly at a glance.
  const rendered = new Set(); // cycle guard (crafted imports)
  const segs = [];
  const buildSeg = (start, depth, swipeTag) => {
    if (rendered.has(start.id)) return null;
    const chain = [start];
    const seen = new Set([start.id]);
    let end = start;
    while ((kidsOf.get(end.id) ?? []).length === 1) {
      const nxt = kidsOf.get(end.id)[0];
      if (seen.has(nxt.id)) break;
      seen.add(nxt.id);
      end = nxt;
      chain.push(nxt);
    }
    for (const n of chain) rendered.add(n.id);
    const kids = kidsOf.get(end.id) ?? [];
    const seg = {
      id: start.id, start, chain, depth, swipeTag,
      num: getActivePath(messages, start.id).length,
      onPath: chain.some(n => activeIds.has(n.id)),
      hasLeaf: chain.some(n => n.id === chat.activeLeafId),
      kids: [],
    };
    segs.push(seg);
    if (kids.length > 1)
      seg.kids = kids.map(k => buildSeg(k, depth + 1, swipeTagOf(k, kids))).filter(Boolean);
    return seg;
  };
  const segRoots = roots.map(r => buildSeg(r, 0, null)).filter(Boolean);
  const branchPoints = segs.reduce((n, s) => n + (s.kids.length > 1 ? 1 : 0), 0);
  // View toggle: outline is the default everywhere (it degenerates the most
  // gracefully); the user can flip to the sparse graph per opening.
  const [viewPref, setViewPref] = useState(null); // null = default
  const mode = viewPref ?? 'outline';
  const hint = html`
    <div class="hint bview-head">
      <span>
        ${Object.keys(messages).length} messages · ${branchPoints} branch ${branchPoints === 1 ? 'point' : 'points'}.
        ${branchPoints === 0
          ? 'No branches yet — swiping or regenerating a message mid-chat keeps the old continuation as a branch here.'
          : 'Each item is a run of messages starting at the # shown; forks are alternative continuations. The highlighted chain is what you are looking at — click to switch to it. Nothing is deleted — branches just leave the active path.'}
      </span>
      ${roots.length > 0 && html`
        <span class="bview-toggle">
          <button class="btn small ghost ${mode === 'graph' ? 'active' : ''}" onClick=${() => setViewPref('graph')}>Graph</button>
          <button class="btn small ghost ${mode === 'outline' ? 'active' : ''}" onClick=${() => setViewPref('outline')}>Outline</button>
        </span>`}
    </div>`;
  if (roots.length === 0) return html`<div>${hint}<div class="hint">No messages yet.</div></div>`;

  // ---- sparse graph rendering (top-down: fork depth grows downward with
  // the scroll wheel, tips spread across columns) ----
  if (mode === 'graph') {
    const COL_W = 164, ROW_H = 56, NODE_W = 148, NODE_H = 44, PAD = 10;
    // Column layout: the oldest continuation keeps the parent's column, so
    // the mainline reads as one straight vertical line; each further sibling
    // starts a fresh column to the right, spaced by its subtree's tip count.
    // (Parent-centered tidy layouts strand whole columns of empty space.)
    const widthOf = (seg) => seg.kids.length ? seg.kids.reduce((w, k) => w + widthOf(k), 0) : 1;
    const xOf = new Map(); // segment → column
    const place = (seg, col) => {
      xOf.set(seg.id, col);
      let c = col;
      for (const kid of seg.kids) { place(kid, c); c += widthOf(kid); }
    };
    let colCount = 0;
    for (const r of segRoots) { place(r, colCount); colCount += widthOf(r); }
    const maxDepth = segs.reduce((d, s) => Math.max(d, s.depth), 0);
    const width = PAD * 2 + Math.max(1, colCount) * COL_W;
    const height = PAD * 2 + (maxDepth + 1) * ROW_H;
    const posOf = (seg) => ({
      x: PAD + xOf.get(seg.id) * COL_W + (COL_W - NODE_W) / 2,
      y: PAD + seg.depth * ROW_H,
    });
    const edges = [];
    for (const seg of segs) for (const kid of seg.kids) {
      const a = posOf(seg), b = posOf(kid);
      const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H, x2 = b.x + NODE_W / 2, y2 = b.y;
      edges.push({ x1, y1, x2, y2, active: seg.onPath && kid.onPath, key: `${seg.id}>${kid.id}` });
    }
    return html`
      <div>${hint}
        <div class="bgraph-wrap">
          <div class="bgraph" style=${{ width: `${width}px`, height: `${height}px` }}>
            <svg class="bgraph-edges" width=${width} height=${height}>
              ${edges.map(e => html`<path key=${e.key} class=${e.active ? 'active' : ''}
                d=${`M ${e.x1} ${e.y1} C ${e.x1} ${e.y1 + 22}, ${e.x2} ${e.y2 - 22}, ${e.x2} ${e.y2}`} />`)}
            </svg>
            ${segs.map(seg => {
              const p = posOf(seg);
              return html`
                <button key=${seg.id} class="bg-node ${seg.onPath ? 'active' : ''} ${seg.hasLeaf ? 'leaf' : ''}"
                  style=${{ left: `${p.x}px`, top: `${p.y}px`, width: `${NODE_W}px`, minHeight: `${NODE_H}px` }}
                  disabled=${generating}
                  title=${generating ? 'Wait for the generation to finish' : `Switch to this branch — ${toPreview(subUser(activeText(seg.start), personaName), 160)}`}
                  onClick=${() => onJump(seg.id)}>
                  <span class="bg-top">
                    <span class="ct-dot ${seg.start.role === 'user' ? 'user' : 'assistant'}"></span>
                    <span class="bg-num">#${seg.num}</span>
                    ${seg.swipeTag && html`<span class="ct-sw">${seg.swipeTag}</span>`}
                    ${seg.chain.length > 1 && html`<span class="ct-len">${seg.chain.length} msg</span>`}
                    ${seg.hasLeaf && html`<span class="ct-leaf" title="The active end of the conversation">●</span>`}
                  </span>
                  <span class="bg-text">${toPreview(subUser(activeText(seg.start), personaName), 34) || '(empty)'}</span>
                </button>`;
            })}
          </div>
        </div>
      </div>`;
  }

  // ---- outline fallback (huge branch structures) ----
  const segView = (seg) => html`
    <div class="ct-node" key=${seg.id}>
      <button class="ct-row ${seg.onPath ? 'active' : ''} ${seg.hasLeaf ? 'leaf' : ''}" disabled=${generating}
        title=${generating ? 'Wait for the generation to finish' : 'Switch to the branch through this message'}
        onClick=${() => onJump(seg.id)}>
        <span class="ct-dot ${seg.start.role === 'user' ? 'user' : 'assistant'}"></span>
        <span class="ct-num">#${seg.num}</span>
        ${seg.swipeTag && html`<span class="ct-sw">${seg.swipeTag}</span>`}
        <span class="ct-text">${toPreview(subUser(activeText(seg.start), personaName), 110) || '(empty)'}</span>
        ${seg.chain.length > 1 && html`<span class="ct-len">${seg.chain.length} msg</span>`}
        ${seg.kids.length > 1 && html`<span class="ct-br" title=${`${seg.kids.length} branches continue from here`}>⎇ ${seg.kids.length}</span>`}
        ${seg.hasLeaf && html`<span class="ct-leaf" title="The active end of the conversation">●</span>`}
      </button>
      ${seg.kids.length > 1 && html`<div class="ct-kids">${seg.kids.map(segView)}</div>`}
    </div>`;
  return html`<div>${hint}<div class="ctree">${segRoots.map(segView)}</div></div>`;
}
