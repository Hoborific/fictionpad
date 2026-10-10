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
