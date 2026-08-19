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

// The editable fields of a lore piece — shared by the inline card (scenario
// editor) and the piece editor popout (chat options), so the two stay
// identical. `set` applies a partial patch to the caller's piece/draft.
// Character-type pieces get the avatar field (a registered character is a
// chat-local character card); onGenerateAvatar comes from Main like the
// global editors (image generation off → no ✦ button).
function LorePieceFields({ piece, others, set, onGenerateAvatar = null }) {
  return html`
    <div class="grid2">
      <label class="field"><span>Title</span>
        <input type="text" value=${piece.title} onInput=${(e) => set({ title: e.target.value })} /></label>
      <label class="field"><span>Type</span>
        <select value=${piece.type} onChange=${(e) => set({ type: e.target.value })}>
          <option value="lore">lore</option>
          <option value="character">character</option>
        </select></label>
    </div>
    ${piece.type === 'character' && html`
      <${AvatarField} draft=${piece} set=${set} onGenerateAvatar=${onGenerateAvatar} />`}
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
    <div class="grid3">
      <label class="field" title="Stay active this many messages after the key last matched (measured in path messages; rewind-safe)"><span>Sticky (msgs; blank = off)</span>
        <${NumInput} value=${piece.sticky} min=${0} step=${1} fallback=${null} placeholder="off"
          onCommit=${(n) => set({ sticky: n ?? undefined })} /></label>
      <label class="field" title="After going inactive, the piece can't re-activate for this many messages"><span>Cooldown (msgs; blank = off)</span>
        <${NumInput} value=${piece.cooldown} min=${0} step=${1} fallback=${null} placeholder="off"
          onCommit=${(n) => set({ cooldown: n ?? undefined })} /></label>
      <label class="field" title="The piece can't activate before this position in the chat (1-based message count)"><span>Delay (msgs; blank = off)</span>
        <${NumInput} value=${piece.delay} min=${0} step=${1} fallback=${null} placeholder="off"
          onCommit=${(n) => set({ delay: n ?? undefined })} /></label>
    </div>
    <div class="grid2">
      <label class="field" title="Pieces sharing a group name are mutually exclusive — the highest weight wins (random events, fallback chains)"><span>Inclusion group (blank = none)</span>
        <input type="text" value=${piece.group ?? ''} placeholder="e.g. random-event"
          onInput=${(e) => set({ group: e.target.value.trim() || undefined })} /></label>
      <label class="field" title="Percent chance a keyword activation fires each generation (pinned/semantic always fire)"><span>Probability (%; blank = 100)</span>
        <${NumInput} value=${piece.prob} min=${0} max=${100} step=${5} fallback=${null} placeholder="100"
          onCommit=${(n) => set({ prob: n ?? undefined })} /></label>
    </div>
    ${others.length > 0 && html`
      <label class="field"><span>Links — these pieces get a weight boost when this piece is active</span>
        <${RailScroll} className="links-list">
          ${others.map(o => html`
            <label class="check" key=${o.id}>
              <input type="checkbox" checked=${(piece.links ?? []).includes(o.id)}
                onChange=${(e) => set({ links: e.target.checked
                  ? [...(piece.links ?? []), o.id]
                  : (piece.links ?? []).filter(id => id !== o.id) })} />
              ${o.title || '(untitled)'}
            </label>`)}
        <//></label>`}`;
}

function LorePieceCard({ piece, allPieces, onChange, onRemove, onGenerate, onGenerateAvatar = null, onExportPiece = null }) {
  const [open, setOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState(null);
  const set = (patch) => onChange({ ...piece, ...patch });
  const runGenerate = async (promptText) => {
    setGenBusy(true); setGenError(null);
    try {
      // The patch carries content fields only — id and provenance survive.
      set(await onGenerate('piece', promptText, piece));
      setGenOpen(false);
    } catch (e) { setGenError(e?.message ?? String(e)); }
    finally { setGenBusy(false); }
  };
  const others = allPieces.filter(p => p.id !== piece.id);
  return html`
    <div class="lore-card">
      <div class="lc-head" onClick=${() => setOpen(!open)}>
        <span>${open ? '▾' : '▸'}</span>
        <span class="t">${piece.title || '(untitled)'}</span>
        ${piece.type === 'character' && html`<span class="pill">character</span>`}
        ${piece.pinned && html`<span class="pill pinned">pinned</span>`}
        ${piece.enabled === false && html`<span class="pill">disabled</span>`}
        ${onGenerate && html`<button class="btn small" title="Generate / flesh out this piece with the AI"
          onClick=${(e) => { e.stopPropagation(); setGenError(null); setGenOpen(true); }}>✦</button>`}
        ${piece.type === 'character' && onExportPiece && html`
          <button class="btn small" title="Export as a global character — appears in the sidebar's Characters section"
            onClick=${(e) => { e.stopPropagation(); onExportPiece(piece); }}>⇪${'\uFE0E'}</button>`}
        <button class="btn small danger" onClick=${(e) => { e.stopPropagation(); onRemove(); }}>✕</button>
      </div>
      ${genOpen && html`
        <${GeneratorModal} title=${`Generate — ${piece.title || 'lore piece'}`} busy=${genBusy} error=${genError}
          onGenerate=${runGenerate} onClose=${() => setGenOpen(false)} />`}
      ${open && html`
        <div class="lc-body"><${LorePieceFields} piece=${piece} others=${others} set=${set} onGenerateAvatar=${onGenerateAvatar} /></div>`}
    </div>`;
}

// One past version of a tool-updated piece (update_character): collapsed to a
// stamped one-liner, expands to that version's full card text + keys.
function RevisionRow({ rev, n }) {
  const [open, setOpen] = useState(false);
  const stamp = rev.createdAt ? new Date(rev.createdAt).toLocaleString() : 'original';
  return html`
    <div class="lore-item-row">
      <div class="row" style=${{ cursor: 'pointer' }} onClick=${() => setOpen(!open)}>
        <span class="hint">${open ? '▾' : '▸'}</span>
        <span style=${{ flex: 1 }}>rev ${n}</span>
        <span class="hint">${rev.atLen != null ? `msg ${rev.atLen} · ` : ''}${stamp}</span>
      </div>
      ${!open && html`<div class="ir-preview">${toPreview(rev.content, 140)}</div>`}
      ${open && html`<div class="ir-content">${rev.content}${(rev.keys ?? []).length ? `\n\n[keys] ${rev.keys.join(', ')}` : ''}</div>`}
    </div>`;
}

// Lore piece editor popout (chat options) — the same pattern as the
// scenario/character editors: a wide modal with every field visible (links
// included), ✦ Generate + Save in the footer, local draft, dirty guard. The
// piece is never a blind ✦ prompt — you see what it is before you edit or
// generate. The generator's patch fills the local draft only; persistence
// stays with Save, and id/provenance (createdBy/atLen) survive untouched.
function LorePieceEditor({ piece, isNew, allPieces, onSave, onClose, onGenerate, onGenerateAvatar = null }) {
  const [draft, setDraft] = useState(() => normalizeLorePiece(deepClone(piece)));
  const [dirty, setDirty] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState(null);
  const set = (patch) => { setDirty(true); setDraft(d => ({ ...d, ...patch })); };
  const guardClose = () => { if (!dirty || confirm('Discard unsaved changes?')) onClose(); };
  const runGenerate = async (promptText) => {
    setGenBusy(true); setGenError(null);
    try {
      set(await onGenerate('piece', promptText, draft));
      setGenOpen(false);
    } catch (e) { setGenError(e?.message ?? String(e)); }
    finally { setGenBusy(false); }
  };
  const others = allPieces.filter(p => p.id !== draft.id);
  return html`
    <${Modal} title=${isNew ? 'New lore piece' : `Lore — ${piece.title || '(untitled)'}`} wide
      onClose=${genOpen ? () => setGenOpen(false) : guardClose}
      footer=${html`${onGenerate && html`<button class="btn" onClick=${() => { setGenError(null); setGenOpen(true); }}>✦ Generate</button>`}
        <button class="btn primary" disabled=${!draft.title.trim()} onClick=${() => onSave(draft)}>Save</button>`}>
      <${LorePieceFields} piece=${draft} others=${others} set=${set} onGenerateAvatar=${onGenerateAvatar} />
      ${(piece.revisions ?? []).length > 0 && html`
        <div class="field">
          <span>Change history (${piece.revisions.length})</span>
          <div class="hint">Versions written by tool calls or enrichment, newest first — rev 1 is the pre-tool original. Rewinding the chat past a version restores the earlier text.</div>
          ${[...piece.revisions].reverse().map((r, i) => html`
            <${RevisionRow} key=${i} rev=${r} n=${piece.revisions.length - i} />`)}
        </div>`}
      ${genOpen && html`
        <${GeneratorModal} title=${`Generate — ${draft.title || 'lore piece'}`} busy=${genBusy} error=${genError}
          onGenerate=${runGenerate} onClose=${() => setGenOpen(false)} />`}
    <//>`;
}

// Alternate greetings — extra first messages offered as greeting swipes on
// the root node of new chats (the greeting field above is always swipe 1).
// Shared by the scenario and character editors (the LorePieceFields pattern).
// Entries are multi-line prose, so the editor is a stack of textareas, not a
// one-per-line ListInput; blank entries are filtered out by the caller's Save.
function AlternateGreetingsFields({ draft, set, forCharacter = false }) {
  const alts = draft.alternateGreetings ?? [];
  return html`
    <div class="field">
      <span>Alternate greetings (${alts.length})
        <button class="btn small" style=${{ marginLeft: '8px' }}
          onClick=${() => set({ alternateGreetings: [...alts, ''] })}>+ add alternate</button></span>
      <div class="hint">${forCharacter
        ? 'Extra first messages for new direct chats — swipe through them on the greeting. A scenario this character is linked into uses the scenario’s own greetings (the scenario takes precedence). Blank alternates are dropped at save.'
        : 'Extra first messages — new chats swipe through them on the greeting. Blank alternates are dropped at save.'}</div>
      ${alts.map((g, i) => html`
        <div key=${i} style=${{ display: 'flex', gap: '6px', alignItems: 'flex-start', marginTop: '4px' }}>
          <textarea rows=${3} style=${{ flex: 1 }} value=${g}
            placeholder=${`Alternate greeting #${i + 1}`}
            onInput=${(e) => set({ alternateGreetings: alts.map((x, j) => j === i ? e.target.value : x) })} />
          <button class="btn small danger" title="Remove this alternate greeting"
            onClick=${() => set({ alternateGreetings: alts.filter((_, j) => j !== i) })}>✕</button>
        </div>`)}
    </div>`;
}

// Generation defaults for new chats — shared by the scenario editor and the
// character editor (direct character chats), so the two surfaces can't drift
// (the LorePieceFields pattern). The values are snapshotted into each new
// chat's own overrides at creation (newChat); `set` applies a partial patch
// to the caller's draft.
function GenerationDefaultsFields({ draft, settings, set }) {
  return html`
    <div class="field">
      <span>Defaults for new chats</span>
      <div class="hint">Snapshotted into each new chat's own overrides at creation (like the greeting) — editing these later doesn't change existing chats.</div>
      <label class="field"><span>Model — new chats start with this model override; blank = the global chat model</span>
        <input type="text" value=${draft.model ?? ''} placeholder="(global)"
          onInput=${(e) => set({ model: e.target.value.trim() || undefined })} /></label>
      ${settings && html`
        <div class="hint">Samplers — checked knobs seed the new chat's per-chat overrides (drawer/panel → Samplers).</div>
        ${allSamplerFields(settings).map(f => {
          const sv = draft.samplers ?? {};
          const on = sv[f.key] != null;
          const globalSent = enabledSamplers(settings)[f.key];
          return html`
            <div class="sampler-row" key=${f.key}>
              <label class="check">
                <input type="checkbox" checked=${on}
                  onChange=${(e) => {
                    const samplers = { ...sv };
                    if (e.target.checked) samplers[f.key] = settings.samplers?.[f.key] ?? f.def;
                    else delete samplers[f.key];
                    set({ samplers });
                  }} />
                ${f.label}${f.custom ? ' ✦' : ''}</label>
              <span class="sval">
                ${on
                  ? samplerValueCtl(f, sv[f.key], (v) => set({ samplers: { ...sv, [f.key]: v } }))
                  : html`<span class="hint">${globalSent != null ? `global: ${globalSent}` : 'backend default'}</span>`}
              </span>
            </div>`;
        })}`}
    </div>`;
}

function newScenario() {
  return {
    id: uid(), name: '', description: '', tags: [],
    backstory: '', greeting: '', scenarioInstructions: '', lorePieces: [],
    emergentLore: 'queue', // off | queue (review) | auto — model/extractor-proposed lore routing
    createdAt: Date.now(),
  };
}

function ScenarioEditor({ scenario, characters = {}, settings = null, onSave, onClose, onGenerate, onGenerateAvatar = null, onExportPiece = null }) {
  // normalizeScenario: imports upsert JSON verbatim — heal missing fields
  // (lorePieces etc.) here too, or the draft reads below crash on open.
  const [draft, setDraft] = useState(() => normalizeScenario(deepClone(scenario)));
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
        <button class="btn primary" disabled=${!draft.name.trim()}
          onClick=${() => onSave({ ...draft, alternateGreetings: (draft.alternateGreetings ?? []).filter(g => g.trim()) })}>Save scenario</button>`}>
      <div class="grid2">
        <label class="field"><span>Name</span>
          <input type="text" value=${draft.name} onInput=${(e) => set({ name: e.target.value })} /></label>
        <label class="field"><span>Tags (comma-separated)</span>
          <${ListInput} delim=',' values=${draft.tags} onChange=${(tags) => set({ tags })} /></label>
      </div>
      <${AvatarField} draft=${draft} set=${set} onGenerateAvatar=${onGenerateAvatar} />
      <label class="field"><span>Description — <b>metadata, not sent to the AI</b></span>
        <textarea rows=${2} value=${draft.description} onInput=${(e) => set({ description: e.target.value })} /></label>
      <label class="field"><span>Scenario instructions — sent to the AI, ranks above the platform prompt. {{user}} = persona name.</span>
        <textarea rows=${3} value=${draft.scenarioInstructions} onInput=${(e) => set({ scenarioInstructions: e.target.value })} /></label>
      <label class="field"><span>Backstory — sent to the AI (static layer, truncated first under budget pressure)</span>
        <textarea rows=${6} value=${draft.backstory} onInput=${(e) => set({ backstory: e.target.value })} /></label>
      <label class="field"><span>Greeting — first assistant message of every new chat. Prefix lines with a character's name (Mia:) to show them as that character's bubble; Narrator: resumes narration.</span>
        <textarea rows=${4} value=${draft.greeting} onInput=${(e) => set({ greeting: e.target.value })} /></label>
      <${AlternateGreetingsFields} draft=${draft} set=${set} />
      <label class="field"><span>Emergent lore — where model-proposed lore (add_lore calls + periodic extraction) goes</span>
        <select value=${draft.emergentLore ?? 'queue'} onChange=${(e) => set({ emergentLore: e.target.value })}>
          <option value="off">off — no proposals, no extraction</option>
          <option value="queue">suggest for review (default) — proposals wait in chat settings</option>
          <option value="auto">auto-add — proposals go straight into chat lore</option>
        </select></label>
      <${GenerationDefaultsFields} draft=${draft} settings=${settings} set=${set} />
      <div class="field">
        <span>Linked characters (${linkedIds.length})</span>
        <div class="hint">Global character cards join this scenario's lore pipeline (activation, budgets, /pov, speaker colours). Card content edits apply live to all linked scenarios and chats — but the opening greeting is snapshotted per chat at creation, so greeting edits only affect new chats. For scenario-only characters, use a character-type lore piece below.</div>
        ${charList.length === 0 && html`<div class="hint">No global characters yet — create them from the sidebar's Characters section.</div>`}
        ${charList.length > 0 && html`
          <${RailScroll} className="links-list">
            ${charList.map(c => html`
              <label class="check" key=${c.id}>
                <input type="checkbox" checked=${linkedIds.includes(c.id)}
                  onChange=${(e) => toggleChar(c.id, e.target.checked)} />
                ${c.name}
              </label>`)}
          <//>`}
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
            onRemove=${() => set({ lorePieces: draft.lorePieces.filter(q => q.id !== p.id) })}
            onGenerate=${onGenerate} onGenerateAvatar=${onGenerateAvatar} onExportPiece=${onExportPiece} />`)}
      </div>
      ${genOpen && html`
        <${GeneratorModal} title="Generate scenario" busy=${genBusy} error=${genError}
          onGenerate=${runGenerate} onClose=${() => setGenOpen(false)} />`}
    <//>`;
}

