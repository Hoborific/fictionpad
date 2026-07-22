// ============================================================================
// COMPONENTS: CONTEXT INSPECTOR — renders the assembler manifest. This is the
// activation-observability surface: exactly what was injected, and why.
// ============================================================================
// Expandable row: one-line preview collapsed, full content on click, native
// tooltip with a longer excerpt on hover.
function InspectorRow({ pills = [], title, meta, preview, content, dimmed = false }) {
  const [open, setOpen] = useState(false);
  return html`
    <div class="lore-item-row ${dimmed ? 'dimmed' : ''}" title=${content ? String(content).slice(0, 500) : null}>
      <div class="row" style=${{ cursor: 'pointer' }} onClick=${() => setOpen(!open)}>
        <span class="hint">${open ? '▾' : '▸'}</span>
        ${pills.map((p, i) => html`<span key=${i} class="pill ${p.cls}">${p.text}</span>`)}
        <span style=${{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${title}</span>
        ${meta && html`<span class="hint">${meta}</span>`}
      </div>
      ${!open && preview && html`<div class="ir-preview">${preview}</div>`}
      ${open && content && html`<div class="ir-content">${content}</div>`}
    </div>`;
}

// Collapsible section header (Context / Lore / Memories) — open by default,
// collapse state persisted per section. `meta` renders dim after the title.
function InspectorSection({ title, count, meta, children }) {
  const [open, setOpen] = usePersistentState(`fictionpad.inspector.section.${title}`, true);
  return html`
    <div>
      <h4 class="ir-toggle" onClick=${() => setOpen(o => !o)}>
        ${open ? '▾' : '▸'} ${title}${count != null ? ` (${count})` : ''}${meta && html` <span class="hint">${meta}</span>`}</h4>
      ${open && children}
    </div>`;
}

// One budget layer as a lore-row-style card: name + tokens/cap, a usage meter
// (warning-colored past 90%), a one-line note collapsed, context on expand.
// Expanded by default; open state persisted per card.
function LayerCard({ name, tokens, cap, note, about }) {
  const [open, setOpen] = usePersistentState(`fictionpad.inspector.layer.${name}`, true);
  const pct = cap > 0 ? Math.min(100, Math.round((tokens / cap) * 100)) : 0;
  return html`
    <div class="lore-item-row">
      <div class="row" style=${{ cursor: 'pointer' }} onClick=${() => setOpen(o => !o)}>
        <span class="hint">${open ? '▾' : '▸'}</span>
        <span style=${{ flex: 1 }}>${name} <span class="hint">(${pct}%)</span></span>
        <span class="hint" style=${{ fontVariantNumeric: 'tabular-nums' }}>${tokens} / ${cap}t</span>
      </div>
      <div class="lt-meter">
        <div class="lt-fill ${pct > 90 ? 'lt-hot' : ''}"
          style=${{ width: (tokens > 0 ? Math.max(pct, 1) : 0) + '%' }} />
      </div>
      ${!open && note && html`<div class="ir-preview">${note}</div>`}
      ${open && about && html`<div class="ir-content">${about}</div>`}
    </div>`;
}

function ContextInspector({ manifest, onPreview, hasChat, realCounts }) {
  const [showInactive, setShowInactive] = useState(false);
  if (!manifest?.layers) return html`
    <div>
      <div class="hint">No generation recorded yet. Send a message, or preview the context that would be sent right now.</div>
      ${hasChat && html`<button class="btn" style=${{ marginTop: '8px' }} onClick=${onPreview}>Preview current context</button>`}
    </div>`;
  const L = manifest.layers;
  // One number per card, one source per panel: when /tokenize gave us a real
  // total, every card shows its real count (est fallback for empty blocks);
  // otherwise all cards are estimates. The greeting is the first chat message,
  // so it counts toward History here; budgeting still treats it as pinned.
  const exact = realCounts?.total != null;
  const tok = (est, real) => (exact ? (real ?? est) : est);
  const total = tok(manifest.totalTokens, realCounts?.total);
  const src = exact ? 'exact' : 'estimated';
  const hasGreeting = (L.greeting?.tokens ?? 0) > 0;
  const histTok = tok(L.history.tokens + (L.greeting?.tokens ?? 0),
    exact ? (realCounts?.history ?? 0) + (realCounts?.greeting ?? 0) : null);
  const keptNote = L.history.dropped
    ? `${L.history.kept} of ${L.history.kept + L.history.dropped} messages kept — oldest dropped to fit`
    : `all ${L.history.kept} message${L.history.kept === 1 ? '' : 's'} kept`;
  const memPinned = L.memory.memories.filter(m => m.pinned).length;
  // Semantic activation observability: per-piece cosine scores from the last
  // generation (only present when an embedding model ran). Injected smart
  // pieces show their score; inactive ones show score vs threshold so
  // near-misses answer "why didn't this trigger?".
  const sem = manifest.semantic ?? null;
  const semScore = new Map((sem?.scores ?? []).map(s => [s.id, s.score]));
  const semPill = (id, injected) => {
    if (!semScore.has(id)) return [];
    const score = semScore.get(id);
    if (injected) return [{ text: `sim ${score.toFixed(2)}`, cls: 'semantic' }];
    const near = score >= (sem.threshold - 0.10);
    return [{ text: `sim ${score.toFixed(2)} < ${sem.threshold.toFixed(2)}`, cls: near ? 'link-boosted' : '' }];
  };
  return html`
    <div>
      <${InspectorSection} title="Context"
        meta=${`(${manifest.budget > 0 ? Math.round((total / manifest.budget) * 100) : 0}%)`}>
        <${LayerCard} name="Static"
          tokens=${tok(L.static.tokens, realCounts?.static)} cap=${L.static.cap}
          note="platform prompt · scenario · persona"
          about="Platform system prompt, scenario instructions and backstory, and the persona — always sent in full." />
        <${LayerCard} name="Lore"
          tokens=${tok(L.lore.tokens, realCounts?.lore)} cap=${L.lore.cap}
          note=${`${L.lore.pieces.length} injected${(L.lore.inactive ?? []).length ? ` · ${L.lore.inactive.length} not` : ''}`}
          about="Lore pieces pinned or triggered by recent messages, ordered by weight and trimmed to budget." />
        <${LayerCard} name="Memory"
          tokens=${tok(L.memory.tokens, realCounts?.memory)} cap=${L.memory.cap}
          note=${L.memory.memories.length
            ? `${L.memory.memories.length} injected · ${memPinned} pinned` : 'no memories yet'}
          about="Pinned memories first, then recent ones, trimmed to budget; new summaries are written as the chat grows." />
        <${LayerCard} name="History"
          tokens=${histTok} cap=${L.history.cap}
          note=${hasGreeting ? `greeting + ${keptNote}` : keptNote}
          about="Chat messages, oldest dropped first under pressure; the greeting is pinned and always sent." />
        <${LayerCard} name="Total"
          tokens=${total} cap=${manifest.budget}
          about="Everything sent to the model. Budget = context length minus the response reserve." />
        <div class="hint" style=${{ margin: '2px 0 8px' }}>
          ${src} counts · ctx ${manifest.contextLength} − ${manifest.reserve} reserve
        </div>
        ${manifest.warnings.map((w, i) => html`<div class="warn" key=${i}>⚠\uFE0E ${w}</div>`)}
      <//>
      <${InspectorSection} title="Lore injected" count=${L.lore.pieces.length}>
        ${L.lore.pieces.length === 0 && html`<div class="hint">No lore pieces active.</div>`}
        ${L.lore.pieces.map(p => html`
          <${InspectorRow} key=${p.id}
            pills=${[{ text: p.reason, cls: p.reason },
              ...(p.origin === 'chat' ? [{ text: 'chat', cls: 'chat' }] : []),
              ...(p.boost > 0 && p.reason !== 'link-boosted' ? [{ text: `+${p.boost} boost`, cls: 'link-boosted' }] : []),
              ...semPill(p.id, true)]}
            title=${p.title} meta=${`w${p.weight} · ${p.tokens}t`}
            preview=${p.preview} content=${p.content} />`)}
        ${(L.lore.inactive ?? []).length > 0 && html`
          <div class="hint ir-toggle" onClick=${() => setShowInactive(!showInactive)}>
            Not injected (${L.lore.inactive.length}) ${showInactive ? '▾' : '▸'}
          </div>
          ${showInactive && L.lore.inactive.map((p, i) => html`
            <${InspectorRow} key=${p.id ?? i} dimmed
              pills=${[{ text: p.reason, cls: p.reason === 'over-budget' ? 'pinned' : '' },
                ...(p.origin === 'chat' ? [{ text: 'chat', cls: 'chat' }] : []),
                ...semPill(p.id, false)]}
              title=${p.title} meta=${`${p.tokens}t`}
              preview=${p.preview} content=${p.content} />`)}`}
      <//>
      <${InspectorSection} title="Memories injected" count=${L.memory.memories.length}>
        ${L.memory.memories.length === 0 && html`<div class="hint">No memories injected.</div>`}
        ${L.memory.memories.map((m, i) => html`
          <${InspectorRow} key=${m.id ?? i}
            pills=${m.pinned ? [{ text: 'pinned', cls: 'pinned' }] : []}
            title=${`memory ${String(m.id ?? '').slice(-6)}`} meta=${`${m.tokens}t`}
            preview=${m.preview} content=${m.text} />`)}
      <//>
      ${(manifest.toolCalls ?? []).length > 0 && html`
        <${InspectorSection} title="Tool calls" count=${manifest.toolCalls.length}>
          ${manifest.toolCalls.map((t, i) => html`
            <${InspectorRow} key=${i} dimmed=${!t.ok}
              pills=${[{ text: t.ok ? 'ok' : 'failed', cls: t.ok ? 'chat' : 'pinned' }]}
              title=${t.name || '(unparsed)'} meta=${t.note}
              preview=${t.args} content=${t.args} />`)}
        <//>`}
      ${hasChat && html`<button class="btn" style=${{ marginTop: '8px' }} onClick=${onPreview}>Re-run assembler on current chat</button>`}
    </div>`;
}

