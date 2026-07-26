// ============================================================================
// ERROR BOUNDARY — a pane/dialog crash shows an inline box instead of React
// unmounting the whole root (which blanked the page before this existed).
// ============================================================================
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('FictionPad render error:', error, info); }
  render() {
    if (this.state.error) return html`
      <div class="errbox">
        <div><b>Render error${this.props.name ? ` — ${this.props.name}` : ''}</b></div>
        <pre>${String(this.state.error?.message ?? this.state.error)}</pre>
        <button class="btn small" onClick=${() => this.setState({ error: null })}>Dismiss</button>
      </div>`;
    return this.props.children;
  }
}

function Markdown({ text, prose = false, streaming = false }) {
  const rendered = useMemo(() => {
    // Live stream: tentatively close unterminated emphasis/dialogue so the
    // partial reply formats as it grows; the final render uses the raw text.
    const t = prose && streaming ? autoCloseProse(text ?? '') : (text ?? '');
    return marked.parse(prose ? wrapDialogue(t, streaming) : t);
  }, [text, prose, streaming]);
  return html`<div class="md" dangerouslySetInnerHTML=${{ __html: rendered }} />`;
}

function Modal({ title, onClose, wide, cls, children, footer }) {
  const dlgRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose; // Escape always calls the latest handler (dirty guards close over live state)
  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    // Initial focus: first field in the body, else the dialog container.
    const target = dlg.querySelector('.m-body input, .m-body textarea, .m-body select, .m-body button') ?? dlg;
    target.focus?.();
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Only the topmost overlay reacts — one Escape must not close a stacked
      // modal AND the dialog beneath it (e.g. the ✦ generator over an editor).
      const overlays = document.querySelectorAll('.modal-overlay');
      if (overlays.length && overlays[overlays.length - 1] !== dlg.closest('.modal-overlay')) return;
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return html`
    <div class="modal-overlay" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal ${wide ? 'wide' : ''} ${cls ?? ''}" role="dialog" aria-modal="true" aria-label=${title}
        tabindex="-1" ref=${dlgRef}>
        <div class="m-head">
          <h2>${title}</h2>
          <button class="btn ghost" onClick=${onClose} aria-label="Close">✕</button>
        </div>
        <div class="m-body">${children}</div>
        ${footer && html`<div class="m-foot">${footer}</div>`}
      </div>
    </div>`;
}

// Scrollable box with the native scrollbar hidden and extent cues instead: a
// thin accent rail tracking scroll position plus a bottom fade while more
// content remains below (see .rail-* in styles.css). Shared by the thinking
// box and the lore links lists so they all scroll the same way. The scroll
// handler writes CSS vars only — no re-render per scroll event.
function RailScroll({ className, children }) {
  const wrapRef = useRef(null);
  const sync = () => {
    const wrap = wrapRef.current;
    const el = wrap?.firstElementChild;
    if (!el) return;
    const scrollable = el.scrollHeight > el.clientHeight + 2;
    wrap.dataset.scrollable = scrollable ? '1' : '';
    wrap.dataset.atBottom = (!scrollable || el.scrollTop + el.clientHeight >= el.scrollHeight - 2) ? '1' : '';
    if (scrollable) {
      wrap.style.setProperty('--th-frac', el.clientHeight / el.scrollHeight);
      wrap.style.setProperty('--th-off', el.scrollTop / el.scrollHeight);
    }
  };
  useEffect(sync); // every render — cheap DOM reads, covers content/resize changes
  return html`<div class="rail-wrap" ref=${wrapRef}>
    <div class=${`rail-body ${className ?? ''}`} onScroll=${sync}>${children}</div>
    <div class="rail"><div class="rail-thumb" /></div>
  </div>`;
}

// Number input that allows free typing and commits a clamped value on
// blur/Enter — clamping on every keystroke fights mid-edit input (typing "3"
// into a min-5 field would snap to 5 before the "0" for "30" arrives).
// While focused, the text is authoritative; unfocused, it follows the prop.
function NumInput({ value, min, max, step, fallback, placeholder, onCommit }) {
  const [text, setText] = useState(String(value ?? ''));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(String(value ?? '')); }, [value, focused]);
  const commit = () => {
    const raw = text.trim();
    let n = raw === '' ? NaN : Number(raw);
    // fallback: null = the field is nullable and blank/invalid commits null;
    // undefined = keep the last good value.
    if (!Number.isFinite(n)) n = fallback === null ? null : (fallback ?? value ?? 0);
    if (n != null) {
      if (min != null) n = Math.max(min, n);
      if (max != null) n = Math.min(max, n);
    }
    if (n !== value) onCommit(n);
    setText(String(n ?? ''));
  };
  return html`<input type="number" min=${min} max=${max} step=${step} placeholder=${placeholder} value=${text}
    onFocus=${() => setFocused(true)}
    onInput=${(e) => setText(e.target.value)}
    onBlur=${() => { setFocused(false); commit(); }}
    onKeyDown=${(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />`;
}

