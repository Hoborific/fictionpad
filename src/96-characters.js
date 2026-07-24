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

function CharacterEditor({ character, scenarios, chatLinkCount = 0, onUpsert, onClose }) {
  const [editing, setEditing] = useState(() => character ? deepClone(character) : newCharacter());
  const [dirty, setDirty] = useState(false);
  const edit = (next) => { setDirty(true); setEditing(next); };
  const guardClose = () => { if (!dirty || confirm('Discard unsaved changes?')) onClose(); };
  const linkCount = (id) => Object.values(scenarios).filter(s => (s.characterIds ?? []).includes(id)).length;
  const totalLinks = linkCount(editing.id) + chatLinkCount;
  return html`
    <${Modal} title=${character ? `Character — ${character.name}` : 'New character'} wide onClose=${guardClose}>
      <label class="field"><span>Name — speaker name; also the default trigger key</span>
        <input type="text" value=${editing.name} onInput=${(e) => edit({ ...editing, name: e.target.value })} /></label>
      <label class="field"><span>Character card — sent to the AI when active. {{user}} works here.</span>
        <textarea rows=${6} value=${editing.content} onInput=${(e) => edit({ ...editing, content: e.target.value })} /></label>
      <label class="field"><span>Trigger keys — one per line, regex; blank = the character's name</span>
        <${ListInput} textarea=${true} delim=${'\n'} rows=${3} values=${editing.keys}
          onChange=${(keys) => edit({ ...editing, keys })} /></label>
      <label class="field"><span>Greeting — first message of chats started directly with this character</span>
        <textarea rows=${4} value=${editing.greeting ?? ''}
          onInput=${(e) => edit({ ...editing, greeting: e.target.value })} /></label>
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
      ${totalLinks > 0 && html`
        <div class="hint">Linked into ${linkCount(editing.id)} scenario(s) and ${chatLinkCount} chat(s) — card edits apply live. The greeting is snapshotted per chat at creation, so greeting edits only affect new chats.</div>`}
      <div style=${{ display: 'flex', gap: '8px' }}>
        <button class="btn primary" disabled=${!editing.name.trim()}
          onClick=${() => { onUpsert(editing.id, { ...editing, updatedAt: Date.now() }); onClose(); }}>Save</button>
        <button class="btn" onClick=${guardClose}>Cancel</button>
      </div>
    <//>`;
}
