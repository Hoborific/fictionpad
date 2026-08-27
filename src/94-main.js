// ============================================================================
// APP — wires storage, collections, generation orchestration, and the panels.
// ============================================================================
// Chat factory. Scenario chats snapshot the scenario greeting; direct
// character chats (scenarioId null, chat.characterIds set) snapshot the
// character's greeting — possibly empty: the root node is parentless, so
// pruneInterrupted never drops it. Generation defaults (model/samplers) are
// likewise SNAPSHOT into the new chat's per-chat overrides from the entity
// the chat is rooted in — the scenario, or the character for direct chats
// (a character merely LINKED into a scenario chat never contributes defaults:
// multi-character scenes would make that ambiguous).
function newChat({ scenario = null, character = null, personaId = null, dateFormat } = {}) {
  const rootId = uid();
  const baseName = scenario?.name ?? (character ? `Chat with ${character.name}` : 'Chat');
  const defaultsFrom = scenario ?? character; // exactly one is set (createChat)
  const seedSettings = {};
  if (typeof defaultsFrom?.model === 'string' && defaultsFrom.model.trim())
    seedSettings.model = defaultsFrom.model.trim();
  if (defaultsFrom?.samplers && typeof defaultsFrom.samplers === 'object' && !Array.isArray(defaultsFrom.samplers) && Object.keys(defaultsFrom.samplers).length)
    seedSettings.samplers = { ...defaultsFrom.samplers };
  // Alternate greetings ride the root node's swipes: a fresh chat can swipe
  // through them like any other swipe. The rooted entity's alternates only —
  // in a scenario chat a linked character's greetings never leak in (the
  // scenario takes precedence). The primary greeting stays even when empty.
  const greetingTexts = [scenario?.greeting ?? character?.greeting ?? '',
    ...asArr(defaultsFrom?.alternateGreetings).filter(g => typeof g === 'string' && g.trim())];
  return {
    id: uid(), scenarioId: scenario?.id ?? null, personaId,
    ...(character ? { characterIds: [character.id] } : {}),
    name: `${baseName} — ${fmtDate(Date.now(), dateFormat)}`,
    customInstructions: '',
    rootMessageId: rootId, activeLeafId: rootId,
    messages: {
      [rootId]: { id: rootId, parentId: null, role: 'assistant', edited: false, activeSwipe: 0,
        swipes: greetingTexts.map(text => ({ text, createdAt: Date.now(), modelId: null })) },
    },
    memoryStore: { memories: [], cursor: 0 },
    settings: seedSettings,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

// Full system-prompt head: platform prompt + enabled feature prompts (multi-
// speaker, tool calling). Shared by runGeneration and the inspector preview
// so both count exactly what a generation would send.
function buildPlatformPrompt(st) {
  return [
    st.platformPrompt,
    ...(st.multiSpeaker !== false ? [(st.speakerPrompt ?? '').trim() || SPEAKER_PROMPT] : []),
    ...(st.toolsEnabled !== false ? [(st.toolsPrompt ?? '').trim() || TOOLS_PROMPT] : []),
    // generate_image rides the tool-call machinery (same parse/strip pass), so
    // a tools-disabled chat never advertises it — and never parses it either.
    ...(st.toolsEnabled !== false && st.imagesEnabled ? [(st.imagePrompt ?? '').trim() || DEFAULT_IMAGE_PROMPT] : []),
  ].filter(s => s?.trim()).join('\n\n');
}

// Side-pane sizing: manual widths persist in fictionpad.ui (sbWidth/dwWidth);
// when unset, a pane auto-sizes to consume the slack margin around the chat
// column: clamp(MIN, (viewport − chatW)/2 − gap, AUTO_MAX).
const PANE_MIN = 200, PANE_MAX_VW = 0.5, PANE_AUTO_MAX = 640, PANE_GAP = 16, PANE_OVERLAY_W = 340;

function Main({ storage, storageKind, storageFailed }) {
  // Request-time endpoint rewrite ("route via server") — never persisted.
  const effEp = (st) => effectiveEndpoint(st, storageKind === 'server');
  // Resolve a connection-role chain ('gen','aux' / 'aux' / 'embed' / 'image')
  // to a ready-to-call { endpoint, apiKey }: roleConn picks the per-role
  // override (blank fields inherit), effEp applies the route-via-server
  // rewrite. roleApi(st) with no roles = the main connection.
  const roleApi = (st, ...roles) => {
    const c = roleConn(st, ...roles);
    return { endpoint: effEp({ ...st, endpoint: c.endpoint }), apiKey: c.apiKey };
  };
  const [scenarios, upsertScenario, removeScenario] = useStoredMap(storage, 'Scenarios');
  const [personas, upsertPersona, removePersona] = useStoredMap(storage, 'Personas');
  const [chats, upsertChat, removeChat] = useStoredMap(storage, 'Chats');
  const [characters, upsertCharacter, removeCharacter] = useStoredMap(storage, 'Characters');
  const [settingsRaw, setSettings] = usePersistentState('fictionpad.settings', DEFAULT_SETTINGS);
  const settings = useMemo(() => ({
    ...DEFAULT_SETTINGS, ...(settingsRaw ?? {}),
    samplers: { ...DEFAULT_SETTINGS.samplers, ...(settingsRaw?.samplers ?? {}) },
    layerCaps: { ...DEFAULT_SETTINGS.layerCaps, ...(settingsRaw?.layerCaps ?? {}) },
  }), [settingsRaw]);
  // Settings sync via server storage: Meta/app.settings is the shared source
  // when server storage is active (server wins at boot, last-write-wins after).
  // serverToken is a per-device credential — stripped on upload, preserved
  // locally on download. apiKey syncs with the rest (single-user convenience).
  // localStorage remains the offline cache/fallback.
  const SETTINGS_SYNC_KEY = 'app.settings';
  const settingsSync = useRef({ adopted: false, lastWritten: null });
  useEffect(() => { // adopt the server copy once at boot
    if (storageKind !== 'server') return;
    const remote = storage.get('Meta', SETTINGS_SYNC_KEY);
    if (remote && typeof remote === 'object') {
      // serverToken is per-device — never adopted from the server. apiKey syncs
      // like any other setting; fall back to the local copy if the server has none yet.
      setSettings(prev => ({ ...remote, serverToken: prev?.serverToken ?? '', apiKey: remote.apiKey ?? prev?.apiKey ?? '' }));
      // Skip the pre-adoption upload: the write effect fires in this same
      // commit with the *local* settings — don't let them clobber the server.
      settingsSync.current.lastWritten = settingsRaw;
    }
    settingsSync.current.adopted = true;
  }, [storageKind]);
  useEffect(() => { // upload on every change (serverToken stripped; first boot seeds it)
    if (storageKind !== 'server' || !settingsSync.current.adopted) return;
    if (settingsSync.current.lastWritten === settingsRaw) return;
    settingsSync.current.lastWritten = settingsRaw;
    const { serverToken, ...rest } = settingsRaw ?? {};
    storage.set('Meta', SETTINGS_SYNC_KEY, rest);
  }, [settingsRaw, storageKind]);
  const [ui, setUi] = usePersistentState('fictionpad.ui', { scenarioId: null, chatId: null, drawer: null, sidebarCollapsed: false });
  const [theme, setTheme] = usePersistentState('fictionpad.theme', 'defaultTheme');
  const [accent, setAccent] = usePersistentState('fictionpad.accent', DEFAULT_ACCENT);
  useEffect(() => applyTheme(theme, accent), [theme, accent]);
  // Inspector data is cached per chat: opening another chat's panel shows ITS
  // last recorded manifest (or the empty state), never the wrong chat's.
  const [manifests, setManifests] = useState({}); // chatId -> { manifest, lastMessages }
  const setManifestFor = (chatId, man, msgs) =>
    setManifests(m => (chatId ? { ...m, [chatId]: { manifest: man, lastMessages: msgs } } : m));
  const manifest = manifests[ui.chatId]?.manifest ?? null;
  const lastMessages = manifests[ui.chatId]?.lastMessages ?? null; // chat-completions array behind manifest
  const [realCounts, setRealCounts] = useState(null); // /tokenize counts {static,lore,memory,total} | null
  const [modal, setModal] = useState(null);
  // Unsaved Settings draft, handed up when the modal detours into the logit-
  // bias editor — closing that editor returns to Settings with the draft
  // restored instead of silently losing it.
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [generating, setGenerating] = useState(null); // { chatId, nodeId }
  const [summarizing, setSummarizing] = useState(false);
  const [suggestions, setSuggestions] = useState(null); // { chatId, nodeId, swipe, loading, items } | null
  const [composerInject, setComposerInject] = useState(null); // { text?, hint?, nonce }
  const [auxBusy, setAuxBusy] = useState([]); // kinds of in-flight aux calls ('improve', 'generate', …)
  const auxCtls = useRef(new Set()); // AbortControllers of in-flight aux calls — Stop aborts them all
  const imgCtls = useRef(new Set()); // AbortControllers of in-flight image jobs — deliberately NOT auxBusy (never blocks the composer, Stop leaves them running)
  const [error, setError] = useState(null);
  const genRef = useRef(null); // { abort, chatId } — chatId lets background writers (image jobs) defer instead of being clobbered
  const scrollTargetRef = useRef(null); // { chatId, nodeId } — branch swap: scroll this msg into view, don't follow to the bottom

  // Aux-call observability: memory/lore-extract/suggestions//improve//recap are
  // separate requests that never touch the main context, so the manifest can't
  // show them. Keep a short session log (last 12) of what was sent and what
  // came back; the Inspector renders it as its own section. Entries are tagged
  // with the chat they were for — each inspector panel filters to its own chat.
  const [auxLog, setAuxLog] = useState([]);
  async function auxLogged(kind, args, chatId = null) {
    const entry = { kind, chatId, at: Date.now(), model: args.model ?? '', system: args.system ?? '', user: args.user ?? '' };
    // Every aux call is tracked: the composer shows ■ Stop (not Send) while
    // any are in flight, so a background call never overlaps the user's next
    // generation unnoticed; Stop aborts them all via auxCtls.
    const ctl = new AbortController();
    auxCtls.current.add(ctl);
    setAuxBusy(list => [...list, kind]);
    try {
      const out = await auxCall({ ...args, signal: ctl.signal });
      setAuxLog(log => [...log.slice(-11), { ...entry, ok: true, out: out ?? '' }]);
      return out;
    } catch (e) {
      setAuxLog(log => [...log.slice(-11), { ...entry, ok: false, out: describeApiError(e) }]);
      throw e;
    } finally {
      auxCtls.current.delete(ctl);
      setAuxBusy(list => { const i = list.indexOf(kind); return i < 0 ? list : [...list.slice(0, i), ...list.slice(i + 1)]; });
    }
  }

  // ✦ Generate (scenario/character editors): one aux call turns a free-text
  // request + the current draft (context, so "add a rival for Mia" extends
  // rather than replaces) into a sanitized field patch. The editor applies it
  // to its local draft — nothing persists until the editor's own Save. Errors
  // are thrown back to the generator modal, which shows them inline.
  async function runGen(kind, promptText, draft) {
    const st = ref.current.settings;
    const model = st.genModel || st.auxModel || st.model; // generator override → aux → chat
    const conn = roleApi(st, 'gen', 'aux'); // the connection chain mirrors the model chain
    if (!conn.endpoint || !model) throw new Error('Configure an endpoint and model in Settings first.');
    const isScenario = kind === 'scenario';
    // The RP length preset otherwise only reaches the chat assembler — aux
    // calls never see it, so pass the directive through as prose guidance
    // (the greeting is the field it matters for).
    const directive = (st.lengthDirective ?? LENGTH_PRESETS[st.responseLength ?? 'medium']?.directive)?.trim();
    const context = JSON.stringify(isScenario
      ? { name: draft.name, description: draft.description, tags: draft.tags,
          scenarioInstructions: draft.scenarioInstructions, backstory: draft.backstory, greeting: draft.greeting,
          lorePieces: (draft.lorePieces ?? []).map(({ type, title, content, keys, pinned }) => ({ type, title, content, keys, pinned })) }
      : kind === 'piece'
        ? (({ type, title, content, keys, pinned }) => ({ type, title, content, keys, pinned }))(draft)
        : { name: draft.name, content: draft.content, keys: draft.keys, greeting: draft.greeting });
    const out = await auxLogged('generate', {
      endpoint: conn.endpoint, apiKey: conn.apiKey, serverToken: st.serverToken, model,
      system: isScenario
        ? st.scenarioGenPrompt || DEFAULT_SCENARIO_GEN_PROMPT
        : kind === 'piece'
          ? st.pieceGenPrompt || DEFAULT_PIECE_GEN_PROMPT
          : st.characterGenPrompt || DEFAULT_CHARACTER_GEN_PROMPT,
      user: `Current draft (JSON — extend or change it per the request; return the complete updated object):\n${context}\n\nRequest: ${promptText}${directive ? `\n\nLength guidance for the prose fields (especially the greeting): ${directive}` : ''}`,
      maxTokens: st.genMaxTokens ?? 3000, temperature: st.genTemp ?? 0.9,
      // The generator rides the user's GLOBAL sampler set — registered
      // built-ins plus custom samplers (e.g. chat_template_kwargs.enable_thinking)
      // — filtered to registered keys like the RP path; the generator's own
      // temperature wins. Per-chat overrides don't apply outside a chat.
      samplers: { ...Object.fromEntries(
        Object.entries(enabledSamplers(st))
          .filter(([k]) => new Set(allSamplerFields(st).map(f => f.key)).has(k))),
        temperature: st.genTemp ?? 0.9 },
    });
    const obj = extractGenJSON(out);
    if (!obj) throw new Error('The model did not return valid JSON — try again or rephrase the request.');
    return isScenario ? sanitizeScenarioGen(obj) : kind === 'piece' ? sanitizePieceGen(obj) : sanitizeCharacterGen(obj);
  }

  // ✦ avatar generation (the avatar field in the character/scenario/persona
  // editors): step 1 condenses the card into a portrait prompt on the
  // generator model chain — a 'generate' aux call, so Stop aborts it like any
  // aux call; step 2 renders that prompt on the image connection (imgCtls —
  // never blocks the composer). AvatarField passes the live draft's name +
  // card at click time; errors rethrow to the caller.
  async function generateAvatarFor({ name, content }) {
    const st = ref.current.settings;
    const model = st.genModel || st.auxModel || st.model; // generator override → aux → chat
    const conn = roleApi(st, 'gen', 'aux');
    if (!conn.endpoint || !model) throw new Error('Configure an endpoint and model in Settings first.');
    const prompt = (await auxLogged('generate', {
      endpoint: conn.endpoint, apiKey: conn.apiKey, serverToken: st.serverToken, model,
      system: (st.avatarGenPrompt ?? '').trim() || DEFAULT_AVATAR_GEN_PROMPT,
      user: `Name: ${name}\n\n${content}`,
      maxTokens: st.genMaxTokens ?? 300, temperature: st.genTemp ?? 0.7,
    })).trim();
    const img = roleApi(st, 'image');
    const ctl = new AbortController();
    imgCtls.current.add(ctl);
    try {
      return await generateImage({
        endpoint: img.endpoint, // image connection falls back to the main one
        apiKey: img.apiKey, serverToken: st.serverToken,
        model: st.imageModel, prompt, size: st.imageSize, prefix: st.imagePrefix,
        backend: st.imageBackend, workflow: st.imageWorkflow, negative: st.imageNegative, signal: ctl.signal });
    } finally {
      imgCtls.current.delete(ctl);
    }
  }

  // The thunk the editors get — Main passes it only while image generation is
  // on, so the ✦ button stays hidden otherwise. Errors surface via the global
  // banner; AvatarField catches the rethrow and just clears its busy state.
  const generateAvatar = async (vals) => {
    try { return await generateAvatarFor(vals); }
    catch (e) { setError(describeApiError(e)); throw e; }
  };

  // Always-fresh refs for async generation loops (avoid stale closures).
  const ref = useRef({});
  ref.current = { scenarios, personas, chats, characters, settings };

  // Errors no longer auto-dismiss: the toast stays until the user closes it
  // (✕) or the next generation starts (cleared in runGeneration).
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
  // killed by a reload, stamp branch links on pre-branching chats, default to
  // the swipes the conversation actually continued from, and align the active
  // path. In-session browsing is unaffected.
  useEffect(() => {
    const c = ref.current.chats[ui.chatId];
    if (!c) return;
    // A live generation owns this chat's swipe state — pruning here would
    // strip its in-flight (unflagged) swipe out from under the stream.
    if (generating?.chatId === c.id) return;
    const next = activateBranch(applyUsedSwipes(normalizeBranchSwipes(pruneInterrupted(c))), c.activeLeafId, { descend: false });
    if (next !== c) upsertChat(next.id, next);
  }, [ui.chatId]);
  const persona = chat?.personaId ? personas[chat.personaId] : null;
  const personaName = persona?.name?.trim() || 'User';
  // Memo keyed on stable identities — NOT the whole chat object, which gets a
  // fresh identity per streamed token and would defeat MessageItem's memo.
  // Names change only when the scenario, the chat's lore overlay/character
  // links, or the characters map actually change.
  const chatScenario = chat ? scenarios[chat.scenarioId] : null;
  const characterNames = useMemo(
    () => characterNamesOf(chatScenario, chat, characters),
    [chatScenario, chat?.lorePieces, chat?.characterIds, characters]);
  // Slash-command argument completion domains (composer hint chips + Tab):
  // /pov completes from the chat's known characters — the exact list the /pov
  // handler matches against — /theme from theme names, /model from model ids
  // seen by /v1/models fetches (modelCtxs keys).
  const cmdArgs = useMemo(() => ({
    '/pov': characterNames,
    '/theme': Object.values(THEMES).map(t => t.name),
    '/model': Object.keys(settings.modelCtxs ?? {}),
  }), [characterNames, settings.modelCtxs]);
  // Speaker-name colour overrides (global character cards with an explicit
  // colour), keyed by lowercase name — everything else falls back to the
  // name-hash hue in MessageItem.
  const characterColors = useMemo(() => Object.fromEntries(
    Object.values(characters ?? {}).filter(c => c?.color && c.name?.trim())
      .map(c => [c.name.trim().toLowerCase(), c.color])), [characters]);
  // Avatar images: linked global character cards with one set (scenario ∪
  // chat links — an UNLINKED card never speaks, so it must never lend its
  // avatar), keyed by lowercase name, then the scenario's and the chat's
  // character-type lore pieces, and finally the active chat's persona. Each
  // entry is { src, full } — the 256² thumb for the column/chips, the
  // uncropped ≤1024 companion (avatarFull || avatar) for the click-to-expand
  // lightbox. A piece overlays by NAME: with an avatar it replaces the
  // lower-priority entry, WITHOUT one it still shadows the name (a same-named
  // chat/scenario piece wins the collision — its missing avatar is
  // authoritative, never a fall-through to the card's image). Same
  // identity-stability care as characterColors (MessageItem's memo compares
  // props by identity).
  const characterAvatars = useMemo(() => {
    const linked = new Set([...(chatScenario?.characterIds ?? []), ...(chat?.characterIds ?? [])]);
    const map = Object.fromEntries(
      Object.values(characters ?? {}).filter(c => c?.avatar && c.name?.trim() && linked.has(c.id))
        .map(c => [c.name.trim().toLowerCase(), { src: c.avatar, full: c.avatarFull || c.avatar }]));
    // Deliberately NOT scoped by pieceVisibleAt: a same-name piece on a
    // hidden branch leaking its avatar is the only bleed vector, and such
    // cross-branch name collisions are vanishingly rare.
    for (const p of [...(chatScenario?.lorePieces ?? []), ...(chat?.lorePieces ?? [])]) {
      if (p?.type !== 'character' || !(p.title ?? '').trim()) continue;
      const key = p.title.trim().toLowerCase();
      if (p.avatar) map[key] = { src: p.avatar, full: p.avatarFull || p.avatar };
      else delete map[key]; // the winning piece has no image — show no image
    }
    if (persona?.avatar && persona.name?.trim())
      map[persona.name.trim().toLowerCase()] = { src: persona.avatar, full: persona.avatarFull || persona.avatar };
    return map;
  }, [characters, chatScenario, chat?.lorePieces, persona]);
  // The avatar column shows only when something this chat can speak as has an
  // image: a linked character (scenario ∪ chat links), a scenario- or
  // chat-owned character piece, or the active persona.
  const chatHasAvatars = useMemo(() => {
    if (persona?.avatar) return true;
    const pieceHas = [...(chatScenario?.lorePieces ?? []), ...(chat?.lorePieces ?? [])]
      .some(p => p?.type === 'character' && p.avatar);
    if (pieceHas) return true;
    return [...(chatScenario?.characterIds ?? []), ...(chat?.characterIds ?? [])]
      .some(id => characters?.[id]?.avatar);
  }, [chatScenario, chat?.characterIds, chat?.lorePieces, characters, persona]);
  const sidebarCollapsed = ui.sidebarCollapsed ?? (window.innerWidth <= 700); // phones start with the drawer closed
  const toggleSidebar = () => { setPeek(null); setUi(u => ({ ...u, sidebarCollapsed: !sidebarCollapsed })); };
  // Right drawer: ui.drawer is the open tab ('inspector' | 'samplers' | 'memory' | 'chat') or null.
  const toggleDrawer = (tab) => { setPeek(null); setUi(u => ({ ...u, drawer: u.drawer === tab ? null : tab })); };
  const closeDrawer = () => { setPeek(null); setUi(u => (u.drawer ? { ...u, drawer: null } : u)); };
  const lastDrawerTabRef = useRef('inspector'); // edge-swipe reopens the last-used tab
  if (ui.drawer) lastDrawerTabRef.current = ui.drawer;
  // Desktop edge-hover peek (settings.edgePeek, default on): hovering a thin
  // strip at the screen edge pops the collapsed pane out as a TEMPORARY
  // overlay — no ui.* state changes, pointer-leave closes it, and any real
  // toggle (above) pins/unpins as usual. A short entry delay keeps stray
  // mouse sweeps past the edge from flashing the pane.
  const [peek, setPeek] = useState(null); // 'left' | 'right' | null
  const [peekTab, setPeekTab] = useState(null); // tab chosen inside a drawer peek — session-only, never pins
  const peekTimer = useRef(null);
  const peekEnter = (side) => (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek(side), 90);
  };
  const peekCancel = () => clearTimeout(peekTimer.current);
  // Shallow settings patch (e.g. samplers from the panel's Samplers tab).
  const updateSettings = (patch) => setSettings(prev => ({ ...(prev ?? {}), ...patch }));
  // touch:false for pure metadata edits (rename, options) — the sidebar sorts
  // by updatedAt, and a rename shouldn't teleport the chat to the top.
  // The write is ALSO mirrored into ref.current.chats immediately (same rule
  // as commit()): React flushes state only after the current task, so an
  // async merge-on-write pass (memory, extraction, enrichment) or the next
  // generation reading ref in between would rebuild from the pre-write
  // snapshot and silently clobber this write.
  const saveChat = useCallback((c, { touch = true } = {}) => {
    const next = touch ? { ...c, updatedAt: Date.now() } : c;
    ref.current.chats = { ...ref.current.chats, [next.id]: next };
    upsertChat(next.id, next);
  }, [upsertChat]);

  // Writes that failed to persist and are queued for retry (Task: never drop).
  // failed = non-null once the storage layer gives up (quota / repeated
  // failure) — surfaced as a persistent banner.
  const [saveRetrying, setSaveRetrying] = useState(false);
  const [saveFailed, setSaveFailed] = useState(null);
  useEffect(() => {
    const on = (e) => { setSaveRetrying(!!e.detail?.retrying); setSaveFailed(e.detail?.failed ?? null); };
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
  // Narrow-viewport fallback: pad the center column with a pane's actual
  // width only when the slack margin can't contain it — chat never hides.
  const MOBILE_BP = 700;
  const isMobile = viewportW <= MOBILE_BP;
  // Pane contention breakpoint: when the slack margin can't hold even a
  // minimum-width pane on BOTH sides of the chat column, the panes stop
  // sharing space and become true overlays over the chat (scrim + tap-to-
  // close, auto-collapse on chat select, touch edge swipes) — the phone
  // behavior — instead of squishing the chat column. Includes phones.
  const PANE_OVERLAY_BP = chatW + 2 * (PANE_MIN + PANE_GAP);
  const overlayPanes = viewportW <= PANE_OVERLAY_BP;
  // Auto width: docked panes fill the slack margin around the chat column;
  // overlay panes take a fixed comfortable width (PANE_OVERLAY_W, mirroring
  // the phone overlay's 340 px cap) — enough for the content, no point
  // covering more chat than needed. (Phones override all of this with the
  // 85vw CSS rule; manual drags always win.)
  const autoPaneW = clampPane(overlayPanes ? PANE_OVERLAY_W : Math.min((viewportW - chatW) / 2 - PANE_GAP, PANE_AUTO_MAX));
  const sbW = sidebarCollapsed ? 0 : clampPane(ui.sbWidth ?? autoPaneW);
  const dwW = ui.drawer ? clampPane(ui.dwWidth ?? autoPaneW) : 0;
  // Edge-hover peek is mouse territory; a peek never changes the persisted pane
  // state and must not shift the center column (sbW/dwW stay at their real
  // values — the peeked pane is a pure overlay).
  const peekLeft = peek === 'left' && sidebarCollapsed && !isMobile && settings.edgePeek !== false;
  const peekRight = peek === 'right' && !ui.drawer && !isMobile && settings.edgePeek !== false;
  useEffect(() => { if (isMobile || settings.edgePeek === false) setPeek(null); }, [isMobile, settings.edgePeek]);
  const padL = !overlayPanes && viewportW < chatW + 2 * sbW ? sbW : 0;
  const padR = !overlayPanes && viewportW < chatW + 2 * dwW ? dwW : 0;
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

  // ---- edge swipes (overlay-pane mode): open/close the two overlay panes ----
  // Left edge → swipe right opens the sidebar; right edge → swipe left opens
  // the Inspector/Memory drawer. Message rows (.msg) are ALWAYS bubble swipe
  // territory — pane gestures never start there, and with a pane open only
  // touches on the pane/scrim itself swipe it shut (scrim tap also closes).
  // Otherwise pane gestures steal bubble swipes near the edges, which reads
  // as "the swipe directions are backwards".
  const navStateRef = useRef({ overlay: overlayPanes, collapsed: sidebarCollapsed, drawer: ui.drawer });
  navStateRef.current = { overlay: overlayPanes, collapsed: sidebarCollapsed, drawer: ui.drawer, lastDrawerTab: lastDrawerTabRef.current };
  useEffect(() => {
    let g = null;
    const down = (e) => {
      if (e.pointerType === 'mouse') return;
      const st = navStateRef.current;
      if (!st.overlay) return; // pane gestures exist in overlay mode only (phones / contended widths)
      if (e.target.closest?.('.msg')) return; // message rows: bubble navigation only
      if (st.collapsed && !st.drawer) {
        // Both panes closed: an open gesture must start on a screen edge.
        const edge = e.clientX <= 24 ? 'left' : e.clientX >= window.innerWidth - 24 ? 'right' : null;
        if (edge) g = { id: e.pointerId, x: e.clientX, y: e.clientY, edge };
      } else {
        // A pane is open: swipe-shut starts only on the pane CHROME — the pane
        // element itself, its head, the resize handle, empty scroll-container
        // padding, or the scrim. Starting on scrollable CONTENT or a control
        // must not close the pane (a horizontal scroll of a wide inspector
        // table is not a "close" gesture).
        const pane = e.target.closest?.('.sidebar, .drawer');
        const scrollBox = e.target.closest?.('.scroll, .pbody');
        const onChrome = e.target.closest?.('.scrim')
          || (pane && (e.target === pane || e.target === scrollBox))
          || (pane && e.target.closest?.('.head, .pane-handle') && !e.target.closest?.('button, input, select, textarea, a'));
        if (onChrome) g = { id: e.pointerId, x: e.clientX, y: e.clientY };
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
  // The panel is a modal view into a chat — it must NOT switch the open chat,
  // or the main pane and the right drawer would jump to it under the modal.
  const openChatPanel = (chatId, tab) => setModal({ kind: 'chatPanel', chatId, tab });
  const chatAction = (chatId, action) => {
    const c = ref.current.chats[chatId];
    if (!c) return;
    switch (action) {
      case 'inspector': return openChatPanel(chatId, 'inspector'); // panel overview: context inspector
      case 'branches': return setModal({ kind: 'branches', chatId });
      case 'memory': return openChatPanel(chatId, 'memory');
      case 'settings': return openChatPanel(chatId, 'chat'); // per-chat settings live on the Chat tab
      case 'rename': {
        const name = prompt('Rename chat', c.name);
        if (name?.trim()) saveChat({ ...c, name: name.trim() }, { touch: false });
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
  // Shared memory-card generation (auto-summarize + /memory). Returns the note
  // text (≤ memoryMaxChars), or null when there's nothing to summarize.
  // Throws on endpoint/HTTP errors.
  // Windows are independent (no message overlap) but the pass sees the newest
  // prior cards as read-only context and is asked for NEW developments only —
  // a rolling rewrite would drift and can't roll back per-position, and
  // overlapping windows would double-record the same events.
  const MEM_PRIOR_MAX = 10, MEM_PRIOR_CHARS = 3000; // prior-cards context: newest N, whole cards past the char budget dropped oldest-first
  async function generateMemory(chatObj, messageCount = null) {
    const { personas: pe, settings: st } = ref.current;
    const model = st.auxModel || st.model;
    const conn = roleApi(st, 'aux');
    if (!conn.endpoint || !model) throw new Error('Configure an endpoint and model in Settings first.');
    const every = st.memoryEvery ?? MEMORY_EVERY;
    const pName = (chatObj.personaId && pe[chatObj.personaId]?.name?.trim()) || 'User';
    const path = getActivePath(chatObj.messages, chatObj.activeLeafId);
    const recent = path.slice(-(messageCount ?? every))
      .map(n => `${n.role === 'user' ? pName : 'Character'}: ${subUser(activeText(n), pName)}`)
      .join('\n\n');
    if (!recent.trim()) return null;
    const maxChars = st.memoryMaxChars ?? 5000;
    const priorTexts = (chatObj.memoryStore?.memories ?? []).slice(-MEM_PRIOR_MAX).map(m => m.text);
    while (priorTexts.length > 1 && priorTexts.join('\n').length > MEM_PRIOR_CHARS) priorTexts.shift();
    const prior = priorTexts.length
      ? `Memory notes already recorded (do not repeat these):\n${priorTexts.map(t => `- ${t}`).join('\n')}\n\n` : '';
    const out = await auxLogged('memory', {
      endpoint: conn.endpoint, apiKey: conn.apiKey, serverToken: st.serverToken, model,
      system: subUser(st.memoryPrompt || DEFAULT_MEMORY_PROMPT, pName).replaceAll('{{chars}}', String(maxChars)),
      user: `${prior}Recent conversation:\n\n${recent}\n\nMemory note (max ${maxChars} characters${prior ? '; new developments only' : ''}):`,
      maxTokens: st.memoryMaxTokens ?? 1500, temperature: st.memoryTemp ?? 0.3, stop: st.stopStrings,
    }, chatObj.id);
    return out.slice(0, maxChars) || null;
  }
  // Append a memory to a chat's store, stamped with atLen (the chat's current
  // active-path message count) so rewind keeps memories by position, not
  // timestamp (see rewindChat), and with atMsg (the active leaf) so the
  // assembler scopes it to this branch. Stamped at creation (see addMemory).
  const pushMemory = (c, text) =>
    addMemory(c.memoryStore, text, Date.now(), ref.current.settings.memoryCap ?? MEMORY_CAP,
      getActivePath(c.messages, c.activeLeafId).length, c.activeLeafId);
  async function summarizeNow(chatObj) {
    setSummarizing(true);
    try {
      const text = await generateMemory(chatObj);
      if (text) {
        // Merge-on-write: the chat may have changed (or been deleted) during
        // the aux call — re-read it and overwrite only memoryStore.
        const cur = ref.current.chats[chatObj.id];
        if (cur)
          saveChat({ ...cur, memoryStore: { ...pushMemory(cur, text),
            cursor: getActivePath(cur.messages, cur.activeLeafId).length } });
      }
    } catch (e) {
      // Degrade like lore extraction: warn and advance the cursor — a failing
      // aux endpoint must not re-banner after every generation.
      console.warn('Memory summarization failed:', e);
      const cur = ref.current.chats[chatObj.id];
      if (cur)
        saveChat({ ...cur, memoryStore: { ...(cur.memoryStore ?? { memories: [], cursor: 0 }),
          cursor: getActivePath(cur.messages, cur.activeLeafId).length } });
    } finally {
      setSummarizing(false);
    }
  }
  function maybeSummarize(chatObj) {
    const every = ref.current.settings.memoryEvery ?? MEMORY_EVERY;
    const pathLen = getActivePath(chatObj.messages, chatObj.activeLeafId).length;
    if (pathLen - (chatObj.memoryStore?.cursor ?? 0) >= every) summarizeNow(chatObj);
  }

  // ---- emergent lore extraction ----
  // On the memory cadence, an aux call proposes up to 3 NEW lore pieces from
  // the recent conversation. 'queue' mode (default): proposals wait for review
  // in chat settings. 'auto': applied straight to chat lore. 'off': nothing.
  // Failures degrade silently (console.warn) and the cursor still advances.
  async function maybeExtractLore(chatObj) {
    const { scenarios: sc, personas: pe, settings: st } = ref.current;
    const scen = sc[chatObj.scenarioId];
    const mode = scen?.emergentLore ?? 'queue';
    const conn = roleApi(st, 'aux');
    if (mode === 'off' || !conn.endpoint) return;
    const model = st.auxModel || st.model;
    if (!model) return;
    const path = getActivePath(chatObj.messages, chatObj.activeLeafId);
    const pathLen = path.length;
    const every = st.memoryEvery ?? MEMORY_EVERY;
    if (pathLen - (chatObj.emergentCursor ?? 0) < every) return;
    // Merge-on-write: re-read the chat at save time (a generation may have
    // advanced it during the aux call) and apply the lore changes to the
    // CURRENT object, so only lorePieces/loreQueue/emergentCursor are
    // overwritten. Chat deleted mid-call → drop the write.
    const advance = (fn) => {
      const cur = ref.current.chats[chatObj.id];
      if (cur) saveChat({ ...fn(cur), emergentCursor: pathLen });
    };
    const pName = (chatObj.personaId && pe[chatObj.personaId]?.name?.trim()) || 'User';
    const recent = path.slice(-every)
      .map(n => `${n.role === 'user' ? pName : 'Narrator'}: ${subUser(activeText(n), pName)}`)
      .join('\n\n');
    if (!recent.trim()) return;
    const titles = mergedLorePieces(scen, chatObj, ref.current.characters).map(p => (p.title ?? '').trim()).filter(Boolean);
    try {
      const out = await auxLogged('lore-extract', {
        endpoint: conn.endpoint, apiKey: conn.apiKey, serverToken: st.serverToken, model,
        system: (st.loreExtractPrompt || DEFAULT_LORE_EXTRACT_PROMPT)
          .replaceAll('{{max}}', String(Math.max(1, st.loreExtractMax ?? 5))),
        user: `Existing lore: ${titles.join(', ') || '(none)'}\n\nRecent conversation:\n\n${recent}\n\nJSON array:`,
        maxTokens: st.loreExtractMaxTokens ?? 1500, temperature: st.loreExtractTemp ?? 0.3, stop: st.stopStrings,
      }, chatObj.id);
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
        .slice(0, Math.max(1, st.loreExtractMax ?? 5));
      if (fresh.length) {
        advance((cur) => {
          let work = cur;
          if (mode === 'auto') {
            // Stamp with the live leaf (+ its viewed swipe): auto-mode pieces
            // stay scoped to the branch they were extracted from — derivation
            // replaces the old atLen rewind cutoff.
            work = applyToolCalls(work, fresh.map(p => ({ name: 'add_lore', args: p })),
              { now: Date.now(), atLen: pathLen, nodeId: cur.activeLeafId ?? null,
                createdSwipe: cur.messages?.[cur.activeLeafId]?.activeSwipe ?? null }).chat;
          } else {
            for (const p of fresh) work = queueLorePiece(work, { ...p, source: 'extract', atLen: pathLen });
          }
          return work;
        });
        return;
      }
      advance((c) => c);
    } catch (e) {
      console.warn('Emergent lore extraction failed:', e);
      advance((c) => c);
    }
  }

  // ---- character enrichment (experimental, settings.toolsEnrich) ----
  // Newly tool-registered characters get fleshed out by the ✦ generator
  // ('piece' kind) — one aux call per new character, all concurrent, after
  // the generation completes. Only CONTENT is rewritten and keys are merged;
  // the title is never touched — the registered name is the speaker-matching
  // key and must not drift. Failures keep the original description. The
  // rewrite appends a stamped revision (universal rollback rule), scoped to
  // the registering swipe — a replaced take keeps its short description.
  async function maybeEnrichCharacters(chatObj, nodeId, toolResults) {
    const fresh = (toolResults ?? []).filter(r => r.name === 'register_character' && r.ok
      && String(r.note ?? '').startsWith('registered character'));
    await Promise.all(fresh.map(async (r) => {
      const name = String(r.args?.name ?? '').trim();
      if (!name) return;
      const piece = ((ref.current.chats[chatObj.id]?.lorePieces) ?? []).find(p => p.createdBy === nodeId
        && p.type === 'character' && (p.title ?? '').trim().toLowerCase() === name.toLowerCase());
      if (!piece) return; // user-deleted meanwhile (rollback never removes pieces)
      try {
        const patch = await runGen('piece',
          'Flesh out this newly introduced character into a full reference card — appearance, personality, motives, voice. Keep the name and their role in the scene recognizable.',
          { type: 'character', title: piece.title, content: piece.content, keys: piece.keys, pinned: piece.pinned });
        // Merge-on-write: re-read at save time; drop the write if the chat or
        // piece vanished (user delete) in between.
        const cur = ref.current.chats[chatObj.id];
        if (!cur || !(cur.lorePieces ?? []).some(p => p.id === piece.id)) return;
        const atLen = getActivePath(cur.messages, cur.activeLeafId).length;
        const next = { ...cur, lorePieces: cur.lorePieces.map(p => {
          if (p.id !== piece.id) return p;
          const keys = [...new Set([...(p.keys ?? []), ...(patch.keys ?? [])])].slice(0, 5);
          if (!patch.content || patch.content === p.content) return { ...p, keys };
          // Universal rollback rule: enrichment is an app-initiated content
          // mutation like any tool write, so it appends a stamped revision.
          // The stamp mirrors the registration revision (node + swipe), so
          // each take of the reply views its own enrichment state and a
          // replaced swipe keeps the short description it was written with.
          const lastRev = Array.isArray(p.revisions) && p.revisions.length
            ? p.revisions[p.revisions.length - 1] : null;
          const revSwipe = lastRev?.createdSwipe ?? p.createdSwipe ?? null;
          const revisions = [...(Array.isArray(p.revisions) ? p.revisions : [{
            content: p.content ?? '', keys: Array.isArray(p.keys) ? p.keys : [],
            atLen: Number.isFinite(p.atLen) ? p.atLen : null,
            createdAt: Number.isFinite(p.createdAt) ? p.createdAt : null,
            createdBy: p.createdBy ?? null,
            createdSwipe: Number.isInteger(p.createdSwipe) ? p.createdSwipe : null }]),
            { content: patch.content, keys, atLen, createdAt: Date.now(), createdBy: p.createdBy ?? null,
              ...(Number.isInteger(revSwipe) ? { createdSwipe: revSwipe } : {}) }];
          return { ...p, content: patch.content, keys, revisions };
        }) };
        // touch:false — a background lore write shouldn't re-sort the sidebar.
        // saveChat syncs ref.current.chats itself, so a sibling enrichment or
        // the next generation's commit() can't rebuild from the pre-write
        // snapshot and drop this piece.
        saveChat(next, { touch: false });
      } catch (e) { console.warn(`Character enrichment failed for "${name}":`, e); }
    }));
  }

  // ---- avatar enrichment (settings.toolsEnrich + settings.imagesEnabled) ----
  // Companion to maybeEnrichCharacters: a newly tool-registered character also
  // gets a portrait, rendered from its registered card (the enrichment text
  // pass races this one — whichever content the piece holds at fire time is
  // fine). Same filter, same fire-and-forget concurrency, same silent
  // degradation. No rollback stamps needed: the piece's own createdBy/
  // createdSwipe scope already hides it on other branches and replaced
  // swipes, and rollback never deletes pieces — the merge-on-write guard
  // only races a user delete.
  async function maybeEnrichAvatars(chatObj, nodeId, toolResults) {
    const fresh = (toolResults ?? []).filter(r => r.name === 'register_character' && r.ok
      && String(r.note ?? '').startsWith('registered character'));
    await Promise.all(fresh.map(async (r) => {
      const name = String(r.args?.name ?? '').trim();
      if (!name) return;
      const piece = ((ref.current.chats[chatObj.id]?.lorePieces) ?? []).find(p => p.createdBy === nodeId
        && p.type === 'character' && (p.title ?? '').trim().toLowerCase() === name.toLowerCase());
      if (!piece || piece.avatar) return; // user-deleted meanwhile, or already has one
      try {
        const src = await generateAvatarFor({ name: piece.title, content: piece.content });
        const thumb = downscaleImageToDataURL(await loadImage(src), 256);
        // Merge-on-write: re-read at save time; drop the write if the chat or
        // piece vanished (user delete) or the piece already has an avatar
        // (the user beat us to it) in between.
        const cur = ref.current.chats[chatObj.id];
        const live = (cur?.lorePieces ?? []).find(p => p.id === piece.id);
        if (!live || live.avatar) return;
        const next = { ...cur, lorePieces: cur.lorePieces.map(p =>
          p.id === piece.id ? { ...p, avatar: thumb, avatarFull: src } : p) };
        // touch:false — a background lore write shouldn't re-sort the sidebar
        // (saveChat syncs ref.current.chats itself; see maybeEnrichCharacters).
        saveChat(next, { touch: false });
      } catch (e) { console.warn(`Avatar enrichment failed for "${name}":`, e); }
    }));
  }

  // ---- image generation (/image command, v4.10 phase 3) ----
  // One job fills one swipe's pending images entry, merge-on-write: the chat,
  // node or swipe may have vanished (rewind, delete, regenerate) while the
  // backend worked — then the write is dropped. Errors land on the entry as
  // { error: <message> } (healImageEntry's reload debris stays { error: true })
  // AND raise the sticky error toast — the bubble's failure note alone read as
  // a silent failure (the reason used to die in console.warn).
  // The pending entry is matched by `slot` (its placement id): two jobs on
  // DIFFERENT slots of the same swipe may run concurrently and must not
  // cross-patch.
  async function runImageJob(chatId, nodeId, swipeIdx, { prompt, caption = '', slot }) {
    const st = ref.current.settings;
    const { endpoint: ep, apiKey: key } = roleApi(st, 'image');
    const ctl = new AbortController();
    imgCtls.current.add(ctl);
    // patch: rebuild the chat with the pending entry at (nodeId, swipeIdx)
    // replaced by `entry`; returns false when the target vanished.
    const patch = async (makeEntry) => {
      // A live generation owns this chat's message tree: its per-token
      // applyText and the finally's commit() rebuild `messages` from a
      // start-of-generation snapshot and would silently revert this write on
      // the next token (the rule regenImage/swipeImage/onEdit refuse on).
      // The image result is already in hand and the merge below re-reads
      // ref.current, so waiting out the stream costs nothing.
      while (genRef.current?.chatId === chatId)
        await new Promise(r => setTimeout(r, 250));
      const cur = ref.current.chats[chatId];
      const node = cur?.messages?.[nodeId];
      const swipe = node?.swipes?.[swipeIdx];
      const entry = swipe?.images?.find(e => e?.pending && e.slot === slot);
      if (!cur || !node || !swipe || !entry) return false;
      const images = swipe.images.map(e => e === entry ? makeEntry(entry) : e);
      const swipes = node.swipes.map((s, i) => i === swipeIdx ? { ...s, images } : s);
      saveChat({ ...cur, messages: { ...cur.messages, [nodeId]: { ...node, swipes } } }, { touch: false });
      return true;
    };
    try {
      const src = await generateImage({ endpoint: ep, apiKey: key, serverToken: st.serverToken,
        model: st.imageModel, prompt, size: st.imageSize, prefix: st.imagePrefix,
        backend: st.imageBackend, workflow: st.imageWorkflow, negative: st.imageNegative, signal: ctl.signal });
      // keep the original `at` — and `pos` (where the model placed the block)
      await patch((entry) => ({ src, prompt, caption, at: entry.at, slot: entry.slot,
        ...(entry.pos !== undefined ? { pos: entry.pos } : {}) }));
    } catch (e) {
      const msg = describeApiError(e);
      console.warn(msg);
      setError(`Image generation failed: ${msg}`); // the sticky toast — a broken workflow must not fail silently
      await patch((entry) => {
        const out = {};
        for (const k of ['src', 'prompt', 'caption', 'at', 'pos', 'slot']) if (entry[k] !== undefined) out[k] = entry[k];
        out.error = msg; // string reason on the bubble's failure note (healImageEntry's reload debris stays boolean true)
        return out;
      });
    } finally {
      imgCtls.current.delete(ctl);
    }
  }

  // ▶⁺ on an image slot: re-roll JUST that image — same prompt (the slot's
  // first take is the base; prompt/caption/pos are identical across takes), a
  // new pending take appended. The reply text and message swipes are
  // untouched. Refuses while any take of the slot is still pending.
  function regenImage(chatId, nodeId, swipeIdx, slot) {
    const st = ref.current.settings;
    if (!st.imagesEnabled) return;
    const c = ref.current.chats[chatId];
    // Mid-stream the generation's commit() owns this chat's messages — the
    // write would be clobbered (same rule as onSwipe).
    if (!c || generating?.chatId === c.id) return;
    const node = c?.messages?.[nodeId];
    const swipe = node?.swipes?.[swipeIdx];
    const g = Array.isArray(swipe?.images)
      ? groupImageSlots(swipe.images, swipe.imgUsed).find(g => g.slot === slot) : null;
    if (!g || g.takes.some(t => t?.pending)) return;
    const { prompt, caption = '', pos } = g.takes[0] ?? {};
    if (!prompt) return;
    // Point imgUsed at the new take NOW: the shimmer shows immediately, and
    // the job patches the entry in place, so the index stays correct.
    saveChat({ ...c, messages: { ...c.messages, [nodeId]: { ...node,
      swipes: node.swipes.map((s, i) => i !== swipeIdx ? s : { ...s,
        images: [...s.images, { pending: true, slot, prompt, caption, at: Date.now(),
          ...(pos !== undefined ? { pos } : {}) }],
        imgUsed: { ...(s.imgUsed ?? {}), [slot]: g.takes.length } }) } } }, { touch: false });
    runImageJob(chatId, nodeId, swipeIdx, { prompt, caption, slot }).catch(() => {}); // handles its own errors
  }

  // ◀ ▶ on an image slot: pick another take of the placement. Pure state
  // update on the ACTIVE swipe — touch:false, browsing takes changes no world
  // state (same rule as message swipes).
  function swipeImage(chatId, nodeId, slot, dir) {
    const c = ref.current.chats[chatId];
    if (!c || generating?.chatId === c.id) return; // mid-stream commit() owns this chat
    const node = c?.messages?.[nodeId];
    const swipeIdx = node?.activeSwipe;
    const swipe = node?.swipes?.[swipeIdx];
    if (!Array.isArray(swipe?.images)) return;
    const g = groupImageSlots(swipe.images, swipe.imgUsed).find(g => g.slot === slot);
    if (!g) return;
    const next = Math.min(Math.max(g.activeIdx + dir, 0), g.takes.length - 1);
    if (next === g.activeIdx) return;
    saveChat({ ...c, messages: { ...c.messages, [nodeId]: { ...node,
      swipes: node.swipes.map((s, i) => i !== swipeIdx ? s : { ...s,
        imgUsed: { ...(s.imgUsed ?? {}), [slot]: next } }) } } }, { touch: false });
  }

  // ---- generation ----
  async function runGeneration(chatObj, nodeId, { continuation = false, fresh = false, pov = null } = {}) {
    const { scenarios: sc, personas: pe, characters: gchars, settings: baseSt } = ref.current;
    const model = chatObj.settings?.model || baseSt.model; // per-chat override wins
    if (!baseSt.endpoint || !model) { setError('Configure an endpoint and chat model in Settings first.'); return; }
    // Per-chat generation overrides (panel's Samplers tab): context length and
    // max tokens shadow the globals for this chat's generations. The globals
    // themselves are auto-resolved from the detected model context unless the
    // user pinned them (ctxAuto / reserveAuto).
    const auto = resolveLimits(baseSt, model);
    const st = { ...baseSt,
      contextLength: chatObj.settings?.contextLength ?? auto.contextLength,
      maxTokens: chatObj.settings?.maxTokens ?? auto.maxTokens };
    const genStart = Date.now(); // for swipe.genMs (prompt-to-completion time)
    const scen = sc[chatObj.scenarioId];
    const pers = chatObj.personaId ? pe[chatObj.personaId] : null;
    const node = chatObj.messages[nodeId];
    // Leaf regenerate: the replaced swipe's tool writes are NOT pruned —
    // swipe-stamped provenance hides them during this generation by
    // derivation (the prompt excludes the node entirely, and afterwards the
    // node is viewed at the NEW swipe), so the new take starts clean while
    // the old take keeps its world state. No prune/restore machinery.
    // Claim the generation slot before anything async (the prep below —
    // semantic embeddings, exact token count — can take a long time on a slow
    // backend, and the UI keys off this).
    const abort = new AbortController();
    genRef.current = { abort, chatId: chatObj.id };
    setError(null); // a fresh generation supersedes the last error toast
    setGenerating({ chatId: chatObj.id, nodeId });
    // The node being generated is excluded from the prompt unless continuing it.
    // NB: not `??` — the root's parentId is null, and null MUST survive: for a
    // greeting regenerate the path is empty (system prompt only), so the model
    // writes a fresh opening instead of continuing the whole conversation and
    // storing that continuation as a greeting swipe.
    const promptChat = continuation ? chatObj : { ...chatObj, activeLeafId: node ? node.parentId : chatObj.activeLeafId };
    // Semantic lore activation (async, outside the pure assembler): embed the
    // recent conversation + smart pieces, threshold → preActivated id set.
    // Scores for every scored piece go on the manifest so the Inspector can
    // show near-misses. Any embeddings failure degrades to keyword-only with
    // a manifest warning.
    let preActivated = null;
    let semanticWarning = null;
    let semanticReport = null;
    let memScores = null;
    const semThreshold = typeof st.semanticThreshold === 'number' ? st.semanticThreshold : SEMANTIC_THRESHOLD;
    // All of prep runs outside the stream's try/finally below: a throw here
    // (hostile imported data reaching mergedLorePieces/assemblePrompt) must
    // still release the generation slot and drop the empty swipe, or the UI
    // wedges in "generating" until reload. Handled at the abort check below.
    let prepError = null;
    let messages = null, man = null; // declared outside the prep try — used by the stream below
    try {
    if (st.embeddingModel) {
      const smartPieces = mergedLorePieces(scen, chatObj, gchars).filter(p => p && p.enabled !== false && !p.pinned && p.smart);
      // Smart memory recall (settings.memoryRecall === 'smart'): unpinned
      // memories are scored against the same recent-conversation query — the
      // assembler then ranks the non-recent tail by similarity.
      const recallMems = st.memoryRecall === 'smart'
        ? (promptChat.memoryStore?.memories ?? []).filter(m => m && !m.pinned && (m.text ?? '').trim())
        : [];
      const queryText = (smartPieces.length || recallMems.length)
        ? getActivePath(promptChat.messages, promptChat.activeLeafId)
          .map(activeText).join('\n').slice(-1500)
        : '';
      if (queryText.trim()) {
        // One query embedding serves both the lore and the memory pass; each
        // pass degrades independently (keyword-only lore / recency memories).
        const emb = roleApi(st, 'embed');
        let queryVec = null;
        const queryVecOf = async () => {
          if (!queryVec) [queryVec] = await embed({ endpoint: emb.endpoint, apiKey: emb.apiKey, serverToken: st.serverToken, model: st.embeddingModel, inputs: [queryText], signal: abort.signal });
          return queryVec;
        };
        if (smartPieces.length) {
          try {
            const qv = await queryVecOf();
            const vecs = await Promise.all(smartPieces.map(p =>
              embedCached({ endpoint: emb.endpoint, apiKey: emb.apiKey, serverToken: st.serverToken, model: st.embeddingModel,
                text: `${p.title ?? ''}\n${(p.content ?? '').slice(0, 500)}`, signal: abort.signal })));
            preActivated = new Set();
            semanticReport = { threshold: semThreshold, scores: [] };
            for (let i = 0; i < smartPieces.length; i++) {
              const score = cosine(qv, vecs[i]);
              if (score >= semThreshold) preActivated.add(smartPieces[i].id);
              semanticReport.scores.push({ id: smartPieces[i].id, title: smartPieces[i].title ?? '', score });
            }
          } catch (e) {
            console.warn('Semantic lore activation failed:', e);
            semanticWarning = 'Semantic lore activation failed (embeddings); keyword-only for this generation.';
          }
        }
        if (recallMems.length) {
          try {
            const qv = await queryVecOf();
            const vecs = await Promise.all(recallMems.map(m =>
              embedCached({ endpoint: emb.endpoint, apiKey: emb.apiKey, serverToken: st.serverToken, model: st.embeddingModel,
                text: m.text.slice(0, 500), signal: abort.signal })));
            memScores = new Map();
            for (let i = 0; i < recallMems.length; i++) memScores.set(recallMems[i].id, cosine(qv, vecs[i]));
          } catch (e) {
            console.warn('Semantic memory recall failed:', e);
            semanticWarning = (semanticWarning ? semanticWarning + ' ' : '')
              + 'Semantic memory recall failed (embeddings); recency order for this generation.';
          }
        }
      }
    }
    ({ messages, manifest: man } = assemblePrompt({
      scenario: scen, persona: pers, chat: promptChat, settings: st,
      platformPrompt: buildPlatformPrompt(st),
      preActivated, pov, characters: gchars, memScores,
    }));
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
            text: head.map(m => m.content).join('\n'), signal: abort.signal })
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
          man.layers.history.keptIds = (man.layers.history.keptIds ?? []).slice(extraDrops);
          man.layers.history.tokens = estHist;
          man.totalTokens = messages.reduce((t, m) => t + estT(m.content), 0);
          man.warnings.push(`Exact token count left less room than the estimate — dropped ${extraDrops} more oldest message(s).`);
        }
        if (headTok > man.budget)
          man.warnings.push(`Fixed layers alone use ~${headTok} exact tokens, over the ${man.budget}-token prompt budget — shrink backstory/lore/memory or raise the context length.`);
      }
    }
    } catch (e) { prepError = e; }
    // (Abort-during-prep check lives just before the stream loop, after
    // discardEmptySwipe is defined — Stop during prep must not leak the
    // empty swipe/fresh node the caller already created.)
    // Logit bias: OpenAI shape {token_id: bias}, first token of each entry.
    const logitBias = {};
    for (const e of Object.values(st.logitBias ?? {})) {
      const id = e?.ids?.[0];
      if (Number.isInteger(id)) logitBias[String(id)] = Math.max(-100, Math.min(100, e.power));
    }
    // Effective samplers: per-chat overrides win; only registered params
    // (built-ins + customSamplers) are ever sent — a removed custom def can't
    // leak a stale key upstream. Disabled globals keep their values but are
    // not sent (enabledSamplers); a per-chat override can still force one.
    const allowedSamplerKeys = new Set(allSamplerFields(st).map(f => f.key));
    const effSamplers = Object.fromEntries(
      Object.entries({ ...enabledSamplers(st), ...(chatObj.settings?.samplers ?? {}) })
        .filter(([k]) => allowedSamplerKeys.has(k)));
    let work = ref.current.chats[chatObj.id] ?? chatObj;
    // ^ Re-base on the stored chat, not the caller's snapshot: a background
    // merge-on-write (an image job's patch, enrichment) may have landed
    // between the caller's read and the stream start. Callers upsert the
    // chat carrying the new empty swipe before firing, so our node survives
    // the re-base.
    // Display text streams in plain (delta is the text authority). Logprobs
    // accumulate as a SEPARATE raw tape — a chunk's delta and its logprob
    // entries are not reliably related (middleware re-chunking can attach
    // them off by one), so alignment happens once, globally, at the end.
    const baseText = continuation ? activeText(node) : '';
    const baseSpans = continuation
      ? (node?.swipes?.[node.activeSwipe]?.tokens ?? [{ text: baseText, logprob: null, top: [] }])
      : [];
    let acc = baseText;
    // Reasoning channel (delta.reasoning_content) accumulates separately and
    // lands on the swipe as `think` — displayed collapsibly, never prompted.
    // Continuations prepend the base swipe's reasoning like its text.
    let thinkAcc = continuation ? (node?.swipes?.[node.activeSwipe]?.think ?? '') : '';
    // Thinking wall time (first think chunk to the first content chunk —
    // prefill excluded) lands on the swipe as thinkMs; continuations add to
    // the base swipe's window.
    const baseThinkMs = continuation ? (node?.swipes?.[node.activeSwipe]?.thinkMs ?? 0) : 0;
    let thinkStartAt = null, thinkStopAt = null;
    // Backend-reported token counts (stream_options include_usage) land on
    // the swipe as usage.completion; on continuation the count adds the base
    // swipe's, so the ribbon total covers the whole reply.
    const baseUsageTok = continuation ? (node?.swipes?.[node.activeSwipe]?.usage?.completion ?? 0) : 0;
    let usageRec = null;
    const lpTape = [];
    // Tool replies: the RAW accumulated text and its raw→stripped char map
    // (set when tool blocks were stripped) so the lp tape — which covers the
    // protocol text too — can still be aligned and projected onto the
    // stripped display text.
    let rawAcc = null, probMap = null;
    // Merge-on-write: rebuild from the CURRENT stored chat and overlay only
    // the message tree, so drawer/panel edits made mid-stream (memory pins,
    // renames, chat options) survive the per-token upserts. Chat deleted
    // mid-generation → keep accumulating locally, never write back.
    const applyText = (text, tokens) => {
      const n = work.messages[nodeId];
      if (!n) return;
      const swipes = n.swipes.slice();
      // Persisted spans cap alternatives at 5 — the tape can carry up to 20
      // and would balloon storage on every swipe. Display needs only a few.
      const capped = tokens?.map(t => t.top?.length > 5 ? { ...t, top: t.top.slice(0, 5) } : t);
      swipes[n.activeSwipe] = { ...swipes[n.activeSwipe], text, modelId: model,
        ...(thinkAcc ? { think: thinkAcc } : {}), ...(capped ? { tokens: capped } : {}) };
      const messages = { ...work.messages, [nodeId]: { ...n, swipes } };
      const cur = ref.current.chats[work.id];
      if (!cur) { work = { ...work, messages }; return; }
      work = { ...cur, messages, updatedAt: Date.now() };
      upsertChat(work.id, work);
    };
    // One global alignment pass over the finished text + raw lp tape; attaches
    // swipe.tokens when at least one span carries real prob data. Runs on
    // completion AND abort, so partial generations keep their probs.
    const attachProbs = () => {
      let spans = null;
      if (probMap && rawAcc != null)
        // stripToolBlocksMapped's map is slice-relative; rebase to absolute
        // raw-reply indices (alignStrippedToolSpans reads inv[rawOffset + i]).
        spans = alignStrippedToolSpans(rawAcc.slice(baseText.length), lpTape,
          probMap.map.map(j => j + baseText.length), baseText.length, acc.slice(baseText.length));
      if (!spans) spans = alignTokensToSpans(acc.slice(baseText.length), lpTape);
      spans = [...baseSpans, ...spans];
      if (spans.some(s => s.logprob != null)) applyText(acc, spans);
      else if (st.tokenProbs !== false && acc)
        console.warn('FictionPad: logprobs were requested but the stream contained none — ' +
          'an intermediate proxy/middleware may not be forwarding "logprobs"/"top_logprobs" to the backend.');
    };
    // Remove the empty generating swipe (or the fresh placeholder node) when
    // nothing was ever written — applies to errors, dropped connections,
    // empty completions, and Stop-before-first-token alike. World state needs
    // no restore: the replaced swipe's tool writes were never pruned (they
    // hide by swipe-derivation), so a failed retry leaves them untouched.
    const discardEmptySwipe = () => {
      const n = work.messages[nodeId];
      if (!n) return;
      const cur = ref.current.chats[work.id];
      if (!cur) return; // chat deleted mid-generation — never resurrect it
      if (n.swipes.length > 1) {
        const swipes = n.swipes.slice(0, -1);
        work = { ...cur, messages: { ...work.messages, [nodeId]: { ...n, swipes, activeSwipe: swipes.length - 1 } }, updatedAt: Date.now() };
        upsertChat(work.id, work);
      } else if (fresh) {
        const messages = { ...work.messages };
        delete messages[nodeId];
        work = { ...cur, messages, activeLeafId: n.parentId, updatedAt: Date.now() };
        upsertChat(work.id, work);
      }
    };
    // Stopped during the async prep (embeddings/tokenize)? Bail before
    // streaming — and discard the empty swipe/fresh node the caller already
    // created, or Stop during prep leaks it into the tree.
    if (abort.signal.aborted) { discardEmptySwipe(); genRef.current = null; setGenerating(null); return; }
    if (prepError) {
      console.warn('FictionPad: generation prep failed:', prepError);
      setError(`Generation failed: ${describeApiError(prepError)}`);
      discardEmptySwipe(); genRef.current = null; setGenerating(null); return;
    }
    setManifestFor(chatObj.id, man, messages);
    setSuggestions(null);
    let sawDone = false; // a chunk with finish_reason arrived (clean finish)
    let truncated = false; // finish_reason 'length' — surfaced on the manifest
    // OpenAI-style backends 400 the whole request when stop has >4 entries:
    // retry once with the list truncated, then surface any error as-is.
    let stopList = st.stopStrings;
    // Usage reporting (stream_options.include_usage): a backend that 400s the
    // unknown field gets one silent retry without it, like the stop retry.
    let wantUsage = true;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          for await (const chunk of openaiChatStream({
            endpoint: effEp(st), apiKey: st.apiKey, serverToken: st.serverToken, model, messages,
            // Per-chat sampler overrides (panel's Samplers tab) win over globals.
            samplers: effSamplers,
            maxTokens: st.maxTokens, signal: abort.signal,
            tokenProbs: st.tokenProbs !== false, topLogprobs: st.topLogprobs ?? 10, logitBias, stop: stopList,
            usageStats: wantUsage,
          })) {
            if (chunk.done) {
              sawDone = true;
              if (chunk.finishReason === 'length') truncated = true;
              continue;
            }
            if (chunk.usage) { usageRec = chunk.usage; continue; }
            if (chunk.lp) { lpTape.push(...chunk.lp); continue; }
            if (chunk.think) {
              if (thinkStartAt == null) thinkStartAt = Date.now();
              thinkAcc += chunk.think; applyText(acc); continue;
            }
            // Thinking ends at the first content token (streams that emit
            // only reasoning keep thinkStopAt null → the stamp uses stream end).
            if (thinkStartAt != null && thinkStopAt == null) thinkStopAt = Date.now();
            acc += chunk.content;
            // Streaming view hides tool protocol blocks (complete + trailing
            // unterminated) so the user never sees them mid-generation.
            applyText(st.toolsEnabled !== false ? stripToolBlocks(acc) : acc);
          }
          if (!acc && !abort.signal.aborted)
            setError(sawDone ? 'The model returned an empty response.'
                             : 'The connection ended before any text arrived.');
          break;
        } catch (e) {
          if (wantUsage && !acc && e?.status === 400 && /stream_options|include_usage/i.test(e?.message ?? '')) {
            console.warn('FictionPad: backend rejected stream_options — retrying without usage reporting.');
            wantUsage = false;
            continue;
          }
          if (attempt === 0 && !acc && e?.status === 400 && /stop/i.test(e?.message ?? '')
              && Array.isArray(stopList) && stopList.length > 4) {
            console.warn(`FictionPad: backend rejected ${stopList.length} stop strings — retrying with the first 4.`);
            stopList = stopList.slice(0, 4);
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError')
        setError(`Generation failed: ${describeApiError(e)}`);
    } finally {
      genRef.current = null;
      setGenerating(null);
      // Tool calls: parse the finished text, strip protocol blocks
      // from display, execute against the chat lore overlay. Logprobs still
      // attach on tool replies: the lp tape is aligned against the RAW text
      // (which it tiles exactly) and projected through the strip's char map
      // onto the stripped display text (attachProbs).
      let toolResults = null;
      let toolCallsRan = false;
      // Set once a parsed generate_image call is accepted: { prompt, caption,
      // raw } until the pending entry is stamped, then { prompt, caption, swipeIdx }.
      let imageQueued = null;
      // All late writes funnel through commit(): the mutation is applied to a
      // merge of the CURRENT stored chat with the generation-owned message
      // tree, and the whole write is skipped when the chat was deleted
      // mid-generation — a deleted chat must never be resurrected from the
      // stale `work` snapshot. mutate returning its input = no write needed.
      const commit = (mutate) => {
        const cur = ref.current.chats[work.id];
        if (!cur) return false;
        const base = { ...cur, messages: work.messages, activeLeafId: work.activeLeafId };
        const next = mutate(base);
        if (next === base) { work = base; return true; }
        work = { ...next, updatedAt: Date.now() };
        upsertChat(work.id, work);
        // React flushes this write only AFTER the finally completes — reflect
        // it in ref immediately, or later same-finally reads (speaker
        // attribution, the tool-only placeholder) rebuild from the pre-tool
        // snapshot and silently drop the pieces the tools just wrote.
        ref.current.chats = { ...ref.current.chats, [work.id]: work };
        return true;
      };
      // (Regenerate hygiene: the replaced swipe's tool writes hide by
      // swipe-derivation — the prompt excluded this node, and the new writes
      // below are stamped with the NEW active swipe. Nothing is pruned.)
      if (acc && st.toolsEnabled !== false) {
        // Continuation: parse ONLY the new slice — tool blocks in the base
        // text were already executed by its own generation, and the base
        // text (plus its spans) stays verbatim so baseSpans + new spans
        // always tile swipe.text exactly.
        const slice = acc.slice(baseText.length);
        const parsed = parseToolCalls(slice);
        if (parsed.text !== slice) {
          // Keep the raw text + raw→stripped map for logprob projection.
          probMap = stripToolBlocksMapped(slice);
          rawAcc = acc;
          // Drift guard: if the map's text isn't exactly what we store,
          // discard it — attachProbs falls back to plain alignment.
          if (probMap.text !== parsed.text) { probMap = null; rawAcc = null; }
          acc = baseText + parsed.text;
          // Blocks leave their surrounding newlines: a reply of ONLY blocks
          // strips to pure whitespace, which IS the empty case — collapse it
          // so the toolOnly/discard/image-only decisions below see '' exactly.
          if (!acc.trim()) acc = '';
          if (parsed.text || !acc) applyText(acc);
        }
        if (parsed.calls.length) {
          toolCallsRan = true;
          const callCap = Math.max(1, st.toolCallCap ?? TOOL_CALL_CAP);
          // generate_image calls ride the tool machinery (a tools-disabled
          // chat never advertises or parses them) but execute on the image
          // pipeline, not the lore overlay — split them off before
          // applyToolCalls. Their results join the same list that feeds
          // man.toolCalls + the swipe's toolCalls stamp, so a refused call
          // (disabled, prompt-less, over cap) surfaces in the ⚙ pill instead
          // of silently vanishing.
          const { imageCalls, loreCalls } = splitImageCalls(parsed.calls);
          const imageToolsOn = st.toolsEnabled !== false && st.imagesEnabled;
          const imageResults = imageCalls.map((call, i) => {
            const prompt = String(call.args?.prompt ?? '').trim();
            if (!imageToolsOn) return { name: call.name, args: call.args, ok: false, note: 'image generation disabled' };
            if (i >= IMAGE_CALL_CAP) return { name: call.name, args: call.args, ok: false, note: 'call cap reached' };
            if (!prompt) return { name: call.name, args: call.args, ok: false, note: 'missing prompt' };
            imageQueued = { prompt, caption: String(call.args.caption ?? '').slice(0, 200), raw: call.raw, slot: uid() };
            return { name: call.name, args: call.args, ok: true, note: 'queued' };
          });
          let loreResults = [];
          if (loreCalls.length) commit((c) => {
            const applied = applyToolCalls(c, loreCalls, {
              nodeId, now: Date.now(), cap: callCap,
              queueLore: (scen?.emergentLore ?? 'queue') === 'queue',
              atLen: getActivePath(c.messages, nodeId).length,
              createdSwipe: c.messages[nodeId]?.activeSwipe ?? null,
            }, mergedLorePieces(scen, c, gchars));
            loreResults = applied.results;
            return applied.chat;
          });
          toolResults = [...loreResults, ...imageResults];
          if (imageQueued) {
            // Stamp the pending image entry NOW, in the same commit batch as
            // the tool results, so the shimmer is visible the moment
            // generation ends. Race-free vs the final swipe stamp below: that
            // stamp spreads swipes[activeSwipe] (it can only add
            // speaker/genMs/toolCalls), so the images array survives; and
            // commit() ref-syncs, so no later same-finally read rebuilds from
            // the pre-image snapshot. For an image-only reply (text '') this
            // is also the write that keeps the swipe from being discarded.
            const { prompt, caption, slot } = imageQueued;
            // pos: the offset in the stripped display text where this image's
            // tool block began — the chat view renders the image where the
            // model placed it. The accepted call is the first generate_image
            // block (IMAGE_CALL_CAP is 1), so its raw JSON identifies the
            // block: rescan the raw slice for the block whose trimmed body
            // matches call.raw (first match wins — an identical earlier block
            // would have been the accepted one). probMap's map is
            // stripped→raw, strictly increasing, with no entry inside a
            // removed block — so the kept-char count before the block's raw
            // start is the first map index whose raw offset reaches it
            // (map.length when the block ends the slice); + baseText.length
            // shifts continuation slices into full-swipe coordinates. No map
            // (drift guard) or no match → no pos → renders at the end.
            let pos = null;
            if (probMap) {
              TOOL_BLOCK_RE.lastIndex = 0;
              let bm;
              while ((bm = TOOL_BLOCK_RE.exec(slice))) {
                if (bm[1].trim() !== imageQueued.raw) continue;
                const k = probMap.map.findIndex(v => v >= bm.index);
                pos = (k === -1 ? probMap.map.length : k) + baseText.length;
                break;
              }
            }
            let swipeIdx = -1;
            const stamped = commit((c) => {
              const n = c.messages[nodeId];
              swipeIdx = n?.activeSwipe ?? -1;
              const sw = n?.swipes?.[swipeIdx];
              if (!sw) return c;
              const swipes = n.swipes.slice();
              swipes[swipeIdx] = { ...sw,
                images: [...(sw.images ?? []), { pending: true, slot, prompt, caption, at: Date.now(),
                  ...(pos != null ? { pos } : {}) }] };
              return { ...c, messages: { ...c.messages, [nodeId]: { ...n, swipes } } };
            });
            // Chat deleted mid-generation — don't fire a job whose
            // merge-on-write could never land.
            imageQueued = stamped && swipeIdx >= 0 ? { prompt, caption, slot, swipeIdx } : null;
          }
          if (toolResults.length) {
            // Full args are recorded (pretty-printed JSON) — truncation to a
            // one-line preview is display-only, at render time in the
            // inspector and the gear popover.
            man.toolCalls = toolResults.map(r => ({
              name: r.name, ok: r.ok, note: r.note, args: JSON.stringify(r.args ?? {}, null, 2),
            }));
            const capped = loreResults.filter(r => r.note === 'call cap reached').length;
            const imgCapped = imageResults.filter(r => r.note === 'call cap reached').length;
            const failed = toolResults.filter(r => !r.ok && r.note !== 'call cap reached').length;
            if (capped) man.warnings.push(`${capped} tool call(s) skipped — per-generation cap is ${callCap}.`);
            if (imgCapped) man.warnings.push(`${imgCapped} image call(s) skipped — at most ${IMAGE_CALL_CAP} image per reply.`);
            if (failed) man.warnings.push(`${failed} tool call(s) failed — details in the inspector.`);
            if (ref.current.chats[chatObj.id]) setManifestFor(chatObj.id, { ...man }, messages);
          }
        }
      }
      // Tool-only reply: the model emitted ONLY tool blocks. Keep a
      // placeholder swipe instead of discarding it — applyToolCalls stamped
      // its pieces createdBy: nodeId (they must reference a live node), and
      // the user gets visible feedback that lore was added. Logprobs are
      // skipped: the tape covers the raw protocol text, so aligning it to a
      // synthetic placeholder is meaningless. An IMAGE-only reply is not
      // tool-only: no placeholder, no discard — the swipe stays text-empty
      // and renders as a pure image bubble (pending entry stamped above).
      // Whitespace-only is empty too (a blank reply with tools disabled never
      // passed the strip path above).
      if (!acc.trim()) acc = '';
      const toolOnly = !acc && toolCallsRan && !imageQueued;
      if (toolOnly) { acc = '✦ Lore updated via tool call.'; applyText(acc); }
      if (!acc && !imageQueued) discardEmptySwipe();
      // Stream ended without a finish chunk and not by the user's Stop — the
      // connection dropped mid-generation. Partial text is kept, but flagged.
      const interrupted = !!acc && !sawDone && !abort.signal.aborted;
      // imageQueued with empty acc = image-only reply: still stamp the swipe
      // (speaker/genMs/toolCalls) so the ⚙ pill works — only probs are tied
      // to text (the tape covers protocol text, nothing to align).
      if (acc || imageQueued) {
        if (!toolOnly && acc) attachProbs();
        if (truncated) {
          man.warnings.push('Response truncated at max_tokens — raise Max tokens in Settings or /continue.');
          if (ref.current.chats[chatObj.id]) setManifestFor(chatObj.id, { ...man }, messages);
        }
        // Attribute the finished swipe to a character (or "Narrator"), and
        // record how long the generation took.
        const names = characterNamesOf(scen, work, gchars);
        const n = work.messages[nodeId];
        if (n) {
          // thinkMs: first-think-token → first-content-token window (stream
          // end when no content followed), plus the base swipe's window on
          // continuations.
          const thinkMs = thinkAcc
            ? baseThinkMs + (thinkStartAt != null ? (thinkStopAt ?? Date.now()) - thinkStartAt : 0)
            : 0;
          const swipes = n.swipes.slice();
          swipes[n.activeSwipe] = { ...swipes[n.activeSwipe], speaker: detectSpeaker(acc, names) ?? 'Narrator', genMs: Date.now() - genStart,
            ...(thinkMs > 0 ? { thinkMs } : {}),
            // Backend-reported counts win over the ribbon's tape/estimate —
            // completion covers the reasoning tokens too on thinking models.
            ...(usageRec?.completion != null
              ? { usage: { ...usageRec, completion: usageRec.completion + baseUsageTok } } : {}),
            ...(interrupted ? { interrupted: true } : {}),
            // Persisted on the swipe (full args) so the gear popover can show
            // them after the fact — the popover truncates for display only.
            ...(toolResults ? { toolCalls: toolResults.map(({ name, ok, note, args }) => ({
              name, ok, note, args: JSON.stringify(args ?? {}, null, 2),
            })) } : {}) };
          const messages = { ...work.messages, [nodeId]: { ...n, swipes } };
          const cur = ref.current.chats[work.id];
          if (cur) {
            work = { ...cur, messages, updatedAt: Date.now() };
            upsertChat(work.id, work);
          } else {
            work = { ...work, messages }; // deleted mid-generation — local only
          }
        }
        maybeSummarize(work);
        maybeExtractLore(work);
        // Experimental (settings.toolsEnrich): flesh out characters this
        // generation registered, via the ✦ generator. Fire-and-forget like
        // the passes above; merge-on-write at save time.
        if (st.toolsEnrich && toolResults) maybeEnrichCharacters(work, nodeId, toolResults);
        // Same for their avatars (also needs Image generation on): one
        // fire-and-forget portrait render per newly registered character.
        if (st.toolsEnrich && st.imagesEnabled && toolResults) maybeEnrichAvatars(work, nodeId, toolResults);
        // Response suggestions: only after a full generation/regeneration —
        // never mid-stream, never after /continue, never for OOC exchanges.
        if (!continuation && st.suggestions) {
          const parent = work.messages[node?.parentId];
          const parentIsOOC = parent?.role === 'user' && /^\[OOC:/i.test(activeText(parent).trim());
          if (!parentIsOOC) fetchSuggestions(work, nodeId);
        }
      }
      storage.flush();
      // Fire the image job only now, after the finally's state has settled —
      // the pending entry is already on the swipe. runImageJob patches it
      // merge-on-write when the backend answers and handles its own errors;
      // it never blocks the composer (imgCtls, not auxBusy). Not awaited.
      if (imageQueued)
        runImageJob(work.id, nodeId, imageQueued.swipeIdx,
          { prompt: imageQueued.prompt, caption: imageQueued.caption, slot: imageQueued.slot }).catch(() => {});
    }
  }

  // runGeneration is fire-and-forget at every call site: a rejection that
  // escapes its internal error handling (a bug, not an API error) must not
  // die as an unhandled promise rejection — log it and surface a banner.
  const fireGeneration = (...args) =>
    runGeneration(...args).catch((e) => {
      console.error('Generation failed unexpectedly:', e);
      setError(`Generation failed: ${e?.message ?? e}`);
    });

  // ---- response suggestions (aux model; ephemeral, silent on failure) ----
  async function fetchSuggestions(chatObj, nodeId) {
    const { personas: pe, settings: st } = ref.current;
    const model = st.auxModel || st.model;
    const conn = roleApi(st, 'aux');
    if (!conn.endpoint || !model) return;
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
        endpoint: conn.endpoint, apiKey: conn.apiKey, serverToken: st.serverToken, model,
        system: sysPrompt,
        user: `Recent scene:\n\n${recent}\n\n${count === 1 ? 'One option' : `${count} options`} for ${pName}:`,
        maxTokens: Math.min(500, 60 + count * words * 2), temperature: st.suggestionsTemp ?? 0.9, stop: st.stopStrings,
      }, chatObj.id);
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
  // Generation entry guard: callers append the target swipe/node BEFORE
  // calling runGeneration, so a late "not configured" bail would leak an
  // empty bubble into the tree. Check before writing anything.
  const generationReady = (c) => {
    const st = ref.current.settings;
    if (st.endpoint && (c?.settings?.model || st.model)) return true;
    setError('Configure an endpoint and chat model in Settings first.');
    return false;
  };
  function sendUserMessage(c, content) {
    if (!generationReady(c)) return;
    const { chat: c1, id: userId } = appendMessage(c, c.activeLeafId, 'user', content);
    const { chat: c2, id: asstId } = appendMessage(c1, userId, 'assistant', '');
    upsertChat(c2.id, { ...c2, updatedAt: Date.now() });
    fireGeneration(c2, asstId, { fresh: true });
  }
  function handleContinue(c) {
    if (!generationReady(c)) return;
    const path = getActivePath(c.messages, c.activeLeafId);
    const last = path[path.length - 1];
    if (last?.role === 'assistant' && activeText(last)) {
      fireGeneration(c, last.id, { continuation: true });
    } else {
      const { chat: c1, id } = appendMessage(c, c.activeLeafId, 'assistant', '');
      upsertChat(c1.id, { ...c1, updatedAt: Date.now() });
      fireGeneration(c1, id, { fresh: true });
    }
  }
  function handleInput(raw) {
    const c = ref.current.chats[ui.chatId];
    if (!c) return 'Select or create a chat first.';
    if (genRef.current) return 'Already generating — press Stop first.';
    if (auxBusy.length) return `Working… (${[...new Set(auxBusy)].join(', ')})`;
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
        if (!arg) return 'Usage: /pov <character> [steering text]';
        // Reframe one generation around another character. The name is the
        // longest leading run of words exactly matching a known character's
        // title (so multi-word names work); any remainder is optional steering
        // text for this one reply. No exact prefix match → the whole arg is
        // the name query (exact, then substring), as before. A matched piece
        // is force-injected (reason 'pov') so the model sees that definition.
        const scen = ref.current.scenarios[c.scenarioId];
        const chars = mergedLorePieces(scen, c, ref.current.characters).filter(p => p && p.enabled !== false && (p.type ?? 'lore') === 'character');
        // mergedLorePieces order is scenario → linked globals → chat overlay;
        // a same-name collision resolves the other way (chat wins, like the
        // avatar map and speaker click-through) — search from the end.
        const byPrio = chars.slice().reverse();
        const words = arg.split(/\s+/);
        let piece = null, name = '', text = '';
        for (let n = words.length; n >= 1 && !piece; n--) {
          const cand = words.slice(0, n).join(' ').toLowerCase();
          piece = byPrio.find(p => (p.title ?? '').trim().toLowerCase() === cand) ?? null;
          if (piece) { name = piece.title.trim(); text = words.slice(n).join(' '); }
        }
        if (!piece) {
          const q = arg.toLowerCase();
          piece = byPrio.find(p => (p.title ?? '').trim().toLowerCase() === q)
            ?? byPrio.find(p => (p.title ?? '').trim().toLowerCase().includes(q)) ?? null;
          name = piece?.title?.trim() || arg;
        }
        if (!generationReady(c)) return null;
        const { chat: c1, id } = appendMessage(c, c.activeLeafId, 'assistant', '');
        upsertChat(c1.id, { ...c1, updatedAt: Date.now() });
        fireGeneration(c1, id, { fresh: true, pov: { name, pieceId: piece?.id ?? null, text } });
        return null;
      }
      if (cmd === '/improve') {
        if (!arg) return 'Usage: /improve <draft text>';
        improveDraft(c, arg);
        return null;
      }
      if (cmd === '/image') {
        const st = ref.current.settings;
        if (!st.imagesEnabled) return 'Image generation is off — enable it in Settings → Features.';
        if (!arg) return 'Usage: /image [PROMPT]';
        // The pending bubble is the feedback: no text generation fires — the
        // image job patches this swipe's entry when the backend answers (or
        // marks it failed). An image-only swipe survives pruneInterrupted.
        const { chat: c1, id } = appendMessage(c, c.activeLeafId, 'assistant', '', st.imageModel || null);
        const n1 = c1.messages[id];
        const slot = uid();
        const c2 = { ...c1, messages: { ...c1.messages, [id]: { ...n1,
          swipes: [{ ...n1.swipes[0], speaker: 'Narrator', images: [{ pending: true, slot, prompt: arg, at: Date.now() }] }] } } };
        upsertChat(c2.id, { ...c2, updatedAt: Date.now() });
        runImageJob(c2.id, id, 0, { prompt: arg, slot }).catch(() => {}); // handles its own errors
        return null;
      }
      if (cmd === '/impersonate') { onImpersonate(); return null; }
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
      return `Unknown command ${cmd}. Available: /ooc, /continue, /pov CHAR [TEXT], /improve, /impersonate, /image [PROMPT], /recap N, /memory N, /model NAME, /theme NAME`;
    }
    sendUserMessage(c, raw);
    return null;
  }

  // ---- aux slash commands ----
  async function improveDraft(c, draft) {
    const { personas: pe, settings: st } = ref.current;
    const model = st.auxModel || st.model;
    const conn = roleApi(st, 'aux');
    if (!conn.endpoint || !model) { setError('Configure an endpoint and model in Settings first.'); return; }
    const pers = c.personaId ? pe[c.personaId] : null;
    const pName = pers?.name?.trim() || 'User';
    const personaDesc = pers?.description?.trim() ? ` (${subUser(pers.description, pName)})` : '';
    const recent = getActivePath(c.messages, c.activeLeafId).slice(-4)
      .map(n => `${n.role === 'user' ? pName : 'Narrator'}: ${subUser(activeText(n), pName)}`)
      .join('\n\n');
    try {
      const out = await auxLogged('improve', {
        endpoint: conn.endpoint, apiKey: conn.apiKey, serverToken: st.serverToken, model,
        system: subUser(st.improvePrompt || DEFAULT_IMPROVE_PROMPT, `${pName}${personaDesc}`),
        user: `${recent ? `Recent scene:\n\n${recent}\n\n` : ''}Draft:\n\n${draft}`,
        maxTokens: st.improveMaxTokens ?? 1500, temperature: st.improveTemp ?? 0.7, stop: st.stopStrings,
      }, c.id);
      if (!out) throw new Error('empty response from the model');
      setComposerInject({ chatId: c.id, text: out, nonce: Date.now() });
    } catch (e) {
      setError(`/improve failed: ${e.message ?? e}`);
    }
  }

  // Impersonate: the aux model drafts the user's next message into the
  // composer as an editable draft — never sent automatically. Rides auxLogged,
  // so the composer's Stop aborts it and the call lands in the Inspector's
  // aux log like every background call.
  async function impersonateDraft(c) {
    const { personas: pe, settings: st } = ref.current;
    const model = st.auxModel || st.model;
    const conn = roleApi(st, 'aux');
    if (!conn.endpoint || !model) { setError('Configure an endpoint and model in Settings first.'); return; }
    const pName = (c.personaId && pe[c.personaId]?.name?.trim()) || 'User';
    const recent = getActivePath(c.messages, c.activeLeafId).slice(-(st.suggestionsDepth ?? 6))
      .map(n => `${n.role === 'user' ? pName : 'Narrator'}: ${subUser(activeText(n), pName)}`)
      .join('\n\n');
    if (!recent.trim()) { setComposerInject({ chatId: c.id, hint: 'Nothing to base a reply on yet.', nonce: Date.now() }); return; }
    try {
      const out = await auxLogged('impersonate', {
        endpoint: conn.endpoint, apiKey: conn.apiKey, serverToken: st.serverToken, model,
        system: subUser(st.impersonatePrompt || DEFAULT_IMPERSONATE_PROMPT, pName),
        user: `Recent scene:\n\n${recent}\n\n${pName}'s next message:`,
        maxTokens: 400, temperature: st.suggestionsTemp ?? 0.7, stop: st.stopStrings,
      }, c.id);
      if (!out) throw new Error('empty response from the model');
      setComposerInject({ chatId: c.id, text: out, nonce: Date.now() });
    } catch (e) {
      setError(`Impersonate failed: ${e.message ?? e}`);
    }
  }
  const onImpersonate = () => {
    const c = ref.current.chats[ui.chatId];
    if (!c || genRef.current || auxBusy.length || !generationReady(c)) return;
    impersonateDraft(c);
  };

  async function recapChat(c, n) {
    const { personas: pe, settings: st } = ref.current;
    const model = st.auxModel || st.model;
    const conn = roleApi(st, 'aux');
    if (!conn.endpoint || !model) { setError('Configure an endpoint and model in Settings first.'); return; }
    const pName = (c.personaId && pe[c.personaId]?.name?.trim()) || 'User';
    const recent = getActivePath(c.messages, c.activeLeafId).slice(-n)
      .map(x => `${x.role === 'user' ? pName : 'Narrator'}: ${subUser(activeText(x), pName)}`)
      .join('\n\n');
    if (!recent.trim()) { setComposerInject({ chatId: c.id, hint: 'Nothing to recap yet.', nonce: Date.now() }); return; }
    try {
      const out = await auxLogged('recap', {
        endpoint: conn.endpoint, apiKey: conn.apiKey, serverToken: st.serverToken, model,
        system: (st.recapPrompt || DEFAULT_RECAP_PROMPT).replaceAll('{{words}}', String(st.recapWords ?? 800)),
        user: `Roleplay excerpt (last ${n} messages):\n\n${recent}`,
        maxTokens: st.recapMaxTokens ?? 1500, temperature: st.recapTemp ?? 0.4, stop: st.stopStrings,
      }, c.id);
      if (!out) throw new Error('empty response from the model');
      setModal({ kind: 'recap', text: out });
    } catch (e) {
      setError(`/recap failed: ${e.message ?? e}`);
    }
  }

  async function memoryCommand(c, n) {
    setComposerInject({ chatId: c.id, hint: 'Generating memory…', nonce: Date.now() });
    try {
      const text = await generateMemory(c, n);
      if (!text) { setComposerInject({ chatId: c.id, hint: 'Nothing to summarize yet.', nonce: Date.now() }); return; }
      // Merge-on-write: re-read the chat after the aux call and overwrite
      // only memoryStore (manual /memory: cursor untouched).
      const cur = ref.current.chats[c.id];
      if (!cur) { setComposerInject({ chatId: c.id, hint: null, nonce: Date.now() }); return; }
      const store = pushMemory(cur, text);
      saveChat({ ...cur, memoryStore: { ...store, cursor: cur.memoryStore?.cursor ?? 0 } });
      setComposerInject({ chatId: c.id, hint: `Memory saved (${store.memories.length} total).`, nonce: Date.now() });
    } catch (e) {
      setComposerInject({ chatId: c.id, hint: null, nonce: Date.now() });
      setError(`/memory failed: ${e.message ?? e}`);
    }
  }

  // ---- per-message actions ----
  const onEdit = (nodeId, text) => {
    if (genRef.current) return; // no tree surgery mid-generation
    const c = ref.current.chats[ui.chatId]; const n = c?.messages[nodeId];
    if (!n) return;
    const swipes = n.swipes.slice();
    swipes[n.activeSwipe] = { ...swipes[n.activeSwipe], text };
    saveChat({ ...c, messages: { ...c.messages, [nodeId]: { ...n, swipes, edited: true } } });
  };
  const onRegenerate = (nodeId) => {
    const c = ref.current.chats[ui.chatId]; const n = c?.messages[nodeId];
    if (!n || genRef.current || auxBusy.length || !generationReady(c)) return;
    const swipes = [...n.swipes, { text: '', createdAt: Date.now(), modelId: null }];
    // The regenerated node becomes the tip: the previous continuation is kept
    // as a branch of the swipe it followed, reachable via swipe-back / ⎇.
    const c1 = { ...c, messages: { ...c.messages, [nodeId]: { ...n, swipes, activeSwipe: swipes.length - 1 } }, activeLeafId: nodeId, updatedAt: Date.now() };
    upsertChat(c1.id, c1);
    fireGeneration(c1, nodeId);
  };
  // Regenerate from a token: new swipe whose text starts with tokens[0..i]
  // (+ chosen alternative), then continue generation from that prefix via the
  // existing continuation machinery (trailing assistant message = prefill).
  const onRegenFromToken = (nodeId, tokIdx, alt) => {
    const c = ref.current.chats[ui.chatId]; const n = c?.messages[nodeId];
    if (!n || genRef.current || auxBusy.length) return;
    const src = n.swipes[n.activeSwipe];
    const toks = src?.tokens;
    if (!toks?.length || !generationReady(c)) return;
    const keep = toks.slice(0, alt == null ? tokIdx + 1 : tokIdx);
    const prefix = keep.map(t => t.text).join('') + (alt ?? '');
    const prefixToks = alt == null ? keep : [...keep, { text: alt, logprob: null, top: [] }];
    const swipes = [...n.swipes, { text: prefix, createdAt: Date.now(), modelId: null, tokens: prefixToks }];
    const c1 = { ...c, messages: { ...c.messages, [nodeId]: { ...n, swipes, activeSwipe: swipes.length - 1 } }, activeLeafId: nodeId, updatedAt: Date.now() };
    upsertChat(c1.id, c1);
    fireGeneration(c1, nodeId, { continuation: true });
  };
  // Swiping a mid-chain node re-derives the visible branch below it: each
  // swipe keeps its own continuation (children record the parent swipe they
  // follow), hidden branches stay in the tree.
  const onSwipe = (nodeId, dir) => {
    const c = ref.current.chats[ui.chatId]; const n = c?.messages[nodeId];
    // Mid-stream the generation's commit() owns this chat's messages/leaf — a
    // swipe would be silently reverted by the next chunk.
    if (!n || generating?.chatId === c.id) return;
    const next = Math.min(n.swipes.length - 1, Math.max(0, n.activeSwipe + dir));
    if (next === n.activeSwipe) return;
    // touch: false — browsing swipes changes no world state; the chat must not
    // re-sort to the top of the sidebar. snapStart:false — the user explicitly
    // chose this swipe; an uncontinued one truncates, never snaps back.
    // scrollTarget: if this swipe re-derives the leaf, keep THIS message on
    // screen rather than jumping to the new branch's bottom.
    scrollTargetRef.current = { chatId: c.id, nodeId };
    saveChat(activateBranch({ ...c, messages: { ...c.messages, [nodeId]: { ...n, activeSwipe: next } } }, nodeId, { keepPath: true, snapStart: false }), { touch: false });
  };
  const onSwipeTo = (nodeId, idx) => {
    const c = ref.current.chats[ui.chatId]; const n = c?.messages[nodeId];
    if (!n || generating?.chatId === c.id || idx < 0 || idx >= n.swipes.length || idx === n.activeSwipe) return;
    scrollTargetRef.current = { chatId: c.id, nodeId };
    saveChat(activateBranch({ ...c, messages: { ...c.messages, [nodeId]: { ...n, activeSwipe: idx } } }, nodeId, { keepPath: true, snapStart: false }), { touch: false });
  };
  // Image takes (v4.10): ◀ ▶ flip between takes of one image placement, ▶⁺
  // on the last take re-rolls JUST that image (same prompt, new roll) — the
  // reply text and message swipes are untouched. Both resolve the node's
  // ACTIVE swipe at event time, like the message handlers above.
  const onImgSwipe = (nodeId, slot, dir) => swipeImage(ui.chatId, nodeId, slot, dir);
  const onImgRegen = (nodeId, slot) => {
    const n = ref.current.chats[ui.chatId]?.messages?.[nodeId];
    if (n) regenImage(ui.chatId, nodeId, n.activeSwipe, slot);
  };
  // Jump to the branch running through nodeId (branch chip popover / Branches
  // tab). From another chat's panel modal: switches the active chat too.
  const onJump = (nodeId, chatId = ui.chatId) => {
    const c = ref.current.chats[chatId];
    if (!c?.messages[nodeId] || generating?.chatId === c.id) return;
    scrollTargetRef.current = { chatId: c.id, nodeId };
    saveChat(activateBranch(c, nodeId), { touch: false });
    if (chatId !== ui.chatId) setUi(u => ({ ...u, chatId }));
  };
  // The branch view is a modal (the drawer tab strip is crowded enough with
  // four) — opened from the chat context menu, the branch chip popover, or
  // Chat options.
  const onOpenBranches = (chatId = ui.chatId) => setModal({ kind: 'branches', chatId });
  // Click a speaker name in the chat column → open that character for editing.
  // Resolution mirrors the merge priority used everywhere else (chat overlay
  // wins a name collision, then scenario, then global — cf. characterAvatars):
  // chat/scenario character pieces open the shared LorePieceEditor popout
  // (stored by id, so the popout reads live state); a linked GLOBAL card opens
  // the character editor instead — its piece view is derived, the card is the
  // only honest surface. Narrator/persona/unregistered names never get here
  // (MessageItem only makes known character names clickable).
  const onOpenCharacterPiece = (name) => {
    const key = String(name ?? '').trim().toLowerCase();
    if (!key || !chat) return;
    const byTitle = (p) => p?.type === 'character' && (p.title ?? '').trim().toLowerCase() === key;
    const chatPiece = (chat.lorePieces ?? []).find(byTitle);
    if (chatPiece) return setModal({ kind: 'piece', source: 'chat', pieceId: chatPiece.id });
    const scenPiece = (chatScenario?.lorePieces ?? []).find(byTitle);
    if (scenPiece) return setModal({ kind: 'piece', source: 'scenario', pieceId: scenPiece.id });
    const linkedIds = [...(chatScenario?.characterIds ?? []), ...(chat.characterIds ?? [])];
    const card = linkedIds.map(id => characters[id])
      .find(c => c && (c.name ?? '').trim().toLowerCase() === key);
    if (card) setModal({ kind: 'character', character: card });
  };
  // The piece the 'piece' modal edits, resolved live by id (null = gone — a
  // delete elsewhere just closes the popout by not rendering it).
  const modalPiece = modal?.kind === 'piece'
    ? (modal.source === 'chat' ? (chat?.lorePieces ?? []) : (chatScenario?.lorePieces ?? []))
        .find(p => p.id === modal.pieceId) ?? null
    : null;

  // ←/→ cycle the leaf message's swipes; → on the last swipe is ▶⁺ (a new
  // take). ↑/↓ move a keyboard selection through the messages (↓ past the
  // leaf or Esc clears it); ←/→ then act on the SELECTED message. Plain
  // arrows only, never while typing in a field or with a modal/menu open —
  // and the handlers themselves no-op while generating.
  const [kbdSel, setKbdSel] = useState(null); // nodeId | null
  useEffect(() => { setKbdSel(null); }, [ui.chatId]); // selection is per chat view
  // Any click/touch drops the keyboard selection — the ring belongs to arrow-key
  // navigation only, and a pointer user shouldn't have to Esc it away.
  useEffect(() => {
    if (!kbdSel) return;
    const clear = () => setKbdSel(null);
    window.addEventListener('pointerdown', clear);
    return () => window.removeEventListener('pointerdown', clear);
  }, [kbdSel]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (kbdSel && !modal && !ctxMenu) setKbdSel(null);
        return;
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (modal || ctxMenu) return;
      // Any modal in the DOM — including LOCAL ones the `modal` state doesn't
      // know about (image lightbox, cropper) — owns the arrow keys now; the
      // lightbox uses ←/→ to cycle image takes.
      if (document.querySelector('.modal-overlay')) return;
      if (e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
      const c = ref.current.chats[ui.chatId];
      if (!c) return;
      const path = getActivePath(c.messages, c.activeLeafId);
      if (!path.length) return;
      const selIdx = kbdSel ? path.findIndex(n => n.id === kbdSel) : -1;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (e.key === 'ArrowUp') {
          // none selected → start at the leaf and walk up from there
          setKbdSel(path[selIdx === -1 ? path.length - 1 : Math.max(0, selIdx - 1)].id);
        } else {
          if (selIdx === -1) return; // nothing selected — ↓ stays at the live bottom
          if (selIdx >= path.length - 1) setKbdSel(null); // ↓ past the leaf exits selection
          else setKbdSel(path[selIdx + 1].id);
        }
        return;
      }
      // ←/→: the selected message wins, else the leaf.
      const target = (selIdx >= 0 ? path[selIdx] : null) ?? path[path.length - 1];
      if (e.key === 'ArrowLeft') {
        if (target.activeSwipe <= 0) return;
        e.preventDefault();
        onSwipe(target.id, -1);
      } else {
        e.preventDefault();
        if (target.activeSwipe < target.swipes.length - 1) onSwipe(target.id, 1);
        else if (target.role === 'assistant') onRegenerate(target.id); // no-ops when busy
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, ctxMenu, auxBusy, ui.chatId, kbdSel]);
  const onBranch = (nodeId) => {
    const c = ref.current.chats[ui.chatId];
    if (!c) return;
    const b = branchChat(c, nodeId); // deep-copies messages + memoryStore
    upsertChat(b.id, b);
    setUi(u => ({ ...u, chatId: b.id }));
  };
  const onRewind = (nodeId) => {
    if (genRef.current) return; // no tree surgery mid-generation
    const c = ref.current.chats[ui.chatId];
    if (c) saveChat(rewindChat(c, nodeId)); // rolls memoryStore back too
  };
  const onDeleteMsg = (nodeId) => {
    if (genRef.current) return; // no tree surgery mid-generation
    const c = ref.current.chats[ui.chatId]; const n = c?.messages[nodeId];
    if (!n?.parentId) return;
    const messages = deleteSubtree(c.messages, nodeId);
    const leaf = messages[c.activeLeafId] ? c.activeLeafId : n.parentId;
    saveChat({ ...c, messages, activeLeafId: leaf });
  };

  // ---- scenarios / personas / chats ----
  const onSaveScenario = (draft) => { upsertScenario(draft.id, draft); setModal(null); };
  // Deleting a scenario/character/persona leaves dangling links in chats that
  // reference it — the confirm names the affected-chat count so it's an
  // informed choice. (Sidebar/PersonaManager call these handlers directly.)
  const onDeleteScenario = (id) => {
    const refs = Object.values(ref.current.chats).filter(c => c.scenarioId === id).length;
    const name = ref.current.scenarios[id]?.name ?? id;
    if (!confirm(`Delete scenario "${name}"?${refs ? `\n${refs} chat(s) use it — they keep working but lose its lore/prompt.` : ''}`)) return;
    removeScenario(id);
    if (ui.scenarioId === id) setUi(u => ({ ...u, scenarioId: null }));
  };
  // New chat from a scenario (scenarioId) or directly with a global character
  // (characterId). Selecting the matching sidebar filter keeps the new chat
  // visible — a scenario filter would hide a character chat and vice versa.
  const createChat = ({ scenarioId = null, characterId = null }, personaId, newPersonaName) => {
    let pid = personaId || null;
    if (!pid && newPersonaName.trim()) {
      pid = uid();
      upsertPersona(pid, { id: pid, name: newPersonaName.trim(), description: '' });
    }
    const scen = scenarioId ? ref.current.scenarios[scenarioId] : null;
    const char = characterId ? ref.current.characters[characterId] : null;
    if (!scen && !char) return;
    const c = newChat({ scenario: scen, character: char, personaId: pid, dateFormat: settings?.dateFormat });
    upsertChat(c.id, c);
    // Remember the persona choice for the next New chat (per-device; the
    // explicit default persona, when set, takes precedence — see NewChatModal).
    setUi(u => ({ ...u, lastPersonaId: pid ?? null, ...(scen
      ? { chatId: c.id, scenarioId: scen.id, characterId: null }
      : { chatId: c.id, scenarioId: null, characterId: char.id }), ...(overlayPanes ? { sidebarCollapsed: true } : {}) }));
    setModal(null);
  };
  const onDeleteCharacter = (id) => {
    const refs = Object.values(ref.current.chats).filter(c => c.characterIds?.includes(id)).length;
    const name = ref.current.characters[id]?.name ?? id;
    if (!confirm(`Delete character "${name}"?${refs ? `\n${refs} chat(s) link to it — the link becomes inert.` : ''}`)) return;
    removeCharacter(id); // links dangle in scenarios/chats — resolveCharacters skips them
    if (ui.characterId === id) setUi(u => ({ ...u, characterId: null }));
  };
  const onDeleteChat = (id) => {
    // Abort generation in flight for this chat before removing it.
    if (generating?.chatId === id) genRef.current?.abort.abort();
    removeChat(id);
    // Drop per-chat session state too, or it lingers for the whole session.
    setManifests(m => { if (!(id in m)) return m; const n = { ...m }; delete n[id]; return n; });
    setSuggestions(s => (s?.chatId === id ? null : s));
    if (ui.chatId === id) setUi(u => ({ ...u, chatId: null }));
  };

  // Generate an assistant reply as a child of a user message (defaults to the
  // active leaf). A new assistant child becomes the active leaf, so repeated
  // calls create sibling assistant branches — same semantics as swipes.
  const onGenerateReply = (nodeId = null) => {
    const c = ref.current.chats[ui.chatId];
    if (!c || genRef.current || auxBusy.length || !generationReady(c)) return;
    const parent = c.messages[nodeId ?? c.activeLeafId];
    if (!parent || parent.role !== 'user') return;
    const { chat: c1, id } = appendMessage(c, parent.id, 'assistant', '');
    upsertChat(c1.id, { ...c1, updatedAt: Date.now() });
    fireGeneration(c1, id, { fresh: true });
  };

  // ---- export / import ----
  // A scenario export is a BUNDLE: the scenario plus its linked global
  // characters (scenario.characterIds), so the file works standalone on
  // import. The legacy single-scenario type stays importable (below).
  const onExportScenario = (id) => {
    const s = scenarios[id];
    if (!s) return;
    downloadJSON(`fictionpad-scenario-${s.name ?? id}.json`, {
      type: 'fictionpad-scenario-bundle', version: 1,
      data: { scenario: s, characters: (s.characterIds ?? []).map(cid => characters[cid]).filter(Boolean) },
    });
  };
  const onExportChat = (c) =>
    downloadJSON(`fictionpad-chat-${c.name}.json`, { type: 'fictionpad-chat', version: 1, data: c });
  // ---- import/export: files from the sidebar's ↑ button. Imported JSON is
  // normalized (pure core) before upsert — a hand-edited/third-party file can
  // lack fields the editors and message UI assume (the draft.lorePieces crash
  // class); already-stored malformed entities heal at editor draft init.
  const onExportCharacter = (id) =>
    downloadJSON(`fictionpad-character-${characters[id]?.name ?? id}.json`, { type: 'fictionpad-character', version: 1, data: characters[id] });
  // Duplicate in place: deep clone with a fresh id and a " (copy)" name
  // suffix — the export → edit-the-id → reimport roundtrip as one click. A
  // scenario clone keeps its linked character ids (links, not copies).
  const onDuplicateScenario = (id) => {
    const s = scenarios[id];
    if (!s) return;
    const copy = normalizeScenario({ ...deepClone(s), id: uid(), name: `${s.name} (copy)` });
    upsertScenario(copy.id, copy);
  };
  const onDuplicateCharacter = (id) => {
    const c = characters[id];
    if (!c) return;
    const copy = normalizeCharacter({ ...deepClone(c), id: uid(), name: `${c.name} (copy)` });
    upsertCharacter(copy.id, copy);
  };
  // Export a character-type lore piece (chat-registered or scenario-owned) as
  // a global character card: pure-core mapping, fresh id, provenance stripped.
  // The new card just appears in the sidebar Characters section.
  const onExportPieceToCharacter = (piece) => {
    const c = normalizeCharacter(characterFromPiece(piece));
    if (!c.name.trim()) return setError('Give the piece a title first — it becomes the character name.');
    upsertCharacter(c.id, c);
  };
  // PNG card export: the avatar IS the card image — the full-res companion
  // when one exists (avatarFull || avatar) — redrawn to PNG at natural size
  // (long edge ≤1024), with the chara_card v2 JSON (character + its first
  // linked scenario when one exists — buildCharacterCard tolerates null)
  // embedded as a tEXt chunk (pure core). Importable by SillyTavern-style tools.
  const onExportCharacterPng = async (character) => {
    if (!character?.avatar)
      return setError('Set an avatar first — the avatar becomes the card image.');
    try {
      const img = await loadImage(character.avatarFull || character.avatar);
      const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.naturalWidth * scale));
      cv.height = Math.max(1, Math.round(img.naturalHeight * scale));
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const blob = await new Promise((resolve) => cv.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('the browser refused to encode the PNG');
      const u8 = new Uint8Array(await blob.arrayBuffer());
      const scenario = Object.values(scenarios ?? {})
        .find(s => (s.characterIds ?? []).includes(character.id)) ?? null;
      downloadBlob(new Blob([embedPngCardJson(u8, JSON.stringify(buildCharacterCard(scenario, character)))],
        { type: 'image/png' }), `${character.name}.png`);
    } catch (e) { setError(`PNG card export failed: ${e?.message ?? e}`); }
  };
  const onImport = async () => {
    const file = await pickFile('.json,application/json,.png,image/png');
    if (!file) return;
    let obj, cardArt = null;
    try {
      if (file.type === 'image/png' || /\.png$/i.test(file.name ?? '')) {
        // Character-card PNG: the card JSON rides in a tEXt chunk (pure core).
        const json = extractPngCardJson(new Uint8Array(await file.arrayBuffer()));
        if (json == null)
          return setError('Import failed: that PNG embeds no character card (no "chara"/"ccv3" text chunk).');
        obj = JSON.parse(json);
        // The PNG's own art becomes the imported character's avatar pair,
        // decoded once: the 256px thumb and the uncropped ≤1024 avatarFull
        // (aspect kept — the Avatar component's object-fit: cover crops). A
        // decode failure never fails the import: the card data matters, not
        // the art.
        try {
          const artImg = await loadImageFromFile(file);
          cardArt = { avatar: downscaleImageToDataURL(artImg, 256), avatarFull: downscaleImageToDataURL(artImg, 1024) };
        } catch (e) { console.warn('import: could not decode the card art', e); }
      } else {
        obj = JSON.parse(await file.text());
      }
    } catch (e) { return setError(`Import failed: ${e?.message ?? e}`); }
    if (obj.type === 'fictionpad-scenario' && obj.data?.name != null) {
      // Legacy single-scenario export: fresh id, never clobbers an existing one.
      const s = normalizeScenario({ ...obj.data, id: uid() });
      upsertScenario(s.id, s);
      setUi(u => ({ ...u, scenarioId: s.id }));
    } else if (obj.type === 'fictionpad-scenario-bundle' && obj.data?.scenario?.name != null) {
      // Bundle: fresh ids for the scenario AND every bundled character —
      // import never clobbers an existing entity (a shared file re-imported
      // by its author, or an updated re-share, carries the same ids). The
      // scenario's characterIds remap to the new character ids; ids pointing
      // outside the bundle pass through untouched.
      const idMap = {};
      const chars = (obj.data.characters ?? []).filter(ch => ch?.name != null).map(ch => {
        const id = uid();
        if (ch.id) idMap[ch.id] = id;
        return normalizeCharacter({ ...ch, id });
      });
      const s = normalizeScenario({ ...obj.data.scenario, id: uid(),
        characterIds: (obj.data.scenario.characterIds ?? []).map(cid => idMap[cid] ?? cid) });
      upsertScenario(s.id, s);
      for (const ch of chars) upsertCharacter(ch.id, ch);
      setUi(u => ({ ...u, scenarioId: s.id }));
    } else if (obj.type === 'fictionpad-character' && obj.data?.name != null) {
      const ch = normalizeCharacter({ ...obj.data, id: uid() });
      upsertCharacter(ch.id, ch);
      setUi(u => ({ ...u, characterId: ch.id, scenarioId: null }));
    } else if (obj.type === 'fictionpad-chat' && obj.data?.messages) {
      const c = normalizeChat({ ...obj.data, id: uid() });
      upsertChat(c.id, c);
      setUi(u => ({ ...u, chatId: c.id, scenarioId: c.scenarioId ?? null }));
      if (c.scenarioId && !ref.current.scenarios[c.scenarioId])
        setError('Chat imported, but its scenario is not present in this browser.');
    } else {
      // Not a FictionPad export — try a character card (chara_card v1/v2/v3
      // JSON, or the payload of a card PNG): always becomes a global
      // character, plus a linked scenario only when the card carries
      // scenario-level content (field mapping in parseCharacterCard).
      const card = parseCharacterCard(obj);
      if (!card)
        return setError('Unrecognized JSON: expected a FictionPad scenario, character, chat or character card export. Full backups import via Settings → Storage.');
      if (cardArt) Object.assign(card.character, cardArt); // a card PNG keeps its art as the avatar pair (256 thumb + ≤1024 full)
      upsertCharacter(card.character.id, normalizeCharacter(card.character));
      if (card.scenario) upsertScenario(card.scenario.id, card.scenario);
      setUi(u => ({ ...u, scenarioId: card.scenario?.id ?? null,
        characterId: card.scenario ? null : card.character.id }));
    }
  };

  // ---- full backup (Settings → Connection): everything in one JSON ----
  // serverToken is per-device and NEVER leaves the machine — stripped here on
  // export and ignored on import (same rule as the Meta/app.settings sync).
  const onExportAll = () => {
    const { serverToken, ...rest } = settingsRaw ?? {};
    downloadJSON(`fictionpad-backup-${new Date().toISOString().slice(0, 10)}.json`, {
      type: 'fictionpad-backup', version: 1, exportedAt: Date.now(),
      data: { scenarios, chats, personas, characters, settings: rest },
    });
  };
  // Upserts everything by id (last write wins — entities absent from the file
  // are kept). Returns { note, settings } for the Settings modal, null when
  // the picker was cancelled; throws on invalid input.
  const onImportAll = async () => {
    const obj = await pickJSONFile();
    if (!obj) return null;
    if (obj.__error) throw new Error(`not valid JSON (${obj.__error})`);
    if (obj.type !== 'fictionpad-backup' || !obj.data || typeof obj.data !== 'object')
      throw new Error('not a FictionPad backup file (expected type "fictionpad-backup") — scenario/character/chat files import from the sidebar instead.');
    const d = obj.data;
    const counts = { scenarios: 0, chats: 0, characters: 0, personas: 0 };
    for (const s of Object.values(d.scenarios ?? {}))
      if (s?.id && s.name != null) { upsertScenario(s.id, normalizeScenario(s)); counts.scenarios++; }
    // Chats upsert through the same path as normal edits, so importing over
    // the currently open chat replaces the live copy instead of forking state.
    for (const c of Object.values(d.chats ?? {}))
      if (c?.id && c.messages) { upsertChat(c.id, normalizeChat(c)); counts.chats++; }
    for (const ch of Object.values(d.characters ?? {}))
      if (ch?.id && ch.name != null) { upsertCharacter(ch.id, normalizeCharacter(ch)); counts.characters++; }
    for (const p of Object.values(d.personas ?? {}))
      if (p?.id && p.name != null) { upsertPersona(p.id, p); counts.personas++; }
    let applied = null;
    if (d.settings && typeof d.settings === 'object') {
      const { serverToken, ...rest } = d.settings; // any serverToken in the file is dropped
      applied = rest;
      // One setSettings commit → the settings-sync effect uploads it once.
      setSettings(prev => ({ ...rest, serverToken: prev?.serverToken ?? '' }));
    }
    const parts = Object.entries(counts).map(([k, n]) => `${n} ${k}`);
    if (applied) parts.push('settings');
    return { note: `Imported ${parts.join(', ')}.`, settings: applied };
  };
  // Server .db backup: fetch (anchor navigation can't send the Bearer header),
  // then save the blob under the server's Content-Disposition filename. On a
  // Basic-auth deployment a stale Bearer earns a 401 — retry bare so the
  // browser's cached Basic creds take over (mirrors ServerDBAdapter).
  const onServerBackup = async () => {
    const tok = ref.current.settings.serverToken ?? '';
    let res = await fetch('/backup', { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
    if (res.status === 401 && tok) res = await fetch('/backup');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const m = (res.headers.get('Content-Disposition') ?? '').match(/filename="([^"]+)"/);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = m?.[1] ?? 'fictionpad-backup.db';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const onPreview = (chatId = ui.chatId) => {
    const c = ref.current.chats[chatId];
    if (!c) return;
    const st = ref.current.settings;
    // Same platform-prompt composition as runGeneration so the preview counts
    // the speaker/tools prompts too. Semantic activation is NOT rerun here
    // (async embeddings) — the preview is keyword-trigger lore only.
    const auto = resolveLimits(st, c.settings?.model || st.model);
    const { messages, manifest: man } = assemblePrompt({
      scenario: ref.current.scenarios[c.scenarioId],
      persona: c.personaId ? ref.current.personas[c.personaId] : null,
      chat: c, settings: { ...st,
        // Match runGeneration's merge: both per-chat overrides shadow the
        // auto-resolved globals, or the preview's budget/reserve disagree
        // with real sends.
        contextLength: c.settings?.contextLength ?? auto.contextLength,
        maxTokens: c.settings?.maxTokens ?? auto.maxTokens },
      platformPrompt: buildPlatformPrompt(st),
      characters: ref.current.characters,
    });
    // Surface the keyword-only caveat when smart pieces could have fired.
    if (st.embeddingModel && mergedLorePieces(ref.current.scenarios[c.scenarioId], c, ref.current.characters)
        .some(p => p && p.enabled !== false && !p.pinned && p.smart))
      man.warnings.push('Preview: semantic activation not run (embeddings) — semantic pieces show keyword-trigger results only.');
    if (st.embeddingModel && st.memoryRecall === 'smart'
        && (c.memoryStore?.memories ?? []).some(m => m && !m.pinned))
      man.warnings.push('Preview: smart memory recall not run (embeddings) — memories show plain recency order.');
    setManifestFor(c.id, man, messages);
  };

  // Context-horizon marker: when the last generation dropped older messages,
  // the chat log draws a divider above the oldest message it actually saw.
  const histLayer = manifest?.layers?.history;
  const horizon = (histLayer?.dropped > 0 && (histLayer.keptIds ?? []).length)
    ? { id: histLayer.keptIds[0], dropped: histLayer.dropped } : null;

  // Suggestions fire after every swipe and would flood the aux list — hidden
  // unless the user opts in (Settings → Features). Entries are per-chat: each
  // inspector (drawer, chat panel) shows only its own chat's aux calls.
  const shownAuxLog = (chatId) => {
    const list = settings.auxShowSuggestions ? auxLog : auxLog.filter(a => a.kind !== 'suggestions');
    return list.filter(a => !a.chatId || a.chatId === chatId);
  };

  // Ribbon pane toggles: «/» edge arrows on phones always, and on desktop when
  // the Appearance setting asks for them; otherwise the brand/Inspector labels.
  const ribbonArrows = isMobile || settings.sidebarArrows;
  // Inset the centered title by the actual toggle-button widths so a long chat
  // name ellipsizes instead of sliding under them.
  const leftBtnRef = useRef(null), rightBtnRef = useRef(null);
  const [btnW, setBtnW] = useState({ l: 0, r: 0 });
  useEffect(() => {
    const l = leftBtnRef.current?.offsetWidth ?? 0, r = rightBtnRef.current?.offsetWidth ?? 0;
    if (l !== btnW.l || r !== btnW.r) setBtnW({ l, r });
  }, [viewportW, ribbonArrows]);

  return html`
    <div class="app ${dragging ? 'dragging' : ''}">
      ${overlayPanes && (!sidebarCollapsed || ui.drawer) && html`
        <div class="scrim" onClick=${() => { if (!sidebarCollapsed) toggleSidebar(); closeDrawer(); }} />`}
      ${error && html`<div class="banner err-toast" role="alert">${error}<button class="btn small ghost" title="Dismiss" onClick=${() => setError(null)}>✕</button></div>`}
      <div class="topbar">
        <div class="topbar-inner">
          <span ref=${leftBtnRef} style=${{ display: 'inline-flex', flex: 'none' }}>
            ${ribbonArrows
              ? html`<button class="btn small ghost ${sidebarCollapsed ? '' : 'active'}" title=${sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
                  onClick=${toggleSidebar}>${sidebarCollapsed ? '»' : '«'}</button>`
              : html`<button class="btn small ghost ${sidebarCollapsed ? '' : 'active'}"
                  title=${sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'} onClick=${toggleSidebar}>FictionPad</button>`}
          </span>
          ${chat && html`<div class="mid"
            style=${{ left: `${(isMobile ? 8 : 14) + padL + btnW.l + 6}px`, right: `${(isMobile ? 8 : 14) + padR + btnW.r + 6}px` }}>
            <span class="title">${chat.name}</span>
            <button class="btn small ghost" title="Close chat"
              onClick=${() => setUi(u => ({ ...u, chatId: null }))}>✕</button>
            <span class="sub">${chat.scenarioId
              ? (scenarios[chat.scenarioId]?.name ?? '(missing scenario)')
              : ((chat.characterIds ?? []).map(id => characters[id]?.name).filter(Boolean).join(', ') || '(no scenario)')} · ${personaName}</span>
          </div>`}
          ${generating && generating.chatId !== chat?.id && html`
            <span class="hint" style=${{ fontStyle: 'normal', flex: 'none' }}
              title=${`Generating in "${chats[generating.chatId]?.name ?? 'another chat'}"`}>generating…</span>`}
          <span class="spacer"></span>
          <span ref=${rightBtnRef} style=${{ display: 'inline-flex', flex: 'none' }}>
            ${ribbonArrows
              ? html`<button class="btn small ghost ${ui.drawer ? 'active' : ''}"
                  title="Inspector / Samplers / Memory / Chat panel"
                  onClick=${() => ui.drawer ? closeDrawer() : toggleDrawer(lastDrawerTabRef.current ?? 'inspector')}>${ui.drawer ? '»' : '«'}</button>`
              : html`<button class="btn small ghost ${ui.drawer ? 'active' : ''}"
                  title="Inspector panel (Inspector / Samplers / Memory / Chat tabs)"
                  onClick=${() => ui.drawer ? closeDrawer() : toggleDrawer(lastDrawerTabRef.current ?? 'inspector')}>Inspector</button>`}
          </span>
        </div>
      </div>
      <div class="app-body">
      <${Sidebar}
        scenarios=${scenarios} chats=${chats} characters=${characters}
        selectedScenarioId=${ui.scenarioId} selectedCharacterId=${ui.characterId ?? null} selectedChatId=${ui.chatId}
        onSelectScenario=${(id) => setUi(u => ({ ...u, scenarioId: id, ...(id ? { characterId: null } : {}) }))}
        onSelectCharacter=${(id) => setUi(u => ({ ...u, characterId: id, ...(id ? { scenarioId: null } : {}) }))}
        onSelectChat=${(id) => setUi(u => ({ ...u, chatId: id,
          // In overlay-pane mode (phones, contended widths) the sidebar
          // covers the chat — close it so the chat shows.
          ...(overlayPanes ? { sidebarCollapsed: true } : {}) }))}
        onNewScenario=${() => setModal({ kind: 'scenario', scenario: newScenario() })}
        onEditScenario=${(id) => setModal({ kind: 'scenario', scenario: scenarios[id] })}
        onDeleteScenario=${onDeleteScenario}
        onNewChat=${(scenarioId) => setModal({ kind: 'newChat', scenarioId })}
        onNewCharacter=${() => setModal({ kind: 'character', character: null })}
        onEditCharacter=${(id) => setModal({ kind: 'character', character: characters[id] ?? null })}
        onDeleteCharacter=${onDeleteCharacter}
        onNewCharacterChat=${(characterId) => setModal({ kind: 'newChat', characterId })}
        onExportCharacter=${onExportCharacter}
        onExportScenario=${onExportScenario}
        onImport=${onImport}
        onOpenPersonas=${() => setModal({ kind: 'personas' })}
        onOpenSettings=${() => setModal({ kind: 'settings' })}
        sideCollapsed=${ui.sideCollapsed ?? {}}
        onToggleSection=${(key) => setUi(u => ({ ...u, sideCollapsed: { ...(u.sideCollapsed ?? {}), [key]: !(u.sideCollapsed ?? {})[key] } }))}
        collapsed=${sidebarCollapsed && !peekLeft}
        peek=${peekLeft} peekLeave=${peekLeft ? () => setPeek(null) : null}
        onDeleteChat=${onDeleteChat}
        onChatAction=${chatAction}
        onChatContextMenu=${(chatId, x, y) => setCtxMenu({ chatId, x, y })}
        onScenarioContextMenu=${(id, x, y) => setCtxMenu({ x, y, items: [
          { label: 'New chat', fn: () => setModal({ kind: 'newChat', scenarioId: id }) },
          { label: 'Edit', fn: () => setModal({ kind: 'scenario', scenario: scenarios[id] }) },
          { label: 'Export JSON', fn: () => onExportScenario(id) },
          { label: 'Duplicate', fn: () => onDuplicateScenario(id) },
          '-',
          { label: 'Delete…', fn: () => onDeleteScenario(id), danger: true },
        ] })}
        onCharacterContextMenu=${(id, x, y) => setCtxMenu({ x, y, items: [
          { label: 'New chat', fn: () => setModal({ kind: 'newChat', characterId: id }) },
          { label: 'Edit', fn: () => setModal({ kind: 'character', character: characters[id] ?? null }) },
          { label: 'Export JSON', fn: () => onExportCharacter(id) },
          { label: 'Duplicate', fn: () => onDuplicateCharacter(id) },
          { label: 'Export PNG card', fn: () => onExportCharacterPng(characters[id]),
            disabled: !characters[id]?.avatar,
            title: characters[id]?.avatar ? null : 'Set an avatar first — the avatar becomes the card image.' },
          '-',
          { label: 'Delete…', fn: () => onDeleteCharacter(id), danger: true },
        ] })}
        storageKind=${storageKind} saveRetrying=${saveRetrying}
        width=${peekLeft ? clampPane(ui.sbWidth ?? autoPaneW) : sbW} onDragStart=${paneDragStart('left')} onResetWidth=${() => resetPaneWidth('left')} />
      ${settings.edgePeek !== false && !isMobile && sidebarCollapsed && html`
        <div class="pane-edge left" onPointerEnter=${peekEnter('left')} onPointerLeave=${peekCancel} />`}
      ${settings.edgePeek !== false && !isMobile && !ui.drawer && html`
        <div class="pane-edge right" onPointerEnter=${peekEnter('right')} onPointerLeave=${peekCancel} />`}
      <div class="center-col" style=${{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, paddingLeft: padL, paddingRight: padR }}>
        ${storageFailed && html`<div class="banner">IndexedDB unavailable — data will not persist across reloads.</div>`}
        ${saveFailed && html`<div class="banner">${saveFailed}</div>`}
        <div style=${{ flex: 1, display: 'flex', minHeight: 0 }}>
          <${ErrorBoundary} name="chat">
            <${ChatPane} chat=${chat} persona=${persona} characterNames=${characterNames} characterColors=${characterColors} cmdArgs=${cmdArgs}
              avatars=${characterAvatars} avatarsOn=${settings.avatarsEnabled !== false && chatHasAvatars}
              dateFormat=${settings.dateFormat} showThinking=${settings.showThinking !== false}
              generating=${generating?.chatId === chat?.id ? generating : null}
              genElsewhere=${!!generating && generating.chatId !== chat?.id}
              horizon=${horizon}
              suggestions=${suggestions}
              onPickSuggestion=${(s) => setComposerInject({ chatId: ui.chatId, text: s, nonce: Date.now() })}
              onRerollSuggestions=${() => {
                const c = ref.current.chats[ui.chatId];
                if (c && !auxBusy.length) fetchSuggestions(c, c.activeLeafId);
              }}
              composerInject=${composerInject} auxBusy=${auxBusy}
              scrollTargetRef=${scrollTargetRef} kbdSel=${kbdSel}
              onSubmitInput=${handleInput}
              onStop=${() => { genRef.current?.abort.abort(); for (const c of auxCtls.current) c.abort(); }}
              onEdit=${onEdit} onRegenerate=${onRegenerate} onSwipe=${onSwipe} onSwipeTo=${onSwipeTo}
              onImgSwipe=${onImgSwipe} onImgRegen=${onImgRegen} imagesEnabled=${!!settings.imagesEnabled}
              onJump=${onJump} onOpenBranches=${onOpenBranches}
              onOpenCharacter=${onOpenCharacterPiece}
              onBranch=${onBranch} onRewind=${onRewind} onDeleteMsg=${onDeleteMsg}
              onImpersonate=${settings.impersonate !== false ? onImpersonate : null}
              onOpenMemory=${() => peekRight ? setPeekTab('memory') : setUi(u => ({ ...u, drawer: 'memory' }))}
              onGenerateReply=${onGenerateReply} onReply=${onGenerateReply} onRegenFromToken=${onRegenFromToken} />
          <//>
        </div>
      </div>
      <${RightDrawer}
        chat=${chat} tab=${ui.drawer ?? (peekRight ? peekTab ?? lastDrawerTabRef.current ?? 'inspector' : null)}
        onTab=${(t) => peekRight ? setPeekTab(t) : setUi(u => ({ ...u, drawer: t }))}
        peek=${peekRight} peekLeave=${peekRight ? () => setPeek(null) : null}
        manifest=${manifest} realCounts=${realCounts} onPreview=${() => onPreview()} auxLog=${shownAuxLog(ui.chatId)}
        cap=${settings.memoryCap ?? MEMORY_CAP}
        personas=${personas} scenario=${chat ? scenarios[chat.scenarioId] : null} characters=${characters}
        settings=${settings} onUpdateSettings=${updateSettings}
        onExport=${() => chat && onExportChat(chat)}
        onDelete=${() => { if (chat && confirm(`Delete chat "${chat.name}"?`)) onDeleteChat(chat.id); }}
        dateFormat=${settings.dateFormat} memoryEvery=${settings.memoryEvery}
        onUpdateChat=${saveChat}
        onSummarize=${() => chat && summarizeNow(chat)} summarizing=${summarizing}
        width=${peekRight ? clampPane(ui.dwWidth ?? autoPaneW) : dwW} onDragStart=${paneDragStart('right')} onResetWidth=${() => resetPaneWidth('right')}
        onGenerate=${runGen}
        onGenerateAvatar=${settings.imagesEnabled ? generateAvatar : null}
        onExportPiece=${onExportPieceToCharacter}
        onOpenBranches=${onOpenBranches}
        onClose=${peekRight ? () => setPeek(null) : closeDrawer} />
      </div>
    </div>
    ${modal?.kind === 'scenario' && html`
      <${ErrorBoundary} name="scenario editor"><${ScenarioEditor} scenario=${modal.scenario} characters=${characters} settings=${settings} onSave=${onSaveScenario} onGenerate=${runGen} onGenerateAvatar=${settings.imagesEnabled ? generateAvatar : null} onExportPiece=${onExportPieceToCharacter} onClose=${() => setModal(null)} /><//>`}
    ${modalPiece && html`
      <${ErrorBoundary} name="lore piece"><${LorePieceEditor} piece=${modalPiece} isNew=${false}
        allPieces=${mergedLorePieces(chatScenario, chat, characters)}
        onSave=${(draft) => {
          if (modal.source === 'chat') saveChat({ ...chat, lorePieces: (chat.lorePieces ?? []).map(q => q.id === draft.id ? draft : q) });
          else upsertScenario(chatScenario.id, { ...chatScenario, lorePieces: (chatScenario.lorePieces ?? []).map(q => q.id === draft.id ? draft : q) });
          setModal(null);
        }}
        onClose=${() => setModal(null)} onGenerate=${runGen}
        onGenerateAvatar=${settings.imagesEnabled ? generateAvatar : null} /><//>`}
    ${modal?.kind === 'character' && html`
      <${ErrorBoundary} name="character editor"><${CharacterEditor} character=${modal.character} scenarios=${scenarios} settings=${settings}
        chatLinkCount=${modal.character ? Object.values(chats).filter(c => c.characterIds?.includes(modal.character.id)).length : 0}
        onUpsert=${upsertCharacter} onGenerate=${runGen} onGenerateAvatar=${settings.imagesEnabled ? generateAvatar : null} onClose=${() => setModal(null)} /><//>`}
    ${modal?.kind === 'personas' && html`
      <${ErrorBoundary} name="personas"><${PersonaManager} personas=${personas} onUpsert=${upsertPersona}
        onGenerateAvatar=${settings.imagesEnabled ? generateAvatar : null}
        defaultPersonaId=${settings.defaultPersonaId ?? ''}
        onSetDefault=${(id) => updateSettings({ defaultPersonaId: id })}
        onRemove=${(id) => {
          const refs = Object.values(ref.current.chats).filter(c => c.personaId === id).length;
          const name = ref.current.personas[id]?.name ?? id;
          if (confirm(`Delete persona "${name}"?${refs ? `\n${refs} chat(s) use it — they fall back to the default {{user}} name.` : ''}`)) {
            if ((settings.defaultPersonaId ?? '') === id) updateSettings({ defaultPersonaId: '' });
            removePersona(id);
          }
        }}
        onClose=${() => setModal(null)} /><//>`}
    ${modal?.kind === 'settings' && html`
      <${ErrorBoundary} name="settings"><${SettingsModal} settings=${settings} theme=${theme} onThemeChange=${setTheme}
        accent=${accent} onAccentChange=${setAccent} initialDraft=${settingsDraft}
        onOpenLogitBias=${(draft) => { setSettingsDraft(draft ?? null); setModal({ kind: 'logitBias' }); }}
        storageKind=${storageKind} onUpload=${migrateUpload} onDownload=${migrateDownload}
        onExportAll=${onExportAll} onImportAll=${onImportAll} onServerBackup=${onServerBackup}
        onSave=${(s) => { setSettingsDraft(null); setSettings(prev => ({ ...s, logitBias: prev?.logitBias ?? s.logitBias ?? {} })); setModal(null); }}
        onClose=${() => { setSettingsDraft(null); setModal(null); }} /><//>`}
    ${modal?.kind === 'logitBias' && html`
      <${ErrorBoundary} name="logit bias"><${LogitBiasModal}
        logitBias=${settings.logitBias ?? {}}
        onChange=${(map) => setSettings(s => ({ ...(s ?? {}), logitBias: map }))}
        onTokenize=${(prompt) => tokenize({ endpoint: effectiveEndpoint(settings, storageKind === 'server'), apiKey: settings.apiKey, serverToken: settings.serverToken, model: settings.model, prompt })}
        onClose=${() => setModal(settingsDraft ? { kind: 'settings' } : null)} /><//>`}
    ${modal?.kind === 'newChat' && (scenarios[modal.scenarioId] || characters[modal.characterId]) && html`
      <${ErrorBoundary} name="new chat"><${NewChatModal} scenario=${scenarios[modal.scenarioId] ?? null}
        character=${characters[modal.characterId] ?? null} personas=${personas}
        initialPersonaId=${(settings.defaultPersonaId && personas[settings.defaultPersonaId]) ? settings.defaultPersonaId
          : (ui.lastPersonaId && personas[ui.lastPersonaId]) ? ui.lastPersonaId : ''}
        onCreate=${(pid, newName) => createChat({ scenarioId: modal.scenarioId ?? null, characterId: modal.characterId ?? null }, pid, newName)}
        onClose=${() => setModal(null)} /><//>`}
    ${modal?.kind === 'recap' && html`
      <${ErrorBoundary} name="recap"><${RecapModal} text=${modal.text} onClose=${() => setModal(null)}
        onSaveMemory=${() => {
          const c = ref.current.chats[ui.chatId];
          if (c) {
            const store = pushMemory(c, modal.text);
            saveChat({ ...c, memoryStore: { ...store, cursor: c.memoryStore?.cursor ?? 0 } });
          }
        }} /><//>`}
    ${modal?.kind === 'chatPanel' && chats[modal.chatId] && html`
      <${ErrorBoundary} name="chat panel"><${ChatPanelModal}
        chat=${chats[modal.chatId]} tab=${modal.tab}
        onTab=${(tab) => setModal(m => ({ ...m, tab }))}
        manifest=${manifests[modal.chatId]?.manifest ?? null}
        realCounts=${modal.chatId === ui.chatId ? realCounts : null}
        onPreview=${() => onPreview(modal.chatId)} auxLog=${shownAuxLog(modal.chatId)}
        cap=${settings.memoryCap ?? MEMORY_CAP}
        personas=${personas} scenario=${scenarios[chats[modal.chatId]?.scenarioId]} characters=${characters} onUpdateChat=${saveChat}
        settings=${settings} onUpdateSettings=${updateSettings}
        dateFormat=${settings.dateFormat} memoryEvery=${settings.memoryEvery}
        onSummarize=${() => summarizeNow(chats[modal.chatId])} summarizing=${summarizing}
        onGenerate=${runGen}
        onGenerateAvatar=${settings.imagesEnabled ? generateAvatar : null}
        onExportPiece=${onExportPieceToCharacter}
        onOpenBranches=${() => onOpenBranches(modal.chatId)}
        onExport=${() => onExportChat(chats[modal.chatId])}
        onDelete=${() => { if (confirm(`Delete chat "${chats[modal.chatId].name}"?`)) { onDeleteChat(modal.chatId); setModal(null); } }}
        onClose=${() => setModal(null)} /><//>`}
    ${modal?.kind === 'branches' && chats[modal.chatId] && html`
      <${ErrorBoundary} name="branches"><${Modal} title="Chat branches" wide onClose=${() => setModal(null)}>
        <${BranchPanel} chat=${chats[modal.chatId]}
          personaName=${(chats[modal.chatId].personaId && personas[chats[modal.chatId].personaId]?.name?.trim()) || 'User'}
          generating=${generating?.chatId === modal.chatId}
          onJump=${(id) => { onJump(id, modal.chatId); setModal(null); }} />
      <//><//>`}
    ${ctxMenu && html`
      <${ContextMenu} x=${ctxMenu.x} y=${ctxMenu.y} onClose=${() => setCtxMenu(null)}
        items=${ctxMenu.items ?? [
          { label: 'Inspector', fn: () => chatAction(ctxMenu.chatId, 'inspector') },
          { label: 'Branches', fn: () => chatAction(ctxMenu.chatId, 'branches') },
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
