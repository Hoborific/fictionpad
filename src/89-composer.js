const COMPOSER_COMMANDS = [
  ['/ooc [TEXT]', 'speak out of character'],
  ['/continue', 'continue the last reply'],
  ['/pov CHAR [TEXT]', 'reply from another character’s view'],
  ['/improve [TEXT]', 'rewrite your draft in persona voice'],
  ['/impersonate', 'draft your next message as you'],
  ['/image [PROMPT]', 'generate an image into the chat'],
  ['/recap [N]', 'summarize the last N messages'],
  ['/memory [N]', 'save a memory from the last N messages'],
  ['/model [NAME]', 'set this chat’s model'],
  ['/theme [NAME]', 'switch the UI theme'],
];

function Composer({ generating, busy, onSubmit, onStop, inject, chatId, initialText, onDraft, cmdArgs = null }) {
  // Draft text seeds from ChatPane's per-chat drafts store (this component
  // remounts per chat via key=chat.id) and every edit is reported back through
  // onDraft, so an unsent draft survives chat switches within the session.
  const [text, setTextRaw] = useState(() => initialText ?? '');
  const setText = (v) => { setTextRaw(v); onDraft?.(chatId, v); };
  const [hint, setHint] = useState(null);
  // Command feedback ("Theme set to Darker.", usage errors) auto-dismisses
  // after a few seconds instead of lingering under the composer.
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 5000);
    return () => clearTimeout(t);
  }, [hint]);
  useEffect(() => {
    if (!inject) return;
    // Async injects (e.g. /improve) resolve seconds later; if the user
    // switched chats meanwhile, the text belongs to the other chat.
    if (inject.chatId && chatId && inject.chatId !== chatId) return;
    if ('text' in inject) setText(inject.text ?? '');
    if ('hint' in inject) setHint(inject.hint ?? null);
  }, [inject]);
  // onSubmit resolves to null once the send was actually accepted (clear the
  // draft), a hint string (draft kept, hint shown), or false when Main
  // rejected it silently (endpoint guard, freshness conflict — already
  // surfaced via toast/modal, draft kept). Acceptance is asynchronous: the
  // freshness guard awaits a server round trip before appending, so the
  // clear must wait for the real outcome, never a timer. `sending` blocks a
  // double-Enter while that await is in flight (the text is still in the box).
  const [sending, setSending] = useState(false);
  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const res = await onSubmit(t);
      if (typeof res === 'string') setHint(res);
      else if (res !== false) { setText(''); setHint(null); }
    } finally { setSending(false); }
  };
  // Touch devices (coarse pointer) have no Shift on the soft keyboard, so
  // Enter is always a newline there — sending is the Send button's job.
  // Desktop keeps Enter-to-send, Shift+Enter for newline.
  const coarseEnter = window.matchMedia?.('(pointer: coarse)').matches;
  // Slash-command hints. Command-word mode (no space typed yet): offer
  // matching commands — an exact match stays listed when the command takes an
  // argument, since the bare name isn't done yet. Argument mode (`/pov mi`):
  // offer matches from that command's value list (cmdArgs prop: known
  // character names, theme names, seen model ids). ↑/↓ move a highlight
  // through the list (wrapping), Enter or Tab completes the highlighted
  // entry, Esc dismisses the popup so the raw text can still be sent as-is.
  const slash = text.startsWith('/');
  const sp = text.indexOf(' ');
  const cmdKey = slash ? (sp === -1 ? text : text.slice(0, sp)).toLowerCase() : '';
  const argPartial = sp === -1 ? '' : text.slice(sp + 1).trimStart();
  const cmdHints = slash && sp === -1
    ? COMPOSER_COMMANDS.filter(([c]) => {
        const w = c.split(' ')[0];
        return w.startsWith(cmdKey) && (w !== cmdKey || c.includes(' '));
      })
    : [];
  // Once the partial starts with a full value + space, the argument is done
  // and the rest is free text (e.g. /pov's steering) — stop hinting values.
  const argDomain = cmdArgs?.[cmdKey] ?? [];
  const argDone = argDomain.some(v => argPartial.toLowerCase().startsWith(v.toLowerCase() + ' '));
  const argHints = slash && sp !== -1 && !argDone
    ? argDomain.filter(v => {
        const lv = v.toLowerCase(), lp = argPartial.toLowerCase();
        return lv.includes(lp) && lv !== lp;
      })
    : [];
  // One normalized list for both modes (they're mutually exclusive).
  const [hi, setHi] = useState(0);       // highlighted hint index
  const [esc, setEsc] = useState(false); // popup dismissed until the next edit
  const hintItems = esc ? [] : cmdHints.length
    ? cmdHints.map(([c, d]) => ({ label: c, desc: d, completion: c.split(' ')[0] + (c.includes(' ') ? ' ' : '') }))
    : argHints.slice(0, 8).map(v => ({ label: v, desc: cmdKey, completion: `${cmdKey} ${v}` }));
  const hiIdx = Math.min(hi, Math.max(0, hintItems.length - 1));
  const completeHint = (i) => {
    const it = hintItems[i];
    if (!it) return;
    setText(it.completion);
    setHi(0);
    taRef.current?.focus();
  };
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
      ${hintItems.length > 0 && html`
        <div class="cmd-hints">
          ${hintItems.map((it, i) => html`
            <button key=${it.label} class=${'cmd-hint' + (i === hiIdx ? ' sel' : '')}
              onMouseDown=${(e) => { e.preventDefault(); completeHint(i); }}>
              <span class="cmd">${it.label}</span><span class="desc">${it.desc}</span>
            </button>`)}
        </div>`}
      <div class="row">
        <textarea ref=${taRef} value=${text} rows=${1}
          placeholder="Type a message or /"
          onInput=${(e) => { setText(e.target.value); setHi(0); setEsc(false); }}
          onKeyDown=${(e) => {
            if (hintItems.length) {
              const n = hintItems.length;
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setHi(h => (Math.min(h, n - 1) + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
                return;
              }
              if (e.key === 'Tab') { e.preventDefault(); completeHint(hiIdx); return; }
              if (e.key === 'Escape') { e.preventDefault(); setEsc(true); return; }
              if (e.key === 'Enter' && !e.shiftKey && !coarseEnter) { e.preventDefault(); completeHint(hiIdx); return; }
            }
            // While generating/busy, Enter falls through to a newline instead
            // of being swallowed with no effect.
            if (e.key === 'Enter' && !e.shiftKey && !coarseEnter && !generating && !busy) { e.preventDefault(); send(); }
          }} />
        ${generating || busy
          ? html`<button class="btn danger" title=${generating ? 'Stop generation' : 'Stop background calls (memory, generator, suggestions…)'}
              onClick=${onStop}>■ Stop</button>`
          : html`<button class="btn primary" onClick=${send}>Send</button>`}
      </div>
      ${hint && html`<div class="hint warn">${hint}</div>`}
    </div>`;
}

