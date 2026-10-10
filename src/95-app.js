const SERVER_FLAG_KEY = 'fictionpad.serverStorage';

// Blocking boot screen when a browser that previously used server storage
// can't reach the server. Never falls back to IndexedDB on its own.
function ServerGate({ error, onRetry, onUseLocal }) {
  const unauthorized = error?.status === 401;
  const [token, setToken] = useState('');
  return html`
    <div class="server-gate">
      <div class="gate-card">
        <h2>Cannot reach the FictionPad server</h2>
        <p>This browser's scenarios, personas and chats live in server storage,
          but the server handshake failed${unauthorized ? ' — unauthorized' : ''}.</p>
        <pre class="gate-err">${error?.message ?? String(error)}</pre>
        ${unauthorized && html`
          <p>Unauthorized — check your server token (the server's FICTIONPAD_TOKEN):</p>
          <label class="field"><span>Server token</span>
            <input type="password" value=${token} placeholder="server token"
              onInput=${(e) => setToken(e.target.value)}
              onKeyDown=${(e) => { if (e.key === 'Enter') onRetry(token); }} /></label>`}
        <div class="gate-actions">
          <button class="btn primary" onClick=${() => onRetry(unauthorized ? token : null)}>
            ${unauthorized ? 'Save token & retry' : 'Retry'}</button>
          <button class="btn ghost" onClick=${onUseLocal}>Use browser storage instead</button>
        </div>
        ${!unauthorized && html`<p class="hint">The server may still be restarting — retry in a few seconds.
          Nothing is written anywhere while this screen is up; your server data is safe.</p>`}
      </div>
    </div>`;
}

function App() {
  const [storage, setStorage] = useState(null);
  const [storageKind, setStorageKind] = useState(null); // 'server' | 'local'
  const [storageFailed, setStorageFailed] = useState(false);
  const [gate, setGate] = useState(null); // { error } — server storage expected but unreachable
  const [bootNonce, setBootNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      let adapter = null, kind = 'local';
      // Server storage when served over http(s) and the handshake succeeds.
      // Fresh browser (no server flag): any failure → silent IndexedDB
      // fallback. Server-flagged browser: block with the gate instead of
      // booting an empty IndexedDB that looks like total data loss.
      if (location.protocol === 'http:' || location.protocol === 'https:') {
        try {
          const saved = JSON.parse(localStorage.getItem('fictionpad.settings') ?? '{}');
          const server = new ServerDBAdapter(saved?.serverToken ?? '');
          await server.init();
          adapter = server;
          kind = 'server';
          try { localStorage.setItem(SERVER_FLAG_KEY, '1'); } catch {}
        } catch (e) {
          let hadServer = false;
          try { hadServer = localStorage.getItem(SERVER_FLAG_KEY) === '1'; } catch {}
          if (hadServer) { if (alive) setGate({ error: e }); return; }
          console.warn('FictionPad: server storage unavailable, using browser storage.', e);
        }
      }
      if (!adapter) {
        adapter = new IndexedDBAdapter();
        try { await adapter.init(); }
        catch (e) { console.error(e); if (alive) setStorageFailed(true); }
      }
      if (alive) {
        // Lazy-image hydration channel for components (no-op on the eager
        // IndexedDB adapter — see requestHydration in 40-storage.js).
        registerHydrator(adapter);
        setStorage(adapter); setStorageKind(kind);
      }
    })();
  }, [bootNonce]);
  useEffect(() => {
    if (!storage) return;
    const flush = () => storage.flush();
    // Focus sync: one cheap rev-diff pull when the tab regains attention
    // (throttled inside the adapter) — entities changed on another device
    // arrive BEFORE the user writes against a stale copy.
    const sync = () => { if (document.visibilityState === 'visible') storage.syncFromServer?.(); };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', flush);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', flush);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
    };
  }, [storage]);
  if (storage) return html`<${ErrorBoundary} name="app"><${Main} storage=${storage} storageKind=${storageKind} storageFailed=${storageFailed} /><//>`;
  if (gate) return html`<${ServerGate} error=${gate.error}
    onRetry=${(token) => {
      if (token != null) try {
        const s = JSON.parse(localStorage.getItem('fictionpad.settings') ?? '{}');
        s.serverToken = token;
        localStorage.setItem('fictionpad.settings', JSON.stringify(s));
      } catch {}
      setGate(null);
      setBootNonce(n => n + 1);
    }}
    onUseLocal=${() => {
      // Explicit opt-out: forget the server flag and boot browser storage.
      try { localStorage.removeItem(SERVER_FLAG_KEY); } catch {}
      setGate(null);
      setBootNonce(n => n + 1);
    }} />`;
  return html`<div class="empty">Loading FictionPad…</div>`;
}

createRoot(document.getElementById('root')).render(html`<${App} />`);
