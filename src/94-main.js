// ============================================================================
// APP — wires storage, collections, generation orchestration, and the panels.
// ============================================================================
function newChat(scenario, personaId, dateFormat) {
  const rootId = uid();
  return {
    id: uid(), scenarioId: scenario.id, personaId: personaId ?? null,
    name: `${scenario.name} — ${fmtDate(Date.now(), dateFormat)}`,
    customInstructions: '',
    rootMessageId: rootId, activeLeafId: rootId,
    messages: {
      [rootId]: { id: rootId, parentId: null, role: 'assistant', edited: false, activeSwipe: 0,
        swipes: [{ text: scenario.greeting ?? '', createdAt: Date.now(), modelId: null }] },
    },
    memoryStore: { memories: [], cursor: 0 },
    settings: {},
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

// User-defined tools (Settings → Features): advertised to the model after the
// built-ins, executed by action kind in applyToolCall. Built-in names are
// reserved — a custom def can never shadow register_character / add_lore.
const enabledCustomTools = (st) => (st.customTools ?? []).filter(t => t?.name?.trim()
  && t.name !== 'register_character' && t.name !== 'add_lore');

// Full system-prompt head: platform prompt + enabled feature prompts (multi-
// speaker, tool calling + user-defined tools). Shared by runGeneration and
// the inspector preview so both count exactly what a generation would send.
function buildPlatformPrompt(st) {
  const defs = enabledCustomTools(st);
  const customSection = defs.length
    ? '\nAdditional tools:\n' + defs.map(t =>
        `- ${t.name.trim()}(${t.argsHint?.trim() || '…'}) — ${t.description?.trim() || 'custom tool'}`).join('\n')
    : '';
  return [
    st.platformPrompt,
    ...(st.multiSpeaker !== false ? [(st.speakerPrompt ?? '').trim() || SPEAKER_PROMPT] : []),
    ...(st.toolsEnabled !== false ? [((st.toolsPrompt ?? '').trim() || TOOLS_PROMPT) + customSection] : []),
  ].filter(s => s?.trim()).join('\n\n');
}

// Side-pane sizing: manual widths persist in fictionpad.ui (sbWidth/dwWidth);
// when unset, a pane auto-sizes to consume the slack margin around the chat
// column: clamp(MIN, (viewport − chatW)/2 − gap, AUTO_MAX).
const PANE_MIN = 200, PANE_MAX_VW = 0.5, PANE_AUTO_MAX = 640, PANE_GAP = 16;

function Main({ storage, storageKind, storageFailed }) {
  // Request-time endpoint rewrite ("route via server") — never persisted.
  const effEp = (st) => effectiveEndpoint(st, storageKind === 'server');
  const [scenarios, upsertScenario, removeScenario] = useStoredMap(storage, 'Scenarios');
  const [personas, upsertPersona, removePersona] = useStoredMap(storage, 'Personas');
  const [chats, upsertChat, removeChat] = useStoredMap(storage, 'Chats');
  const [settingsRaw, setSettings] = usePersistentState('fictionpad.settings', DEFAULT_SETTINGS);
  const settings = useMemo(() => ({
    ...DEFAULT_SETTINGS, ...(settingsRaw ?? {}),
    samplers: { ...DEFAULT_SETTINGS.samplers, ...(settingsRaw?.samplers ?? {}) },
    layerCaps: { ...DEFAULT_SETTINGS.layerCaps, ...(settingsRaw?.layerCaps ?? {}) },
  }), [settingsRaw]);
  // Settings sync via server storage: Meta/app.settings is the shared source
  // when server storage is active (server wins at boot, last-write-wins after).
  // serverToken is a per-device credential — stripped on upload, preserved
  // locally on download. localStorage remains the offline cache/fallback.
  const SETTINGS_SYNC_KEY = 'app.settings';
  const settingsSync = useRef({ adopted: false, lastWritten: null });
  useEffect(() => { // adopt the server copy once at boot
    if (storageKind !== 'server') return;
    const remote = storage.get('Meta', SETTINGS_SYNC_KEY);
    if (remote && typeof remote === 'object') {
      setSettings(prev => ({ ...remote, serverToken: prev?.serverToken ?? '' }));
      // Skip the pre-adoption upload: the write effect fires in this same
      // commit with the *local* settings — don't let them clobber the server.
      settingsSync.current.lastWritten = settingsRaw;
    }
    settingsSync.current.adopted = true;
  }, [storageKind]);
  useEffect(() => { // upload on every change (token stripped; first boot seeds it)
    if (storageKind !== 'server' || !settingsSync.current.adopted) return;
    if (settingsSync.current.lastWritten === settingsRaw) return;
    settingsSync.current.lastWritten = settingsRaw;
    const { serverToken, ...rest } = settingsRaw ?? {};
    storage.set('Meta', SETTINGS_SYNC_KEY, rest);
  }, [settingsRaw, storageKind]);
  const [ui, setUi] = usePersistentState('fictionpad.ui', { scenarioId: null, chatId: null, drawer: null, sidebarCollapsed: false });
  const [theme, setTheme] = usePersistentState('fictionpad.theme', 'miku');
  const [accent, setAccent] = usePersistentState('fictionpad.accent', DEFAULT_ACCENT);
  useEffect(() => applyTheme(theme, accent), [theme, accent]);
  const [manifest, setManifest] = useState(null);
  const [lastMessages, setLastMessages] = useState(null); // chat-completions array behind manifest
  const [realCounts, setRealCounts] = useState(null); // /tokenize counts {static,lore,memory,total} | null
  const [modal, setModal] = useState(null);
  const [generating, setGenerating] = useState(null); // { chatId, nodeId }
  const [summarizing, setSummarizing] = useState(false);
  const [suggestions, setSuggestions] = useState(null); // { chatId, nodeId, swipe, loading, items } | null
  const [composerInject, setComposerInject] = useState(null); // { text?, hint?, nonce }
  const [auxBusy, setAuxBusy] = useState(null); // 'improve' | 'recap' | 'memory' | null
  const [error, setError] = useState(null);
  const genRef = useRef(null); // { abort }

  // Aux-call observability: memory/lore-extract/suggestions//improve//recap are
  // separate requests that never touch the main context, so the manifest can't
  // show them. Keep a short session log (last 12) of what was sent and what
  // came back; the Inspector renders it as its own section.
  const [auxLog, setAuxLog] = useState([]);
  async function auxLogged(kind, args) {
    const entry = { kind, at: Date.now(), model: args.model ?? '', system: args.system ?? '', user: args.user ?? '' };
    try {
      const out = await auxCall(args);
      setAuxLog(log => [...log.slice(-11), { ...entry, ok: true, out: out ?? '' }]);
      return out;
    } catch (e) {
      setAuxLog(log => [...log.slice(-11), { ...entry, ok: false, out: String(e?.message ?? e) }]);
      throw e;
    }
  }

  // Always-fresh refs for async generation loops (avoid stale closures).
  const ref = useRef({});
  ref.current = { scenarios, personas, chats, settings };

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 9000);
    return () => clearTimeout(t);
  }, [error]);

  // Real token counts for the inspector — debounced, async, silently absent
  // when /tokenize is unavailable. Estimates remain the fallback.
  useEffect(() => {
    setRealCounts(null);
    if (!manifest?.layers || !lastMessages?.length) return;
    const st = ref.current.settings;
    const model = ref.current.chats[ui.chatId]?.settings?.model || st.model;
    if (!st.endpoint || !model) return;
    let alive = true;
    const t = setTimeout(async () => {
      const count = (text) => text
        ? getTokenCount({ endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model, text })
        : Promise.resolve(null);
      // Reconstruct the exact blocks as sent from the same message array.
      const sysBlocks = lastMessages.filter(m => m.role === 'system');
      const rest = lastMessages.slice(sysBlocks.length);
      const hasGreeting = rest[0]?.role === 'assistant';
      const [s, l, m2, g, h, tot] = await Promise.all([
        count(sysBlocks[0]?.content),
        count(sysBlocks.find(m => m.content.startsWith('[World Info]'))?.content),
        count(sysBlocks.find(m => m.content.startsWith('[Memories]'))?.content),
        count(hasGreeting ? rest[0].content : ''),
        count((hasGreeting ? rest.slice(1) : rest).map(m => m.content).join('\n')),
        count(lastMessages.map(m => m.content).join('\n')),
      ]);
      if (alive) setRealCounts({ static: s, lore: l, memory: m2, greeting: g, history: h, total: tot });
    }, 500);
    return () => { alive = false; clearTimeout(t); };
  }, [manifest, lastMessages]);

  const chat = chats[ui.chatId] ?? null;
  // On chat open/switch (incl. after branching): drop debris from generations
  // killed by a reload, then default to the swipes the conversation actually
  // continued from. In-session browsing is unaffected.
  useEffect(() => {
    const c = ref.current.chats[ui.chatId];
    if (!c) return;
    const next = applyUsedSwipes(pruneInterrupted(c));
    if (next !== c) upsertChat(next.id, next);
  }, [ui.chatId]);
  const persona = chat?.personaId ? personas[chat.personaId] : null;
  const personaName = persona?.name?.trim() || 'User';
  const characterNames = useMemo(
    () => characterNamesOf(chat ? scenarios[chat.scenarioId] : null, chat),
    [chat, scenarios]);
  const sidebarCollapsed = ui.sidebarCollapsed ?? (window.innerWidth <= 700); // phones start with the drawer closed
  const toggleSidebar = () => setUi(u => ({ ...u, sidebarCollapsed: !sidebarCollapsed }));
  // Right drawer: ui.drawer is the open tab ('inspector' | 'memory') or null.
  const toggleDrawer = (tab) => setUi(u => ({ ...u, drawer: u.drawer === tab ? null : tab }));
  const closeDrawer = () => setUi(u => (u.drawer ? { ...u, drawer: null } : u));
  const lastDrawerTabRef = useRef('inspector'); // edge-swipe reopens the last-used tab
  if (ui.drawer) lastDrawerTabRef.current = ui.drawer;
  const saveChat = useCallback((c) => upsertChat(c.id, { ...c, updatedAt: Date.now() }), [upsertChat]);

  // Writes that failed to persist and are queued for retry (Task: never drop).
  const [saveRetrying, setSaveRetrying] = useState(false);
  useEffect(() => {
    const on = (e) => setSaveRetrying(!!e.detail?.retrying);
    storage.addEventListener('savestate', on);
    return () => storage.removeEventListener('savestate', on);
  }, [storage]);

  // ---- side-pane sizing (auto slack-fill + drag-to-resize) ----
  const [viewportW, setViewportW] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const chatW = useMemo(() => {
    const v = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--chat-w'), 10);
    return Number.isFinite(v) ? v : 780;
  }, []);
  const clampPane = (w) => Math.round(Math.max(PANE_MIN, Math.min(w, viewportW * PANE_MAX_VW)));
  const autoPaneW = clampPane(Math.min((viewportW - chatW) / 2 - PANE_GAP, PANE_AUTO_MAX));
  const sbW = sidebarCollapsed ? 0 : clampPane(ui.sbWidth ?? autoPaneW);
  const dwW = ui.drawer ? clampPane(ui.dwWidth ?? autoPaneW) : 0;
  // Narrow-viewport fallback: pad the center column with a pane's actual
  // width only when the slack margin can't contain it — chat never hides.
  // At the phone breakpoint both panes are full overlays (scrim), no sharing.
  const MOBILE_BP = 700;
  const isMobile = viewportW <= MOBILE_BP;
  const padL = !isMobile && viewportW < chatW + 2 * sbW ? sbW : 0;
  const padR = !isMobile && viewportW < chatW + 2 * dwW ? dwW : 0;
  const [dragging, setDragging] = useState(false);
  const paneDragStart = (side) => (startX) => {
    const key = side === 'left' ? 'sbWidth' : 'dwWidth';
    const startW = side === 'left' ? sbW : dwW;
    setDragging(true);
    const onMove = (ev) => {
      const dx = side === 'left' ? ev.clientX - startX : startX - ev.clientX;
      const w = clampPane(startW + dx);
      setUi(u => (u[key] === w ? u : { ...u, [key]: w }));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const resetPaneWidth = (side) => setUi(u => ({ ...u, [side === 'left' ? 'sbWidth' : 'dwWidth']: null }));

  // ---- mobile edge swipes: open/close the two overlay panes ----
  // Left edge → swipe right opens the sidebar; right edge → swipe left opens
  // the Inspector/Memory drawer. Message rows (.msg) are ALWAYS bubble swipe
  // territory — pane gestures never start there, and with a pane open only
  // touches on the pane/scrim itself swipe it shut (scrim tap also closes).
  // Otherwise pane gestures steal bubble swipes near the edges, which reads
  // as "the swipe directions are backwards".
  const navStateRef = useRef({ isMobile, collapsed: sidebarCollapsed, drawer: ui.drawer });
  navStateRef.current = { isMobile, collapsed: sidebarCollapsed, drawer: ui.drawer, lastDrawerTab: lastDrawerTabRef.current };
  useEffect(() => {
    let g = null;
    const down = (e) => {
      if (e.pointerType === 'mouse') return;
      const st = navStateRef.current;
      if (!st.isMobile) return;
      if (e.target.closest?.('.msg')) return; // message rows: bubble navigation only
      if (st.collapsed && !st.drawer) {
        // Both panes closed: an open gesture must start on a screen edge.
        const edge = e.clientX <= 24 ? 'left' : e.clientX >= window.innerWidth - 24 ? 'right' : null;
        if (edge) g = { id: e.pointerId, x: e.clientX, y: e.clientY, edge };
      } else if (e.target.closest?.('.sidebar, .drawer, .scrim')) {
        // A pane is open: swiping it shut starts on the pane/scrim itself.
        g = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }
    };
    const move = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > 2 * Math.abs(dy)) {
        const st = navStateRef.current;
        if (g.edge === 'left') { if (dx > 0 && st.collapsed) toggleSidebar(); }
        else if (g.edge === 'right') { if (dx < 0 && !st.drawer) toggleDrawer(st.lastDrawerTab ?? 'inspector'); }
        else {
          if (dx < 0 && !st.collapsed) toggleSidebar();
          else if (dx > 0 && st.drawer) closeDrawer();
        }
        g = null;
      }
    };
    const up = () => { g = null; };
    for (const [ev, fn] of [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up]])
      window.addEventListener(ev, fn, { passive: true });
    return () => {
      for (const [ev, fn] of [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up]])
        window.removeEventListener(ev, fn);
    };
  }, []);

  // ---- chat row actions + context menu ----
  const [ctxMenu, setCtxMenu] = useState(null); // { chatId, x, y }
  const openChatPanel = (chatId, tab) => {
    setUi(u => ({ ...u, chatId }));
    setModal({ kind: 'chatPanel', chatId, tab });
  };
  const chatAction = (chatId, action) => {
    const c = ref.current.chats[chatId];
    if (!c) return;
    switch (action) {
      case 'inspector': return openChatPanel(chatId, 'inspector');
      case 'memory': return openChatPanel(chatId, 'memory');
      case 'settings': return openChatPanel(chatId, 'chat');
      case 'rename': {
        const name = prompt('Rename chat', c.name);
        if (name?.trim()) saveChat({ ...c, name: name.trim() });
        return;
      }
      case 'export': return onExportChat(c);
      case 'delete': if (confirm(`Delete chat "${c.name}"?`)) onDeleteChat(chatId);
    }
  };

  // ---- storage migration helpers (settings; last write wins per key) ----
  async function migrateUpload() {
    const idb = new IndexedDBAdapter();
    await idb.init();
    const srv = new ServerDBAdapter(ref.current.settings.serverToken ?? '');
    let n = 0;
    for (const store of STORES)
      for (const [key, data] of Object.entries(idb.getAll(store))) {
        await srv.remoteSave(store, key, data);
        n++;
      }
    return n;
  }
  async function migrateDownload() {
    const idb = new IndexedDBAdapter();
    await idb.init();
    const srv = new ServerDBAdapter(ref.current.settings.serverToken ?? '');
    let n = 0;
    for (const store of STORES)
      for (const [key, data] of Object.entries(await srv.remoteAll(store))) {
        await idb.persistPut(store, key, data);
        n++;
      }
    return n;
  }

  // ---- memory subsystem ----
  // Shared memory-card generation (auto-summarize + /memory). Returns the
  // ≤500-char note text, or null when there's nothing to summarize. Throws on
  // endpoint/HTTP errors.
  async function generateMemory(chatObj, messageCount = null) {
    const { personas: pe, settings: st } = ref.current;
    const model = st.auxModel || st.model;
    if (!st.endpoint || !model) throw new Error('Configure an endpoint and model in Settings first.');
    const every = st.memoryEvery ?? MEMORY_EVERY;
    const pName = (chatObj.personaId && pe[chatObj.personaId]?.name?.trim()) || 'User';
    const path = getActivePath(chatObj.messages, chatObj.activeLeafId);
    const recent = path.slice(-(messageCount ?? every))
      .map(n => `${n.role === 'user' ? pName : 'Character'}: ${subUser(activeText(n), pName)}`)
      .join('\n\n');
    if (!recent.trim()) return null;
    const maxChars = st.memoryMaxChars ?? 500;
    const out = await auxLogged('memory', {
      endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model,
      system: subUser(st.memoryPrompt || DEFAULT_MEMORY_PROMPT, pName),
      user: `Recent conversation:\n\n${recent}\n\nMemory note (max ${maxChars} characters):`,
      maxTokens: st.memoryMaxTokens ?? 220, temperature: st.memoryTemp ?? 0.3, stop: st.stopStrings,
    });
    return out.slice(0, maxChars) || null;
  }
  async function summarizeNow(chatObj) {
    setSummarizing(true);
    try {
      const text = await generateMemory(chatObj);
      if (text) {
        const pathLen = getActivePath(chatObj.messages, chatObj.activeLeafId).length;
        const store = addMemory(chatObj.memoryStore, text, Date.now(), ref.current.settings.memoryCap ?? MEMORY_CAP);
        saveChat({ ...chatObj, memoryStore: { ...store, cursor: pathLen } });
      }
    } catch (e) {
      setError(`Memory summarization failed: ${e.message ?? e}`);
    } finally {
      setSummarizing(false);
    }
  }
  function maybeSummarize(chatObj) {
    const every = ref.current.settings.memoryEvery ?? MEMORY_EVERY;
    const pathLen = getActivePath(chatObj.messages, chatObj.activeLeafId).length;
    if (pathLen - (chatObj.memoryStore?.cursor ?? 0) >= every) summarizeNow(chatObj);
  }

  // ---- emergent lore extraction (v2.0d) ----
  // On the memory cadence, an aux call proposes up to 3 NEW lore pieces from
  // the recent conversation. 'queue' mode (default): proposals wait for review
  // in chat settings. 'auto': applied straight to chat lore. 'off': nothing.
  // Failures degrade silently (console.warn) and the cursor still advances.
  async function maybeExtractLore(chatObj) {
    const { scenarios: sc, personas: pe, settings: st } = ref.current;
    const scen = sc[chatObj.scenarioId];
    const mode = scen?.emergentLore ?? 'queue';
    if (mode === 'off' || !st.endpoint) return;
    const model = st.auxModel || st.model;
    if (!model) return;
    const path = getActivePath(chatObj.messages, chatObj.activeLeafId);
    const pathLen = path.length;
    const every = st.memoryEvery ?? MEMORY_EVERY;
    if (pathLen - (chatObj.emergentCursor ?? 0) < every) return;
    const advance = (c) => saveChat({ ...c, emergentCursor: pathLen });
    const pName = (chatObj.personaId && pe[chatObj.personaId]?.name?.trim()) || 'User';
    const recent = path.slice(-every)
      .map(n => `${n.role === 'user' ? pName : 'Narrator'}: ${subUser(activeText(n), pName)}`)
      .join('\n\n');
    if (!recent.trim()) return;
    const titles = mergedLorePieces(scen, chatObj).map(p => (p.title ?? '').trim()).filter(Boolean);
    try {
      const out = await auxLogged('lore-extract', {
        endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model,
        system: st.loreExtractPrompt || DEFAULT_LORE_EXTRACT_PROMPT,
        user: `Existing lore: ${titles.join(', ') || '(none)'}\n\nRecent conversation:\n\n${recent}\n\nJSON array:`,
        maxTokens: st.loreExtractMaxTokens ?? 400, temperature: st.loreExtractTemp ?? 0.3, stop: st.stopStrings,
      });
      const m = out.match(/\[[\s\S]*\]/);
      const proposals = m ? JSON.parse(m[0]) : [];
      const existing = new Set(titles.map(t => t.toLowerCase()));
      const queued = new Set((chatObj.loreQueue ?? []).map(q => (q.title ?? '').trim().toLowerCase()));
      const fresh = (Array.isArray(proposals) ? proposals : [])
        .map(p => ({
          title: String(p?.title ?? '').trim().slice(0, TOOL_NAME_MAX),
          content: String(p?.content ?? '').trim().slice(0, TOOL_TEXT_MAX),
          keys: (Array.isArray(p?.keys) ? p.keys : []).map(k => String(k).trim()).filter(k => k.length >= MIN_KEY_LENGTH).slice(0, 5),
        }))
        .filter(p => p.title && p.content
          && !existing.has(p.title.toLowerCase()) && !queued.has(p.title.toLowerCase()))
        .slice(0, Math.max(1, st.loreExtractMax ?? 3));
      if (fresh.length) {
        let work = chatObj;
        if (mode === 'auto') {
          work = applyToolCalls(work, fresh.map(p => ({ name: 'add_lore', args: p })), { now: Date.now() }).chat;
        } else {
          for (const p of fresh) work = queueLorePiece(work, { ...p, source: 'extract' });
        }
        advance(work);
        return;
      }
      advance(chatObj);
    } catch (e) {
      console.warn('Emergent lore extraction failed:', e);
      advance(chatObj);
    }
  }

  // ---- generation ----
  async function runGeneration(chatObj, nodeId, { continuation = false, fresh = false, pov = null } = {}) {
    const { scenarios: sc, personas: pe, settings: st } = ref.current;
    const model = chatObj.settings?.model || st.model; // per-chat override wins
    if (!st.endpoint || !model) { setError('Configure an endpoint and chat model in Settings first.'); return; }
    // Claim the generation slot immediately — the async prep below (semantic
    // embeddings, exact token count) can take a long time on a slow backend,
    // and the UI (waiting dots, Stop button, input guards) keys off this.
    const abort = new AbortController();
    genRef.current = { abort };
    setGenerating({ chatId: chatObj.id, nodeId });
    const genStart = Date.now(); // for swipe.genMs (prompt-to-completion time)
    const scen = sc[chatObj.scenarioId];
    const pers = chatObj.personaId ? pe[chatObj.personaId] : null;
    const node = chatObj.messages[nodeId];
    // The node being generated is excluded from the prompt unless continuing it.
    const promptChat = continuation ? chatObj : { ...chatObj, activeLeafId: node?.parentId ?? chatObj.activeLeafId };
    // Semantic lore activation (async, outside the pure assembler): embed the
    // recent conversation + smart pieces, threshold → preActivated id set.
    // Scores for every scored piece go on the manifest so the Inspector can
    // show near-misses. Any embeddings failure degrades to keyword-only with
    // a manifest warning.
    let preActivated = null;
    let semanticWarning = null;
    let semanticReport = null;
    const semThreshold = typeof st.semanticThreshold === 'number' ? st.semanticThreshold : SEMANTIC_THRESHOLD;
    if (st.embeddingModel) {
      const smartPieces = mergedLorePieces(scen, chatObj).filter(p => p && p.enabled !== false && !p.pinned && p.smart);
      const queryText = getActivePath(promptChat.messages, promptChat.activeLeafId)
        .map(activeText).join('\n').slice(-1500);
      if (smartPieces.length && queryText.trim()) {
        try {
          const [queryVec] = await embed({ endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model: st.embeddingModel, inputs: [queryText] });
          const vecs = await Promise.all(smartPieces.map(p =>
            embedCached({ endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model: st.embeddingModel,
              text: `${p.title ?? ''}\n${(p.content ?? '').slice(0, 500)}` })));
          preActivated = new Set();
          semanticReport = { threshold: semThreshold, scores: [] };
          for (let i = 0; i < smartPieces.length; i++) {
            const score = cosine(queryVec, vecs[i]);
            if (score >= semThreshold) preActivated.add(smartPieces[i].id);
            semanticReport.scores.push({ id: smartPieces[i].id, title: smartPieces[i].title ?? '', score });
          }
        } catch (e) {
          console.warn('Semantic lore activation failed:', e);
          semanticWarning = 'Semantic lore activation failed (embeddings); keyword-only for this generation.';
        }
      }
    }
    let { messages, manifest: man } = assemblePrompt({
      scenario: scen, persona: pers, chat: promptChat, settings: st,
      platformPrompt: buildPlatformPrompt(st),
      preActivated, pov,
    });
    if (semanticWarning) man.warnings.push(semanticWarning);
    if (semanticReport) man.semantic = semanticReport;
    // Exact-count overflow guard: the assembler budgets on char estimates,
    // which can undercount. When /tokenize is available, count the fixed head
    // (static + lore + memory + greeting) exactly and drop oldest history
    // messages until the estimated remainder fits the real headroom.
    // Silently skipped (estimates stand) when tokenize is unavailable.
    {
      const nSys = messages.filter(m => m.role === 'system').length;
      const hasGreeting = (man.layers.greeting?.tokens ?? 0) > 0;
      const head = messages.slice(0, nSys + (hasGreeting ? 1 : 0));
      const hist = messages.slice(head.length);
      const headTok = hist.length
        ? await getTokenCount({ endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model,
            text: head.map(m => m.content).join('\n') })
        : null;
      if (headTok != null) {
        const headroom = man.budget - headTok;
        const estT = (t) => estimateTokens(t, st.tokenChars);
        let estHist = hist.reduce((t, m) => t + estT(m.content), 0);
        let extraDrops = 0;
        while (estHist > headroom && hist.length > 1) {
          estHist -= estT(hist.shift().content);
          extraDrops++;
        }
        if (extraDrops > 0) {
          messages = [...head, ...hist];
          man.layers.history.kept -= extraDrops;
          man.layers.history.dropped += extraDrops;
          man.layers.history.tokens = estHist;
          man.totalTokens = messages.reduce((t, m) => t + estT(m.content), 0);
          man.warnings.push(`Exact token count left less room than the estimate — dropped ${extraDrops} more oldest message(s).`);
        }
        if (headTok > man.budget)
          man.warnings.push(`Fixed layers alone use ~${headTok} exact tokens, over the ${man.budget}-token prompt budget — shrink backstory/lore/memory or raise the context length.`);
      }
    }
    // Stopped during the async prep (embeddings/tokenize)? Bail before streaming.
    if (abort.signal.aborted) { genRef.current = null; setGenerating(null); return; }
    setManifest(man);
    setLastMessages(messages);
    setSuggestions(null);
    // Logit bias: OpenAI shape {token_id: bias}, first token of each entry.
    const logitBias = {};
    for (const e of Object.values(st.logitBias ?? {})) {
      const id = e?.ids?.[0];
      if (Number.isInteger(id)) logitBias[String(id)] = Math.max(-100, Math.min(100, e.power));
    }
    let work = chatObj;
    // Display text streams in plain (delta is the text authority). Logprobs
    // accumulate as a SEPARATE raw tape — a chunk's delta and its logprob
    // entries are not reliably related (middleware re-chunking can attach
    // them off by one), so alignment happens once, globally, at the end.
    const baseText = continuation ? activeText(node) : '';
    const baseSpans = continuation
      ? (node?.swipes?.[node.activeSwipe]?.tokens ?? [{ text: baseText, logprob: null, top: [] }])
      : [];
    let acc = baseText;
    const lpTape = [];
    // Tool replies: the RAW accumulated text and its raw→stripped char map
    // (set when tool blocks were stripped) so the lp tape — which covers the
    // protocol text too — can still be aligned and projected onto the
    // stripped display text.
    let rawAcc = null, probMap = null;
    const applyText = (text, tokens) => {
      const n = work.messages[nodeId];
      if (!n) return;
      const swipes = n.swipes.slice();
      swipes[n.activeSwipe] = { ...swipes[n.activeSwipe], text, modelId: model, ...(tokens ? { tokens } : {}) };
      work = { ...work, messages: { ...work.messages, [nodeId]: { ...n, swipes } }, updatedAt: Date.now() };
      upsertChat(work.id, work);
    };
    // One global alignment pass over the finished text + raw lp tape; attaches
    // swipe.tokens when at least one span carries real prob data. Runs on
    // completion AND abort, so partial generations keep their probs.
    const attachProbs = () => {
      let spans = null;
      if (probMap && rawAcc != null)
        spans = alignStrippedToolSpans(rawAcc.slice(baseText.length), lpTape, probMap.map, baseText.length, acc.slice(baseText.length));
      if (!spans) spans = alignTokensToSpans(acc.slice(baseText.length), lpTape);
      spans = [...baseSpans, ...spans];
      if (spans.some(s => s.logprob != null)) applyText(acc, spans);
      else if (st.tokenProbs !== false && acc)
        console.warn('FictionPad: logprobs were requested but the stream contained none — ' +
          'an intermediate proxy/middleware may not be forwarding "logprobs"/"top_logprobs" to the backend.');
    };
    // Remove the empty generating swipe (or the fresh placeholder node) when
    // nothing was ever written — applies to errors, dropped connections,
    // empty completions, and Stop-before-first-token alike.
    const discardEmptySwipe = () => {
      const n = work.messages[nodeId];
      if (!n) return;
      if (n.swipes.length > 1) {
        const swipes = n.swipes.slice(0, -1);
        work = { ...work, messages: { ...work.messages, [nodeId]: { ...n, swipes, activeSwipe: swipes.length - 1 } } };
        upsertChat(work.id, work);
      } else if (fresh) {
        const messages = { ...work.messages };
        delete messages[nodeId];
        work = { ...work, messages, activeLeafId: n.parentId };
        upsertChat(work.id, work);
      }
    };
    let sawDone = false; // a chunk with finish_reason arrived (clean finish)
    try {
      for await (const chunk of openaiChatStream({
        endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model, messages,
        samplers: st.samplers, maxTokens: st.maxTokens, signal: abort.signal,
        tokenProbs: st.tokenProbs !== false, topLogprobs: st.topLogprobs ?? 10, logitBias, stop: st.stopStrings,
      })) {
        if (chunk.done) { sawDone = true; continue; }
        if (chunk.lp) { lpTape.push(...chunk.lp); continue; }
        acc += chunk.content;
        // Streaming view hides tool protocol blocks (complete + trailing
        // unterminated) so the user never sees them mid-generation.
        applyText(st.toolsEnabled !== false ? stripToolBlocks(acc) : acc);
      }
      if (!acc && !abort.signal.aborted)
        setError(sawDone ? 'The model returned an empty response.'
                         : 'The connection ended before any text arrived.');
    } catch (e) {
      if (e.name !== 'AbortError')
        setError(`Generation failed: ${e.message ?? e}`);
    } finally {
      genRef.current = null;
      setGenerating(null);
      // Tool calls (v2.0b): parse the finished text, strip protocol blocks
      // from display, execute against the chat lore overlay. Logprobs still
      // attach on tool replies: the lp tape is aligned against the RAW text
      // (which it tiles exactly) and projected through the strip's char map
      // onto the stripped display text (attachProbs).
      let toolResults = null;
      // Regenerate hygiene: a successful regeneration replaces the previous
      // swipe — drop tool-written pieces it created, but ONLY when nothing
      // follows this node in the tree (mid-tree regenerates keep them: later
      // messages may rely on them). Runs even with tools toggled off — the
      // old swipe's pieces were written when they were on.
      if (acc && !fresh && !continuation
          && !Object.values(work.messages).some(m => m.parentId === nodeId)) {
        const pruned = pruneToolPieces(work, nodeId);
        if (pruned !== work) { work = pruned; upsertChat(work.id, work); }
      }
      if (acc && st.toolsEnabled !== false) {
        const parsed = parseToolCalls(acc);
        if (parsed.text !== acc) {
          // Keep the raw text + raw→stripped map for logprob projection.
          probMap = stripToolBlocksMapped(acc);
          rawAcc = acc;
          // Drift guard: if the map's text isn't exactly what we store,
          // discard it — attachProbs falls back to plain alignment.
          if (probMap.text !== parsed.text) { probMap = null; rawAcc = null; }
          acc = parsed.text;
          if (acc) applyText(acc);
        }
        if (parsed.calls.length) {
          // DEBUG: log raw tool blocks + parsed calls while the protocol is
          // being tuned. TODO: remove this console.debug once format
          // compliance is confirmed across models.
          console.debug('FictionPad tool calls:', parsed.calls.map(c => ({ raw: c.raw, parsed: { name: c.name, args: c.args }, error: c.error })));
          const callCap = Math.max(1, st.toolCallCap ?? TOOL_CALL_CAP);
          const applied = applyToolCalls(work, parsed.calls, {
            nodeId, now: Date.now(), cap: callCap,
            queueLore: (scen?.emergentLore ?? 'queue') === 'queue',
            customTools: enabledCustomTools(st),
          });
          toolResults = applied.results;
          if (applied.chat !== work) { work = applied.chat; upsertChat(work.id, work); }
          man.toolCalls = applied.results.map(r => ({
            name: r.name, ok: r.ok, note: r.note, args: toPreview(JSON.stringify(r.args ?? {}), 200),
          }));
          const capped = applied.results.filter(r => r.note === 'call cap reached').length;
          const failed = applied.results.filter(r => !r.ok && r.note !== 'call cap reached').length;
          if (capped) man.warnings.push(`${capped} tool call(s) skipped — per-generation cap is ${callCap}.`);
          if (failed) man.warnings.push(`${failed} tool call(s) failed — details in the inspector.`);
          setManifest({ ...man });
        }
      }
      if (!acc) discardEmptySwipe();
      // Stream ended without a finish chunk and not by the user's Stop — the
      // connection dropped mid-generation. Partial text is kept, but flagged.
      const interrupted = !!acc && !sawDone && !abort.signal.aborted;
      if (acc) {
        attachProbs();
        // Attribute the finished swipe to a character (or "Narrator"), and
        // record how long the generation took.
        const names = characterNamesOf(scen, work);
        const n = work.messages[nodeId];
        if (n) {
          const swipes = n.swipes.slice();
          swipes[n.activeSwipe] = { ...swipes[n.activeSwipe], speaker: detectSpeaker(acc, names) ?? 'Narrator', genMs: Date.now() - genStart,
            ...(interrupted ? { interrupted: true } : {}),
            // Persisted on the swipe so the gear popover can show them after the fact.
            ...(toolResults ? { toolCalls: toolResults.map(({ name, ok, note, args }) => ({
              name, ok, note, args: toPreview(JSON.stringify(args ?? {}), 200),
            })) } : {}) };
          work = { ...work, messages: { ...work.messages, [nodeId]: { ...n, swipes } } };
          upsertChat(work.id, work);
        }
        maybeSummarize(work);
        maybeExtractLore(work);
        // Response suggestions: only after a full generation/regeneration —
        // never mid-stream, never after /continue, never for OOC exchanges.
        if (!continuation && st.suggestions !== false) {
          const parent = work.messages[node?.parentId];
          const parentIsOOC = parent?.role === 'user' && /^\[OOC:/i.test(activeText(parent).trim());
          if (!parentIsOOC) fetchSuggestions(work, nodeId);
        }
      }
      storage.flush();
    }
  }

  // ---- response suggestions (aux model; ephemeral, silent on failure) ----
  async function fetchSuggestions(chatObj, nodeId) {
    const { personas: pe, settings: st } = ref.current;
    const model = st.auxModel || st.model;
    if (!st.endpoint || !model) return;
    const pName = (chatObj.personaId && pe[chatObj.personaId]?.name?.trim()) || 'User';
    const count = Math.max(1, Math.min(5, st.suggestionsCount ?? 2));
    const words = Math.max(5, Math.min(60, st.suggestionsWords ?? 20));
    const sysPrompt = subUser(st.suggestionsPrompt || DEFAULT_SUGGESTIONS_PROMPT, pName)
      .replaceAll('{{count}}', String(count)).replaceAll('{{words}}', String(words));
    const swipeIdx = chatObj.messages[nodeId]?.activeSwipe ?? 0;
    const recent = getActivePath(chatObj.messages, nodeId).slice(-(st.suggestionsDepth ?? 6))
      .map(n => `${n.role === 'user' ? pName : 'Narrator'}: ${subUser(activeText(n), pName)}`)
      .join('\n\n');
    const key = { chatId: chatObj.id, nodeId, swipe: swipeIdx };
    setSuggestions({ ...key, loading: true, items: null });
    try {
      const out = await auxLogged('suggestions', {
        endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model,
        system: sysPrompt,
        user: `Recent scene:\n\n${recent}\n\n${count === 1 ? 'One option' : `${count} options`} for ${pName}:`,
        maxTokens: Math.min(500, 60 + count * words * 2), temperature: st.suggestionsTemp ?? 0.9, stop: st.stopStrings,
      });
      const items = out.split('\n')
        .map(l => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
        .filter(l => l.length > 0 && l.split(/\s+/).length <= Math.ceil(words * 1.5) && !/^\d+$/.test(l) && !/:$/.test(l))
        .slice(0, count);
      setSuggestions(s => (s?.chatId === key.chatId && s?.nodeId === key.nodeId)
        ? (items.length ? { ...key, loading: false, items } : null) : s);
    } catch {
      setSuggestions(s => (s?.chatId === key.chatId && s?.nodeId === key.nodeId) ? null : s);
    }
  }

  // ---- chat input / slash commands ----
  function sendUserMessage(c, content) {
    const { chat: c1, id: userId } = appendMessage(c, c.activeLeafId, 'user', content);
    const { chat: c2, id: asstId } = appendMessage(c1, userId, 'assistant', '');
    upsertChat(c2.id, { ...c2, updatedAt: Date.now() });
    runGeneration(c2, asstId, { fresh: true });
  }
  function handleContinue(c) {
    const path = getActivePath(c.messages, c.activeLeafId);
    const last = path[path.length - 1];
    if (last?.role === 'assistant' && activeText(last)) {
      runGeneration(c, last.id, { continuation: true });
    } else {
      const { chat: c1, id } = appendMessage(c, c.activeLeafId, 'assistant', '');
      upsertChat(c1.id, { ...c1, updatedAt: Date.now() });
      runGeneration(c1, id, { fresh: true });
    }
  }
  function handleInput(raw) {
    const c = ref.current.chats[ui.chatId];
    if (!c) return 'Select or create a chat first.';
    if (genRef.current) return 'Already generating — press Stop first.';
    if (auxBusy) return `Working… (${auxBusy})`;
    if (raw.startsWith('/')) {
      const sp = raw.indexOf(' ');
      const cmd = (sp === -1 ? raw : raw.slice(0, sp)).toLowerCase();
      const arg = sp === -1 ? '' : raw.slice(sp + 1).trim();
      if (cmd === '/ooc') {
        if (!arg) return 'Usage: /ooc <text>';
        sendUserMessage(c, `[OOC: ${arg}]`);
        return null;
      }
      if (cmd === '/continue') { handleContinue(c); return null; }
      if (cmd === '/pov') {
        if (!arg) return 'Usage: /pov <character name>';
        // Reframe one generation around another character. If a character-type
        // lore piece matches the name, it's force-injected (reason 'pov') so
        // the model sees that definition; otherwise the directive alone stands.
        const scen = ref.current.scenarios[c.scenarioId];
        const q = arg.toLowerCase();
        const chars = mergedLorePieces(scen, c).filter(p => p && p.enabled !== false && (p.type ?? 'lore') === 'character');
        const piece = chars.find(p => (p.title ?? '').trim().toLowerCase() === q)
          ?? chars.find(p => (p.title ?? '').trim().toLowerCase().includes(q));
        const { chat: c1, id } = appendMessage(c, c.activeLeafId, 'assistant', '');
        upsertChat(c1.id, { ...c1, updatedAt: Date.now() });
        runGeneration(c1, id, { fresh: true, pov: { name: piece?.title?.trim() || arg, pieceId: piece?.id ?? null } });
        return null;
      }
      if (cmd === '/improve') {
        if (!arg) return 'Usage: /improve <draft text>';
        improveDraft(c, arg);
        return null;
      }
      if (cmd === '/recap') {
        const n = Math.max(10, Math.min(500, parseInt(arg, 10) || 50));
        recapChat(c, n);
        return null;
      }
      if (cmd === '/memory') {
        const n = Math.max(10, Math.min(50, parseInt(arg, 10) || 30));
        memoryCommand(c, n);
        return null;
      }
      if (cmd === '/model') {
        const global = ref.current.settings.model;
        if (!arg)
          return `Effective model: ${c.settings?.model || global || '(none)'}${c.settings?.model ? ' (chat override)' : ' (global)'}`;
        saveChat({ ...c, settings: { ...(c.settings ?? {}), model: arg } });
        return `Chat model set to "${arg}" (this chat only, persisted).`;
      }
      if (cmd === '/theme') {
        const names = Object.values(THEMES).map(t => t.name).join(', ');
        if (!arg) return `Theme: ${THEMES[theme]?.name ?? theme}. Available: ${names}`;
        const q = arg.toLowerCase();
        const id = Object.keys(THEMES).find(k => k === q || THEMES[k].name.toLowerCase() === q)
          ?? Object.keys(THEMES).find(k => k.includes(q) || THEMES[k].name.toLowerCase().includes(q));
        if (!id) return `No theme matching "${arg}". Available: ${names}`;
        setTheme(id);
        return `Theme set to ${THEMES[id].name}.`;
      }
      return `Unknown command ${cmd}. Available: /ooc, /continue, /pov NAME, /improve, /recap N, /memory N, /model NAME, /theme NAME`;
    }
    sendUserMessage(c, raw);
    return null;
  }

  // ---- aux slash commands ----
  async function improveDraft(c, draft) {
    const { personas: pe, settings: st } = ref.current;
    const model = st.auxModel || st.model;
    if (!st.endpoint || !model) { setError('Configure an endpoint and model in Settings first.'); return; }
    const pers = c.personaId ? pe[c.personaId] : null;
    const pName = pers?.name?.trim() || 'User';
    const personaDesc = pers?.description?.trim() ? ` (${subUser(pers.description, pName)})` : '';
    const recent = getActivePath(c.messages, c.activeLeafId).slice(-4)
      .map(n => `${n.role === 'user' ? pName : 'Narrator'}: ${subUser(activeText(n), pName)}`)
      .join('\n\n');
    setAuxBusy('improve');
    try {
      const out = await auxLogged('improve', {
        endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model,
        system: subUser(st.improvePrompt || DEFAULT_IMPROVE_PROMPT, `${pName}${personaDesc}`),
        user: `${recent ? `Recent scene:\n\n${recent}\n\n` : ''}Draft:\n\n${draft}`,
        maxTokens: st.improveMaxTokens ?? 400, temperature: st.improveTemp ?? 0.7, stop: st.stopStrings,
      });
      if (!out) throw new Error('empty response from the model');
      setComposerInject({ text: out, nonce: Date.now() });
    } catch (e) {
      setError(`/improve failed: ${e.message ?? e}`);
    } finally {
      setAuxBusy(null);
    }
  }

  async function recapChat(c, n) {
    const { personas: pe, settings: st } = ref.current;
    const model = st.auxModel || st.model;
    if (!st.endpoint || !model) { setError('Configure an endpoint and model in Settings first.'); return; }
    const pName = (c.personaId && pe[c.personaId]?.name?.trim()) || 'User';
    const recent = getActivePath(c.messages, c.activeLeafId).slice(-n)
      .map(x => `${x.role === 'user' ? pName : 'Narrator'}: ${subUser(activeText(x), pName)}`)
      .join('\n\n');
    if (!recent.trim()) { setComposerInject({ hint: 'Nothing to recap yet.', nonce: Date.now() }); return; }
    setAuxBusy('recap');
    try {
      const out = await auxLogged('recap', {
        endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model,
        system: st.recapPrompt || DEFAULT_RECAP_PROMPT,
        user: `Roleplay excerpt (last ${n} messages):\n\n${recent}`,
        maxTokens: st.recapMaxTokens ?? 700, temperature: st.recapTemp ?? 0.4, stop: st.stopStrings,
      });
      if (!out) throw new Error('empty response from the model');
      setModal({ kind: 'recap', text: out });
    } catch (e) {
      setError(`/recap failed: ${e.message ?? e}`);
    } finally {
      setAuxBusy(null);
    }
  }

  async function memoryCommand(c, n) {
    setAuxBusy('memory');
    setComposerInject({ hint: 'Generating memory…', nonce: Date.now() });
    try {
      const text = await generateMemory(c, n);
      if (!text) { setComposerInject({ hint: 'Nothing to summarize yet.', nonce: Date.now() }); return; }
      const store = addMemory(c.memoryStore, text, Date.now(), ref.current.settings.memoryCap ?? MEMORY_CAP); // manual: cursor untouched
      saveChat({ ...c, memoryStore: { ...store, cursor: c.memoryStore?.cursor ?? 0 } });
      setComposerInject({ hint: `Memory saved (${store.memories.length} total).`, nonce: Date.now() });
    } catch (e) {
      setComposerInject({ hint: null, nonce: Date.now() });
      setError(`/memory failed: ${e.message ?? e}`);
    } finally {
      setAuxBusy(null);
    }
  }

  // ---- per-message actions ----
  const onEdit = (nodeId, text) => {
    const c = ref.current.chats[ui.chatId]; const n = c?.messages[nodeId];
    if (!n) return;
    const swipes = n.swipes.slice();
    swipes[n.activeSwipe] = { ...swipes[n.activeSwipe], text };
    saveChat({ ...c, messages: { ...c.messages, [nodeId]: { ...n, swipes, edited: true } } });
  };
  const onRegenerate = (nodeId) => {
    const c = ref.current.chats[ui.chatId]; const n = c?.messages[nodeId];
    if (!n || genRef.current) return;
    const swipes = [...n.swipes, { text: '', createdAt: Date.now(), modelId: null }];
    const c1 = { ...c, messages: { ...c.messages, [nodeId]: { ...n, swipes, activeSwipe: swipes.length - 1 } }, updatedAt: Date.now() };
    upsertChat(c1.id, c1);
    runGeneration(c1, nodeId);
  };
  // Regenerate from a token: new swipe whose text starts with tokens[0..i]
  // (+ chosen alternative), then continue generation from that prefix via the
  // existing continuation machinery (trailing assistant message = prefill).
  const onRegenFromToken = (nodeId, tokIdx, alt) => {
    const c = ref.current.chats[ui.chatId]; const n = c?.messages[nodeId];
    if (!n || genRef.current) return;
    const src = n.swipes[n.activeSwipe];
    const toks = src?.tokens;
    if (!toks?.length) return;
    const keep = toks.slice(0, alt == null ? tokIdx + 1 : tokIdx);
    const prefix = keep.map(t => t.text).join('') + (alt ?? '');
    const prefixToks = alt == null ? keep : [...keep, { text: alt, logprob: null, top: [] }];
    const swipes = [...n.swipes, { text: prefix, createdAt: Date.now(), modelId: null, tokens: prefixToks }];
    const c1 = { ...c, messages: { ...c.messages, [nodeId]: { ...n, swipes, activeSwipe: swipes.length - 1 } }, updatedAt: Date.now() };
    upsertChat(c1.id, c1);
    runGeneration(c1, nodeId, { continuation: true });
  };
  const onSwipe = (nodeId, dir) => {
    const c = ref.current.chats[ui.chatId]; const n = c?.messages[nodeId];
    if (!n) return;
    const next = Math.min(n.swipes.length - 1, Math.max(0, n.activeSwipe + dir));
    saveChat({ ...c, messages: { ...c.messages, [nodeId]: { ...n, activeSwipe: next } } });
  };
  const onSwipeTo = (nodeId, idx) => {
    const c = ref.current.chats[ui.chatId]; const n = c?.messages[nodeId];
    if (!n || idx < 0 || idx >= n.swipes.length) return;
    saveChat({ ...c, messages: { ...c.messages, [nodeId]: { ...n, activeSwipe: idx } } });
  };
  const onBranch = (nodeId) => {
    const c = ref.current.chats[ui.chatId];
    if (!c) return;
    const b = branchChat(c, nodeId); // deep-copies messages + memoryStore
    upsertChat(b.id, b);
    setUi(u => ({ ...u, chatId: b.id }));
  };
  const onRewind = (nodeId) => {
    const c = ref.current.chats[ui.chatId];
    if (c) saveChat(rewindChat(c, nodeId)); // rolls memoryStore back too
  };
  const onDeleteMsg = (nodeId) => {
    const c = ref.current.chats[ui.chatId]; const n = c?.messages[nodeId];
    if (!n?.parentId) return;
    const messages = deleteSubtree(c.messages, nodeId);
    const leaf = messages[c.activeLeafId] ? c.activeLeafId : n.parentId;
    saveChat({ ...c, messages, activeLeafId: leaf });
  };

  // ---- scenarios / personas / chats ----
  const onSaveScenario = (draft) => { upsertScenario(draft.id, draft); setModal(null); };
  const onDeleteScenario = (id) => {
    removeScenario(id);
    if (ui.scenarioId === id) setUi(u => ({ ...u, scenarioId: null }));
  };
  const createChat = (scenarioId, personaId, newPersonaName) => {
    let pid = personaId || null;
    if (!pid && newPersonaName.trim()) {
      pid = uid();
      upsertPersona(pid, { id: pid, name: newPersonaName.trim(), description: '' });
    }
    const scen = ref.current.scenarios[scenarioId];
    if (!scen) return;
    const c = newChat(scen, pid, settings?.dateFormat);
    upsertChat(c.id, c);
    setUi(u => ({ ...u, chatId: c.id, scenarioId }));
    setModal(null);
  };
  const onDeleteChat = (id) => {
    // Abort generation in flight for this chat before removing it.
    if (generating?.chatId === id) genRef.current?.abort.abort();
    removeChat(id);
    if (ui.chatId === id) setUi(u => ({ ...u, chatId: null }));
  };

  // Generate an assistant reply as a child of a user message (defaults to the
  // active leaf). A new assistant child becomes the active leaf, so repeated
  // calls create sibling assistant branches — same semantics as swipes.
  const onGenerateReply = (nodeId = null) => {
    const c = ref.current.chats[ui.chatId];
    if (!c || genRef.current) return;
    const parent = c.messages[nodeId ?? c.activeLeafId];
    if (!parent || parent.role !== 'user') return;
    const { chat: c1, id } = appendMessage(c, parent.id, 'assistant', '');
    upsertChat(c1.id, { ...c1, updatedAt: Date.now() });
    runGeneration(c1, id, { fresh: true });
  };

  // ---- export / import ----
  const onExportScenario = (id) =>
    downloadJSON(`fictionpad-scenario-${scenarios[id]?.name ?? id}.json`, { type: 'fictionpad-scenario', version: 1, data: scenarios[id] });
  const onExportChat = (c) =>
    downloadJSON(`fictionpad-chat-${c.name}.json`, { type: 'fictionpad-chat', version: 1, data: c });
  const onImport = async () => {
    const obj = await pickJSONFile();
    if (!obj) return;
    if (obj.__error) return setError(`Import failed: ${obj.__error}`);
    if (obj.type === 'fictionpad-scenario' && obj.data?.name != null) {
      const s = { ...obj.data, id: uid() };
      upsertScenario(s.id, s);
      setUi(u => ({ ...u, scenarioId: s.id }));
    } else if (obj.type === 'fictionpad-chat' && obj.data?.messages) {
      const c = { ...obj.data, id: uid() };
      upsertChat(c.id, c);
      setUi(u => ({ ...u, chatId: c.id, scenarioId: c.scenarioId }));
      if (!ref.current.scenarios[c.scenarioId])
        setError('Chat imported, but its scenario is not present in this browser.');
    } else {
      setError('Unrecognized JSON: expected a FictionPad scenario or chat export.');
    }
  };

  const onPreview = () => {
    const c = ref.current.chats[ui.chatId];
    if (!c) return;
    const st = ref.current.settings;
    // Same platform-prompt composition as runGeneration so the preview counts
    // the speaker/tools prompts too. Semantic activation is NOT rerun here
    // (async embeddings) — the preview is keyword-trigger lore only.
    const { messages, manifest: man } = assemblePrompt({
      scenario: ref.current.scenarios[c.scenarioId],
      persona: c.personaId ? ref.current.personas[c.personaId] : null,
      chat: c, settings: st, platformPrompt: buildPlatformPrompt(st),
    });
    // Surface the keyword-only caveat when smart pieces could have fired.
    if (st.embeddingModel && mergedLorePieces(ref.current.scenarios[c.scenarioId], c)
        .some(p => p && p.enabled !== false && !p.pinned && p.smart))
      man.warnings.push('Preview: semantic activation not run (embeddings) — smart pieces show keyword-trigger results only.');
    setManifest(man);
    setLastMessages(messages);
  };

  return html`
    <div class="app ${sidebarCollapsed ? '' : 'sb-open'} ${dragging ? 'dragging' : ''}">
      ${isMobile && (!sidebarCollapsed || ui.drawer) && html`
        <div class="scrim" onClick=${() => { if (!sidebarCollapsed) toggleSidebar(); closeDrawer(); }} />`}
      <div class="topbar">
        <div class="topbar-inner">
          ${sidebarCollapsed && html`<button class="btn small ghost" title="Show sidebar" onClick=${toggleSidebar}>»</button>`}
          <span class="title">${chat ? chat.name : 'FictionPad'}</span>
          ${chat && html`<button class="btn small ghost" title="Close chat"
            onClick=${() => setUi(u => ({ ...u, chatId: null, drawer: null }))}>✕</button>`}
          ${chat && html`<span class="sub">${scenarios[chat.scenarioId]?.name ?? '(missing scenario)'} · {{user}} = ${personaName}</span>`}
          <span class="spacer"></span>
          <button class="btn small ghost wide-only ${ui.drawer === 'inspector' ? 'active' : ''}"
            title="Context inspector" onClick=${() => toggleDrawer('inspector')}>Inspector</button>
          <button class="btn small ghost wide-only ${ui.drawer === 'memory' ? 'active' : ''}"
            title="Memories" onClick=${() => toggleDrawer('memory')}>Memory</button>
          <button class="btn small ghost narrow-only ${ui.drawer ? 'active' : ''}"
            title="Inspector / Memory panel"
            onClick=${() => ui.drawer ? closeDrawer() : toggleDrawer(lastDrawerTabRef.current ?? 'inspector')}>«</button>
        </div>
      </div>
      <div class="app-body">
      <${Sidebar}
        scenarios=${scenarios} chats=${chats}
        selectedScenarioId=${ui.scenarioId} selectedChatId=${ui.chatId}
        onSelectScenario=${(id) => setUi(u => ({ ...u, scenarioId: id }))}
        onSelectChat=${(id) => setUi(u => ({ ...u, chatId: id }))}
        onNewScenario=${() => setModal({ kind: 'scenario', scenario: newScenario() })}
        onEditScenario=${(id) => setModal({ kind: 'scenario', scenario: scenarios[id] })}
        onDeleteScenario=${onDeleteScenario}
        onNewChat=${(scenarioId) => setModal({ kind: 'newChat', scenarioId })}
        onExportScenario=${onExportScenario}
        onImport=${onImport}
        onOpenPersonas=${() => setModal({ kind: 'personas' })}
        onOpenSettings=${() => setModal({ kind: 'settings' })}
        collapsed=${sidebarCollapsed} onToggleCollapse=${toggleSidebar}
        onDeleteChat=${onDeleteChat}
        onChatAction=${chatAction}
        onChatContextMenu=${(chatId, x, y) => setCtxMenu({ chatId, x, y })}
        storageKind=${storageKind} saveRetrying=${saveRetrying}
        width=${sbW} onDragStart=${paneDragStart('left')} onResetWidth=${() => resetPaneWidth('left')} />
      <div class="center-col" style=${{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, paddingLeft: padL, paddingRight: padR }}>
        ${storageFailed && html`<div class="banner">IndexedDB unavailable — data will not persist across reloads.</div>`}
        ${error && html`<div class="banner">${error}<button class="btn small ghost" onClick=${() => setError(null)}>✕</button></div>`}
        <div style=${{ flex: 1, display: 'flex', minHeight: 0 }}>
          <${ErrorBoundary} name="chat">
            <${ChatPane} chat=${chat} persona=${persona} characterNames=${characterNames}
              dateFormat=${settings.dateFormat}
              generating=${generating?.chatId === chat?.id ? generating : null}
              suggestions=${suggestions}
              onPickSuggestion=${(s) => setComposerInject({ text: s, nonce: Date.now() })}
              onRerollSuggestions=${() => {
                const c = ref.current.chats[ui.chatId];
                if (c && !auxBusy) fetchSuggestions(c, c.activeLeafId);
              }}
              composerInject=${composerInject} auxBusy=${auxBusy}
              onSubmitInput=${handleInput} onStop=${() => genRef.current?.abort.abort()}
              onEdit=${onEdit} onRegenerate=${onRegenerate} onSwipe=${onSwipe} onSwipeTo=${onSwipeTo}
              onBranch=${onBranch} onRewind=${onRewind} onDeleteMsg=${onDeleteMsg}
              onGenerateReply=${onGenerateReply} onReply=${onGenerateReply} onRegenFromToken=${onRegenFromToken} />
          <//>
        </div>
      </div>
      <${RightDrawer}
        chat=${chat} tab=${ui.drawer} onTab=${(t) => setUi(u => ({ ...u, drawer: t }))}
        manifest=${manifest} realCounts=${realCounts} onPreview=${onPreview} auxLog=${auxLog}
        dateFormat=${settings.dateFormat} memoryEvery=${settings.memoryEvery}
        onUpdateChat=${saveChat}
        onSummarize=${() => chat && summarizeNow(chat)} summarizing=${summarizing}
        width=${dwW} onDragStart=${paneDragStart('right')} onResetWidth=${() => resetPaneWidth('right')}
        onClose=${closeDrawer} />
      </div>
    </div>
    ${modal?.kind === 'scenario' && html`
      <${ErrorBoundary} name="scenario editor"><${ScenarioEditor} scenario=${modal.scenario} onSave=${onSaveScenario} onClose=${() => setModal(null)} /><//>`}
    ${modal?.kind === 'personas' && html`
      <${ErrorBoundary} name="personas"><${PersonaManager} personas=${personas} onUpsert=${upsertPersona} onRemove=${removePersona} onClose=${() => setModal(null)} /><//>`}
    ${modal?.kind === 'settings' && html`
      <${ErrorBoundary} name="settings"><${SettingsModal} settings=${settings} theme=${theme} onThemeChange=${setTheme}
        accent=${accent} onAccentChange=${setAccent}
        onOpenLogitBias=${() => setModal({ kind: 'logitBias' })}
        storageKind=${storageKind} onUpload=${migrateUpload} onDownload=${migrateDownload}
        onSave=${(s) => { setSettings(prev => ({ ...s, logitBias: prev?.logitBias ?? s.logitBias ?? {} })); setModal(null); }}
        onClose=${() => setModal(null)} /><//>`}
    ${modal?.kind === 'logitBias' && html`
      <${ErrorBoundary} name="logit bias"><${LogitBiasModal}
        logitBias=${settings.logitBias ?? {}}
        onChange=${(map) => setSettings(s => ({ ...(s ?? {}), logitBias: map }))}
        onTokenize=${(prompt) => tokenize({ endpoint: effectiveEndpoint(settings, storageKind === 'server'), apiKey: settings.apiKey, serverToken: settings.serverToken, model: settings.model, prompt })}
        onClose=${() => setModal(null)} /><//>`}
    ${modal?.kind === 'newChat' && scenarios[modal.scenarioId] && html`
      <${ErrorBoundary} name="new chat"><${NewChatModal} scenario=${scenarios[modal.scenarioId]} personas=${personas}
        onCreate=${(pid, newName) => createChat(modal.scenarioId, pid, newName)}
        onClose=${() => setModal(null)} /><//>`}
    ${modal?.kind === 'recap' && html`
      <${ErrorBoundary} name="recap"><${RecapModal} text=${modal.text} onClose=${() => setModal(null)}
        onSaveMemory=${() => {
          const c = ref.current.chats[ui.chatId];
          if (c) {
            const store = addMemory(c.memoryStore, modal.text, Date.now(), settings.memoryCap ?? MEMORY_CAP);
            saveChat({ ...c, memoryStore: { ...store, cursor: c.memoryStore?.cursor ?? 0 } });
          }
        }} /><//>`}
    ${modal?.kind === 'chatPanel' && chats[modal.chatId] && html`
      <${ErrorBoundary} name="chat panel"><${ChatPanelModal}
        chat=${chats[modal.chatId]} tab=${modal.tab}
        onTab=${(tab) => setModal(m => ({ ...m, tab }))}
        manifest=${manifest} realCounts=${realCounts} onPreview=${onPreview} auxLog=${auxLog}
        personas=${personas} scenario=${scenarios[chats[modal.chatId]?.scenarioId]} onUpdateChat=${saveChat}
        dateFormat=${settings.dateFormat} memoryEvery=${settings.memoryEvery}
        onSummarize=${() => summarizeNow(chats[modal.chatId])} summarizing=${summarizing}
        onExport=${() => onExportChat(chats[modal.chatId])}
        onDelete=${() => { if (confirm(`Delete chat "${chats[modal.chatId].name}"?`)) { onDeleteChat(modal.chatId); setModal(null); } }}
        onClose=${() => setModal(null)} /><//>`}
    ${ctxMenu && html`
      <${ContextMenu} x=${ctxMenu.x} y=${ctxMenu.y} onClose=${() => setCtxMenu(null)}
        items=${[
          { label: 'Inspector', fn: () => chatAction(ctxMenu.chatId, 'inspector') },
          { label: 'Chat settings', fn: () => chatAction(ctxMenu.chatId, 'settings') },
          { label: 'Memories', fn: () => chatAction(ctxMenu.chatId, 'memory') },
          { label: 'Rename…', fn: () => chatAction(ctxMenu.chatId, 'rename') },
          { label: 'Export JSON', fn: () => chatAction(ctxMenu.chatId, 'export') },
          '-',
          { label: 'Delete…', fn: () => chatAction(ctxMenu.chatId, 'delete'), danger: true },
        ]} />`}
  `;
}

// Remember that this browser's data lives on the server. Used at boot to
// distinguish "never used server storage" (silent IndexedDB fallback is fine)
// from "server temporarily unreachable" (IndexedDB would look like total data
// loss — block with a gate instead).
