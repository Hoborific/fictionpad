// ============================================================================
// COMPONENTS: SCENARIO EDITOR — full CRUD incl. lore piece editor.
// ============================================================================
function newLorePiece() {
  return {
    id: uid(), type: 'lore', title: '', content: '', keys: [],
    pinned: false, weight: 0, links: [], enabled: true, searchDepth: null,
    wholeWord: false, caseSensitive: false, // trigger key matching options
    smart: false, // semantic (embedding) activation — needs settings.embeddingModel
  };
}

// Quick-add skeletons: name + one-line hook + focused fields, filled in by hand.
// Keys stay empty — note that unlike global character cards (resolveCharacters
// defaults empty keys to the card name), lore pieces have no title-as-key
// fallback in scanLore, so a character piece needs a key or pinned to fire.
const LORE_TEMPLATES = [
  { label: 'character', type: 'character',
    content: 'Name — one-line hook.\nAppearance: \nPersonality: \nMotive: ' },
  { label: 'location', type: 'lore',
    content: 'Location — one-line hook.\nDetails: ' },
  { label: 'faction', type: 'lore',
    content: 'Faction — one-line hook.\nGoal: \nMembers: ' },
  { label: 'item', type: 'lore',
    content: 'Item — one-line hook.\nProperties: ' },
];
const newLoreFromTemplate = (t) => ({ ...newLorePiece(), type: t.type, content: t.content });

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
          <label class="check" title="The embedding model (Settings → Models) compares this piece against the recent conversation each generation and injects it on similarity, even without a keyword hit">
            <input type="checkbox" checked=${!!piece.smart} onChange=${(e) => set({ smart: e.target.checked })} />
            Semantic activation — uses the embedding model (aux); no keyword needed
          </label>
          <div class="grid3">
            <label class="field"><span>Weight</span>
              <${NumInput} value=${piece.weight ?? 0} step=${1} fallback=${0}
                onCommit=${(n) => set({ weight: n })} /></label>
            <label class="field"><span>Search depth (est. tokens; blank = global default)</span>
              <${NumInput} value=${piece.searchDepth} min=${0} step=${128} fallback=${null} placeholder="2048"
                onCommit=${(n) => set({ searchDepth: n })} /></label>
            <div class="field"><span>Flags</span>
              <label class="check"><input type="checkbox" checked=${!!piece.pinned} onChange=${(e) => set({ pinned: e.target.checked })} /> pinned</label>
              <label class="check"><input type="checkbox" checked=${piece.enabled !== false} onChange=${(e) => set({ enabled: e.target.checked })} /> enabled</label>
            </div>
          </div>
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

function ScenarioEditor({ scenario, characters = {}, onSave, onClose, onGenerate }) {
  const [draft, setDraft] = useState(() => deepClone(scenario));
  const [dirty, setDirty] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState(null);
  const set = (patch) => { setDirty(true); setDraft(d => ({ ...d, ...patch })); };
  const guardClose = () => { if (!dirty || confirm('Discard unsaved changes?')) onClose(); };
  const runGenerate = async (promptText) => {
    setGenBusy(true); setGenError(null);
    try {
      set(await onGenerate('scenario', promptText, draft));
      setGenOpen(false);
    } catch (e) { setGenError(e?.message ?? String(e)); }
    finally { setGenBusy(false); }
  };
  const setPiece = (id, next) =>
    set({ lorePieces: draft.lorePieces.map(p => p.id === id ? next : p) });
  const charList = Object.values(characters).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  const linkedIds = Array.isArray(draft.characterIds) ? draft.characterIds : [];
  const toggleChar = (id, on) =>
    set({ characterIds: on ? [...linkedIds, id] : linkedIds.filter(x => x !== id) });
  return html`
    <${Modal} title="Scenario editor" wide onClose=${genOpen ? () => setGenOpen(false) : guardClose}
      footer=${html`${onGenerate && html`<button class="btn" onClick=${() => { setGenError(null); setGenOpen(true); }}>✦ Generate</button>`}
        <button class="btn primary" onClick=${() => onSave(draft)}>Save scenario</button>`}>
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
      <label class="field"><span>Greeting — first assistant message of every new chat. Prefix lines with a character's name (Mia:) to show them as that character's bubble; Narrator: resumes narration.</span>
        <textarea rows=${4} value=${draft.greeting} onInput=${(e) => set({ greeting: e.target.value })} /></label>
      <label class="field"><span>Emergent lore — where model-proposed lore (add_lore calls + periodic extraction) goes</span>
        <select value=${draft.emergentLore ?? 'queue'} onChange=${(e) => set({ emergentLore: e.target.value })}>
          <option value="off">off — no proposals, no extraction</option>
          <option value="queue">suggest for review (default) — proposals wait in chat settings</option>
          <option value="auto">auto-add — proposals go straight into chat lore</option>
        </select></label>
      <div class="field">
        <span>Linked characters (${linkedIds.length})</span>
        <div class="hint">Global character cards join this scenario's lore pipeline (activation, budgets, /pov, speaker colours). Card content edits apply live to all linked scenarios and chats — but the opening greeting is snapshotted per chat at creation, so greeting edits only affect new chats. For scenario-only characters, use a character-type lore piece below.</div>
        ${charList.length === 0 && html`<div class="hint">No global characters yet — create them from the sidebar's Characters section.</div>`}
        ${charList.length > 0 && html`
          <div class="links-list">
            ${charList.map(c => html`
              <label class="check" key=${c.id}>
                <input type="checkbox" checked=${linkedIds.includes(c.id)}
                  onChange=${(e) => toggleChar(c.id, e.target.checked)} />
                ${c.name}
              </label>`)}
          </div>`}
      </div>
      <div class="field">
        <span>Lore pieces (${draft.lorePieces.length})
          <button class="btn small" style=${{ marginLeft: '8px' }}
            onClick=${() => set({ lorePieces: [...draft.lorePieces, newLorePiece()] })}>+ add piece</button>
          ${LORE_TEMPLATES.map(t => html`
            <button class="btn small" key=${t.label} style=${{ marginLeft: '4px' }}
              title=${`New ${t.label} piece, prefilled with a skeleton`}
              onClick=${() => set({ lorePieces: [...draft.lorePieces, newLoreFromTemplate(t)] })}>+ ${t.label}</button>`)}
        </span>
        ${draft.lorePieces.map(p => html`
          <${LorePieceCard} key=${p.id} piece=${p} allPieces=${draft.lorePieces}
            onChange=${(next) => setPiece(p.id, next)}
            onRemove=${() => set({ lorePieces: draft.lorePieces.filter(q => q.id !== p.id) })} />`)}
      </div>
      ${genOpen && html`
        <${GeneratorModal} title="Generate scenario" busy=${genBusy} error=${genError}
          onGenerate=${runGenerate} onClose=${() => setGenOpen(false)} />`}
    <//>`;
}

