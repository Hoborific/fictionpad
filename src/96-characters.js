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
    pinned: false, weight: 0, smart: false, enabled: true,
    greeting: '', // first assistant message of chats started directly with this character
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

function CharacterEditor({ character, scenarios, onUpsert, onClose }) {
  const [editing, setEditing] = useState(() => character ? deepClone(character) : newCharacter());
  const linkCount = (id) => Object.values(scenarios).filter(s => (s.characterIds ?? []).includes(id)).length;
  return html`
    <${Modal} title=${character ? `Character — ${character.name}` : 'New character'} wide onClose=${onClose}>
      <label class="field"><span>Name — speaker name; also the default trigger key</span>
        <input type="text" value=${editing.name} onInput=${(e) => setEditing({ ...editing, name: e.target.value })} /></label>
      <label class="field"><span>Character card — sent to the AI when active. {{user}} works here.</span>
        <textarea rows=${6} value=${editing.content} onInput=${(e) => setEditing({ ...editing, content: e.target.value })} /></label>
      <label class="field"><span>Trigger keys — one per line, regex; blank = the character's name</span>
        <${ListInput} textarea=${true} delim=${'\n'} rows=${3} values=${editing.keys}
          onChange=${(keys) => setEditing({ ...editing, keys })} /></label>
      <label class="field"><span>Greeting — first message of chats started directly with this character</span>
        <textarea rows=${4} value=${editing.greeting ?? ''}
          onInput=${(e) => setEditing({ ...editing, greeting: e.target.value })} /></label>
      <div class="grid2">
        <label class="field"><span>Weight — higher wins when the lore budget is tight</span>
          <input type="number" value=${editing.weight ?? 0}
            onInput=${(e) => setEditing({ ...editing, weight: Number(e.target.value) })} /></label>
        <div class="field"><span>Activation</span>
          <label class="check" title="Always injected while linked">
            <input type="checkbox" checked=${!!editing.pinned}
              onChange=${(e) => setEditing({ ...editing, pinned: e.target.checked })} /> pinned</label>
          <label class="check" title="Semantic activation — requires an embeddings model in Settings">
            <input type="checkbox" checked=${!!editing.smart}
              onChange=${(e) => setEditing({ ...editing, smart: e.target.checked })} /> smart</label>
          <label class="check">
            <input type="checkbox" checked=${editing.enabled !== false}
              onChange=${(e) => setEditing({ ...editing, enabled: e.target.checked })} /> enabled</label>
        </div>
      </div>
      ${linkCount(editing.id) > 0 && html`
        <div class="hint">Linked into ${linkCount(editing.id)} scenario(s) — edits apply live to their chats.</div>`}
      <div style=${{ display: 'flex', gap: '8px' }}>
        <button class="btn primary" disabled=${!editing.name.trim()}
          onClick=${() => { onUpsert(editing.id, { ...editing, updatedAt: Date.now() }); onClose(); }}>Save</button>
        <button class="btn" onClick=${onClose}>Cancel</button>
      </div>
    <//>`;
}
