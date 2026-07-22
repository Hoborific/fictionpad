// ============================================================================
// COMPONENTS: SCENARIO EDITOR — full CRUD incl. lore piece editor.
// ============================================================================
function newLorePiece() {
  return {
    id: uid(), type: 'lore', title: '', content: '', keys: [],
    pinned: false, weight: 0, links: [], enabled: true, searchDepth: null,
    wholeWord: false, caseSensitive: false, // trigger key matching options
    smart: false, // semantic (embedding) activation — needs settings.embeddingModel
    hidden: false, playable: false,
  };
}

// Text field for string-array values (lore keys, tags). Keeps the raw text
// locally so in-progress typing (trailing newlines, ", " before the next
// item) isn't destroyed by the parse→join roundtrip; only re-syncs from the
// parent when the value genuinely changed externally (piece switch, import).
function ListInput({ values, onChange, textarea, delim, ...rest }) {
  const joiner = delim === '\n' ? '\n' : ', ';
  const parse = (raw) => String(raw).split(delim).map(s => s.trim()).filter(Boolean);
  const [text, setText] = useState(() => (values ?? []).join(joiner));
  useEffect(() => {
    const parsed = parse(text);
    const v = values ?? [];
    const same = parsed.length === v.length && parsed.every((x, i) => x === v[i]);
    if (!same) setText(v.join(joiner));
  }, [values]);
  const handle = (e) => { setText(e.target.value); onChange(parse(e.target.value)); };
  return textarea
    ? html`<textarea value=${text} onInput=${handle} ...${rest} />`
    : html`<input type="text" value=${text} onInput=${handle} ...${rest} />`;
}

function LorePieceCard({ piece, allPieces, onChange, onRemove }) {
  const [open, setOpen] = useState(false);
  const set = (patch) => onChange({ ...piece, ...patch });
  const others = allPieces.filter(p => p.id !== piece.id);
  return html`
    <div class="lore-card">
      <div class="lc-head" onClick=${() => setOpen(!open)}>
        <span>${open ? '▾' : '▸'}</span>
        <span class="t">${piece.title || '(untitled)'}</span>
        ${piece.type === 'character' && html`<span class="pill">character</span>`}
        ${piece.pinned && html`<span class="pill pinned">pinned</span>`}
        ${piece.enabled === false && html`<span class="pill">disabled</span>`}
        <button class="btn small danger" onClick=${(e) => { e.stopPropagation(); onRemove(); }}>✕</button>
      </div>
      ${open && html`
        <div class="lc-body">
          <div class="grid2">
            <label class="field"><span>Title</span>
              <input type="text" value=${piece.title} onInput=${(e) => set({ title: e.target.value })} /></label>
            <label class="field"><span>Type</span>
              <select value=${piece.type} onChange=${(e) => set({ type: e.target.value })}>
                <option value="lore">lore</option>
                <option value="character">character</option>
              </select></label>
          </div>
          <label class="field"><span>Content — sent to the AI when active. {{user}} works here.</span>
            <textarea rows=${4} value=${piece.content} onInput=${(e) => set({ content: e.target.value })} /></label>
          <label class="field"><span>Trigger keys — one per line, regex; keys under 2 chars never fire</span>
            <${ListInput} textarea=${true} delim=${'\n'} rows=${3} values=${piece.keys}
              onChange=${(keys) => set({ keys })} /></label>
          <div class="field"><span>Key matching</span>
            <label class="check" title="Keys only match at word boundaries — 'cat' won't match 'cathedral'">
              <input type="checkbox" checked=${!!piece.wholeWord} onChange=${(e) => set({ wholeWord: e.target.checked })} /> whole word</label>
            <label class="check" title="Keys match with exact letter case (default is case-insensitive)">
              <input type="checkbox" checked=${!!piece.caseSensitive} onChange=${(e) => set({ caseSensitive: e.target.checked })} /> case sensitive</label>
          </div>
          <label class="check" title="Embed this piece + the recent conversation each generation; activates on similarity even without keyword overlap">
            <input type="checkbox" checked=${!!piece.smart} onChange=${(e) => set({ smart: e.target.checked })} />
            Smart activation (semantic) — requires an embeddings model in Settings
          </label>
          <div class="grid3">
            <label class="field"><span>Weight</span>
              <input type="number" value=${piece.weight ?? 0} onInput=${(e) => set({ weight: Number(e.target.value) })} /></label>
            <label class="field"><span>Search depth (est. tokens)</span>
              <input type="number" placeholder="2048" value=${piece.searchDepth ?? ''}
                onInput=${(e) => set({ searchDepth: e.target.value === '' ? null : Number(e.target.value) })} /></label>
            <div class="field"><span>Flags</span>
              <label class="check"><input type="checkbox" checked=${!!piece.pinned} onChange=${(e) => set({ pinned: e.target.checked })} /> pinned</label>
              <label class="check"><input type="checkbox" checked=${piece.enabled !== false} onChange=${(e) => set({ enabled: e.target.checked })} /> enabled</label>
            </div>
          </div>
          ${piece.type === 'character' && html`
            <div class="field"><span>Character flags</span>
              <label class="check"><input type="checkbox" checked=${!!piece.hidden} onChange=${(e) => set({ hidden: e.target.checked })} /> hidden</label>
              <label class="check"><input type="checkbox" checked=${!!piece.playable} onChange=${(e) => set({ playable: e.target.checked })} /> playable</label>
            </div>`}
          ${others.length > 0 && html`
            <label class="field"><span>Links — these pieces get a weight boost when this piece is active</span>
              <div class="links-list">
                ${others.map(o => html`
                  <label class="check" key=${o.id}>
                    <input type="checkbox" checked=${(piece.links ?? []).includes(o.id)}
                      onChange=${(e) => set({ links: e.target.checked
                        ? [...(piece.links ?? []), o.id]
                        : (piece.links ?? []).filter(id => id !== o.id) })} />
                    ${o.title || '(untitled)'}
                  </label>`)}
              </div></label>`}
        </div>`}
    </div>`;
}

function newScenario() {
  return {
    id: uid(), name: 'New scenario', description: '', tags: [],
    backstory: '', greeting: '', scenarioInstructions: '', lorePieces: [],
    emergentLore: 'queue', // off | queue (review) | auto — model/extractor-proposed lore routing
    createdAt: Date.now(),
  };
}

function ScenarioEditor({ scenario, onSave, onClose }) {
  const [draft, setDraft] = useState(() => deepClone(scenario));
  const set = (patch) => setDraft(d => ({ ...d, ...patch }));
  const setPiece = (id, next) =>
    set({ lorePieces: draft.lorePieces.map(p => p.id === id ? next : p) });
  return html`
    <${Modal} title="Scenario editor" wide onClose=${onClose}
      footer=${html`<button class="btn primary" onClick=${() => onSave(draft)}>Save scenario</button>`}>
      <div class="grid2">
        <label class="field"><span>Name</span>
          <input type="text" value=${draft.name} onInput=${(e) => set({ name: e.target.value })} /></label>
        <label class="field"><span>Tags (comma-separated)</span>
          <${ListInput} delim=',' values=${draft.tags} onChange=${(tags) => set({ tags })} /></label>
      </div>
      <label class="field"><span>Description — <b>metadata, not sent to the AI</b></span>
        <textarea rows=${2} value=${draft.description} onInput=${(e) => set({ description: e.target.value })} /></label>
      <label class="field"><span>Scenario instructions — sent to the AI, ranks above the platform prompt. {{user}} = persona name.</span>
        <textarea rows=${3} value=${draft.scenarioInstructions} onInput=${(e) => set({ scenarioInstructions: e.target.value })} /></label>
      <label class="field"><span>Backstory — sent to the AI (static layer, truncated first under budget pressure)</span>
        <textarea rows=${6} value=${draft.backstory} onInput=${(e) => set({ backstory: e.target.value })} /></label>
      <label class="field"><span>Greeting — first assistant message of every new chat</span>
        <textarea rows=${4} value=${draft.greeting} onInput=${(e) => set({ greeting: e.target.value })} /></label>
      <label class="field"><span>Emergent lore — where model-proposed lore (add_lore calls + periodic extraction) goes</span>
        <select value=${draft.emergentLore ?? 'queue'} onChange=${(e) => set({ emergentLore: e.target.value })}>
          <option value="off">off — no proposals, no extraction</option>
          <option value="queue">suggest for review (default) — proposals wait in chat settings</option>
          <option value="auto">auto-add — proposals go straight into chat lore</option>
        </select></label>
      <div class="field">
        <span>Lore pieces (${draft.lorePieces.length})
          <button class="btn small" style=${{ marginLeft: '8px' }}
            onClick=${() => set({ lorePieces: [...draft.lorePieces, newLorePiece()] })}>+ add piece</button>
        </span>
        ${draft.lorePieces.map(p => html`
          <${LorePieceCard} key=${p.id} piece=${p} allPieces=${draft.lorePieces}
            onChange=${(next) => setPiece(p.id, next)}
            onRemove=${() => set({ lorePieces: draft.lorePieces.filter(q => q.id !== p.id) })} />`)}
      </div>
    <//>`;
}

