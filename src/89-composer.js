const COMPOSER_COMMANDS = [
  ['/ooc', 'speak out of character'],
  ['/continue', 'continue the last reply'],
  ['/pov', 'reply from another character’s view'],
  ['/improve', 'rewrite your draft in persona voice'],
  ['/recap N', 'summarize the last N messages'],
  ['/memory N', 'save a memory from the last N messages'],
  ['/model NAME', 'set this chat’s model'],
  ['/theme NAME', 'switch the UI theme'],
];

function Composer({ generating, busy, onSubmit, onStop, inject, chatId }) {
  const [text, setText] = useState('');
  const [hint, setHint] = useState(null);
  useEffect(() => {
    if (!inject) return;
    // Async injects (e.g. /improve) resolve seconds later; if the user
    // switched chats meanwhile, the text belongs to the other chat.
    if (inject.chatId && chatId && inject.chatId !== chatId) return;
    if ('text' in inject) setText(inject.text ?? '');
    if ('hint' in inject) setHint(inject.hint ?? null);
  }, [inject]);
  const send = () => {
    const t = text.trim();
    if (!t) return;
    const res = onSubmit(t); // returns an error hint string, or null when consumed
    if (res) setHint(res);
    else { setText(''); setHint(null); }
  };
  // Touch devices (coarse pointer) have no Shift on the soft keyboard, so
  // Enter is always a newline there — sending is the Send button's job.
  // Desktop keeps Enter-to-send, Shift+Enter for newline.
  const coarseEnter = window.matchMedia?.('(pointer: coarse)').matches;
  // Slash-command hints: while the first token is a / prefix, offer matching
  // commands (click/tap completes the command word into the draft).
  const cmdHints = text.startsWith('/') && !/[\s]/.test(text)
    ? COMPOSER_COMMANDS.filter(([c]) => c.split(' ')[0].startsWith(text) && c.split(' ')[0] !== text)
    : [];
  // Auto-grow the textarea with the draft, capped (CSS max-height) so long
  // messages scroll internally instead of eating the screen. Resting state
  // (empty draft) is a single line regardless of focus.
  const taRef = useRef(null);
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    if (!text) { ta.style.height = ''; return; }
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [text]);
  return html`
    <div class="composer">
      ${cmdHints.length > 0 && html`
        <div class="cmd-hints">
          ${cmdHints.map(([c, d]) => html`
            <button key=${c} class="cmd-hint"
              onMouseDown=${(e) => { e.preventDefault(); setText(c.split(' ')[0] + (c.includes(' ') ? ' ' : '')); taRef.current?.focus(); }}>
              <span class="cmd">${c}</span><span class="desc">${d}</span>
            </button>`)}
        </div>`}
      <div class="row">
        <textarea ref=${taRef} value=${text} rows=${1}
          placeholder="Type a message or /"
          onInput=${(e) => setText(e.target.value)}
          onKeyDown=${(e) => {
            // While generating/busy, Enter falls through to a newline instead
            // of being swallowed with no effect.
            if (e.key === 'Enter' && !e.shiftKey && !coarseEnter && !generating && !busy) { e.preventDefault(); send(); }
          }} />
        ${generating
          ? html`<button class="btn danger" onClick=${onStop}>■ Stop</button>`
          : html`<button class="btn primary" disabled=${!!busy} onClick=${send}>${busy ? 'Working…' : 'Send'}</button>`}
      </div>
      ${hint && html`<div class="hint warn">${hint}</div>`}
    </div>`;
}

