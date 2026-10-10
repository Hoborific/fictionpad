// ============================================================================
// COMPONENTS: CHARACTER EDITOR — global reusable character cards. A character
// resolves to a character-type lore piece wherever it's linked (scenarios via
// scenario.characterIds, chats via chat.characterIds) and flows through the
// normal lore pipeline — edits to the card apply live everywhere it's linked.
// The sidebar's ＋ / ✎ open this editor directly; Save upserts and closes.
// ============================================================================
function newCharacter() {
  return {
    id: uid(), name: '', content: '', keys: [],
    pinned: true, weight: 0, smart: false, enabled: true,
    color: '', // speaker-name colour override (hex); '' = auto (hashed from the name)
    greeting: '', // first assistant message of chats started directly with this character
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

function CharacterEditor({ character, scenarios, chatLinkCount = 0, settings = null, onUpsert, onClose, onGenerate, onGenerateAvatar = null }) {
  const [editing, setEditing] = useState(() => character ? normalizeCharacter(deepClone(character)) : newCharacter());
  const [dirty, setDirty] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState(null);
  const edit = (next) => { setDirty(true); setEditing(next); };
  const guardClose = async () => { if (!dirty || await uiConfirm('Discard unsaved changes?', { danger: true, okLabel: 'Discard' })) onClose(); };
  const runGenerate = async (promptText) => {
    setGenBusy(true); setGenError(null);
    try {
      const patch = await onGenerate('character', promptText, editing);
      edit({ ...editing, ...patch });
      setGenOpen(false);
    } catch (e) { setGenError(e?.message ?? String(e)); }
    finally { setGenBusy(false); }
  };
  const linkCount = (id) => Object.values(scenarios).filter(s => (s.characterIds ?? []).includes(id)).length;
  const totalLinks = linkCount(editing.id) + chatLinkCount;
  return html`
    <${Modal} title=${character ? `Character — ${character.name}` : 'New character'} wide
      onClose=${genOpen ? () => setGenOpen(false) : guardClose}
      footer=${html`${onGenerate && html`<button class="btn" onClick=${() => { setGenError(null); setGenOpen(true); }}>✦ Generate</button>`}
        <button class="btn primary" disabled=${!editing.name.trim()}
          onClick=${() => { onUpsert(editing.id, { ...editing, alternateGreetings: (editing.alternateGreetings ?? []).filter(g => g.trim()), updatedAt: Date.now() }); onClose(); }}>Save character</button>`}>
      <label class="field"><span>Name — speaker name; also the default trigger key</span>
        <input type="text" value=${editing.name} onInput=${(e) => edit({ ...editing, name: e.target.value })} /></label>
      <div class="field"><span>Name colour — for the speaker name in chats; empty = auto (hashed from the name)</span>
        <div style=${{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input type="color" value=${editing.color || '#8ab4f8'}
            onInput=${(e) => edit({ ...editing, color: e.target.value })}
            style=${{ width: '40px', height: '28px', padding: '0 2px' }} />
          ${editing.color
            ? html`<button class="btn small" onClick=${() => edit({ ...editing, color: '' })}>Clear — back to auto</button>`
            : html`<span class="hint">auto — pick a colour to override</span>`}
        </div>
      </div>
      <${AvatarField} draft=${editing} set=${(patch) => edit({ ...editing, ...patch })} onGenerateAvatar=${onGenerateAvatar} />
      <label class="field"><span>Character card — sent to the AI when active. {{user}} works here.</span>
        <textarea rows=${6} value=${editing.content} onInput=${(e) => edit({ ...editing, content: e.target.value })} /></label>
      <label class="field"><span>Trigger keys — one per line, regex; blank = the character's name</span>
        <${ListInput} textarea=${true} delim=${'\n'} rows=${3} values=${editing.keys}
          onChange=${(keys) => edit({ ...editing, keys })} /></label>
      <label class="field"><span>Greeting — first message of chats started directly with this character. Prefix lines with a character's name (Mia:) to show them as that character's bubble; Narrator: resumes narration.</span>
        <textarea rows=${4} value=${editing.greeting ?? ''}
          onInput=${(e) => edit({ ...editing, greeting: e.target.value })} /></label>
      <${AlternateGreetingsFields} draft=${editing} forCharacter=${true}
        set=${(patch) => edit({ ...editing, ...patch })} />
      <div class="grid2">
        <label class="field"><span>Weight — higher wins when the lore budget is tight</span>
          <${NumInput} value=${editing.weight ?? 0} step=${1} fallback=${0}
            onCommit=${(n) => edit({ ...editing, weight: n })} /></label>
        <div class="field"><span>Activation</span>
          <label class="check" title="Always injected while linked">
            <input type="checkbox" checked=${!!editing.pinned}
              onChange=${(e) => edit({ ...editing, pinned: e.target.checked })} /> pinned</label>
          <label class="check" title="Semantic activation — the embedding model (Settings → Models) injects this card when similar to the recent conversation; no keyword needed">
            <input type="checkbox" checked=${!!editing.smart}
              onChange=${(e) => edit({ ...editing, smart: e.target.checked })} /> semantic</label>
          <label class="check">
            <input type="checkbox" checked=${editing.enabled !== false}
              onChange=${(e) => edit({ ...editing, enabled: e.target.checked })} /> enabled</label>
        </div>
      </div>
      <${GenerationDefaultsFields} draft=${editing} settings=${settings}
        set=${(patch) => edit({ ...editing, ...patch })} />
      ${totalLinks > 0 && html`
        <div class="hint">Linked into ${linkCount(editing.id)} scenario(s) and ${chatLinkCount} chat(s) — card edits apply live. The greeting is snapshotted per chat at creation, so greeting edits only affect new chats.</div>`}
      ${genOpen && html`
        <${GeneratorModal} title="Generate character" busy=${genBusy} error=${genError}
          onGenerate=${runGenerate} onClose=${() => setGenOpen(false)} />`}
    <//>`;
}
