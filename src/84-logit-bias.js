// ============================================================================
// COMPONENTS: LOGIT BIAS EDITOR — { [inputString]: { ids, strings, power } }.
// Literal strings are tokenized via /tokenize ("!==" + s, prefix tokens sliced
// off to dodge the leading-space artifact); raw "/id,id/" syntax always works.
// ============================================================================
// Hoisted out of LogitBiasModal: defined inline it was a new component type
// every render, remounting every row on each keystroke.
function LogitBiasRow({ k, e, onRemove }) {
  return html`
    <div class="kv">
      <span class="k" style=${{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '55%' }}
        title=${(e.strings ?? []).join('')}>${k} <span class="hint">[${(e.ids ?? []).join(',')}]</span></span>
      <span>${e.power > 0 ? '+' : ''}${e.power}
        <button class="btn small ghost" style=${{ marginLeft: '6px' }} aria-label="Remove entry"
          onClick=${() => onRemove(k)}>✕</button></span>
    </div>`;
}

function LogitBiasModal({ logitBias, onChange, onTokenize, onClose }) {
  const [text, setText] = useState('');
  const [power, setPower] = useState(-10);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState(null);
  const entries = Object.entries(logitBias ?? {});
  const remove = (key) => onChange(Object.fromEntries(entries.filter(([k]) => k !== key)));

  const add = async () => {
    const s = text.trim();
    if (!s) return;
    setBusy(true); setHint(null);
    try {
      let ids = null, strings = null;
      const raw = /^\/([\d,\s]+)\/$/.exec(s);
      if (raw) {
        ids = raw[1].split(',').map(x => parseInt(x.trim(), 10)).filter(Number.isFinite);
        strings = ids.map(String);
      } else {
        const full = await onTokenize(`!==${s}`);
        const pre = await onTokenize('!==');
        // Both calls must succeed: without the "!=="-only baseline we can't
        // tell where the prefix ends, so bias would land on the wrong token.
        if (full?.ids && pre?.ids) {
          ids = full.ids.slice(pre.ids.length);
          strings = full.strings ? full.strings.slice((full.strings.length ?? 0) - ids.length) : ids.map(String);
        }
        if (!ids?.length) {
          setHint('Tokenizer endpoint unavailable for literal strings — use raw /id,id/ syntax (e.g. /123,456/).');
          return;
        }
      }
      const p = Math.max(-100, Math.min(100, Number(power) || 0));
      if (p === 0) remove(s); // power 0 deletes
      else onChange({ ...(logitBias ?? {}), [s]: { ids, strings, power: p } });
      setText('');
    } finally { setBusy(false); }
  };

  const pos = entries.filter(([, e]) => e.power > 0).sort((a, b) => b[1].power - a[1].power);
  const neg = entries.filter(([, e]) => e.power < 0).sort((a, b) => a[1].power - b[1].power);

  return html`
    <${Modal} title="Logit bias" onClose=${onClose}>
      <div class="hint" style=${{ marginBottom: '8px' }}>
        Applied to every generation as OpenAI logit_bias (first token of each entry). −100…100; 0 deletes.
      </div>
      <div style=${{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' }}>
        <input type="text" style=${{ flex: 1 }} placeholder='Literal string, or /id,id/' value=${text}
          onInput=${(e) => setText(e.target.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter' && !busy) add(); }} />
        <input type="number" style=${{ width: '80px' }} min="-100" max="100" value=${power}
          onInput=${(e) => setPower(Number(e.target.value))} title="Bias −100…100" />
        <button class="btn primary" disabled=${busy || !text.trim()} onClick=${add}>${busy ? '…' : 'Add'}</button>
      </div>
      ${hint && html`<div class="hint warn">${hint}</div>`}
      ${entries.length === 0 && html`<div class="hint">No entries.</div>`}
      ${pos.length > 0 && html`<h4>Encouraged</h4>${pos.map(([k, e]) => html`<${LogitBiasRow} key=${k} k=${k} e=${e} onRemove=${remove} />`)}`}
      ${neg.length > 0 && html`<h4>Discouraged</h4>${neg.map(([k, e]) => html`<${LogitBiasRow} key=${k} k=${k} e=${e} onRemove=${remove} />`)}`}
    <//>`;
}

