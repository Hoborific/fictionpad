// ============================================================================
// STORAGE — AbstractStorage (EventTarget + 500 ms debounced save queue) with
// an IndexedDB adapter. Entities are stored one-key-per-entity; the adapter
// keeps an in-memory cache that React reads synchronously.
// ============================================================================
const STORES = ['Scenarios', 'Personas', 'Chats', 'Meta', 'Characters'];

// Every imgref:<id> sentinel reachable in `value` (the mirror image of
// collectImageUrls, which finds data URLs). Lazy image loading leaves
// sentinels unresolved in cached entities, so reference scans (GC) must
// count both forms.
function collectImgrefIds(value, into = new Set()) {
  const walk = (v) => {
    if (typeof v === 'string') {
      if (!v.startsWith(IMGREF_PREFIX)) return;
      const m = IMGREF_RE.exec(v);
      if (m) into.add(m[1]);
      return;
    }
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k]);
  };
  walk(value);
  return into;
}

// UI → storage hydration channel. Components that render an entity's images
// call requestHydration(store, key) when they meet an unresolved sentinel;
// App registers the active adapter at boot. No-op unless the adapter lazily
// loads images (server storage with the images capability).
let _hydrator = null;
function registerHydrator(storage) { _hydrator = storage?.lazyImages ? storage : null; }
function requestHydration(store, key) { if (store && key) _hydrator?.hydrate(store, key); }

// gzip a string via CompressionStream (feature-detected by the caller).
async function gzipString(s) {
  const stream = new Blob([s]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

// True when `next` references fewer distinct in-memory image URLs than `prev`
// — the overwrite may have orphaned a stored image, so the caller sweeps.
function imageRefDropped(prev, next) {
  const before = new Set();
  collectImageUrls(prev, before);
  if (!before.size) return false;
  const after = new Set();
  collectImageUrls(next, after);
  for (const u of before) if (!after.has(u)) return true;
  return false;
}

class AbstractStorage extends EventTarget {
  constructor() {
    super();
    this.cache = Object.fromEntries(STORES.map(s => [s, {}]));
    // Mirror of the adapter-internal Images store (id → dataUrl). Entities in
    // cache hold data URLs (rehydrated); extraction to imgref: sentinels
    // happens only at the persistence boundary (see 30-core.js).
    this.images = new Map();
    // Adapters that support the Images store (IndexedDB always; server only
    // when /version advertises it) persist images out-of-band. Off = inline
    // mode: entities persist verbatim, exactly like before the feature.
    this.imagesEnabled = false;
    // Lazy image loading (ServerDBAdapter with the images capability): boot
    // does NOT pull the Images store; cached entities may hold unresolved
    // imgref: sentinels until hydrate(store, key) fetches them on demand.
    // Renderers guard sentinel srcs with requestHydration + a placeholder.
    this.lazyImages = false;
    this.saveQueue = new Map();
    this.saveTimer = null;
    this.retryTimer = null;
    this.gcTimer = null;
    // Streaming write coalescing: while a generation streams into a chat,
    // that key's debounce stretches to 3 s (the whole-chat row is re-sent per
    // flush — at 500 ms a long stream is pure upload churn). endStream
    // flushes immediately. Cache/ref updates stay per-token; only the
    // persistence cadence changes.
    this._streamKey = null;
    // Optimistic-concurrency park bench: keys whose put was refused with a
    // 409 (another device wrote first). They stay local-only until
    // resolveConflict picks a winner — re-putting would just 409 again.
    // ServerDBAdapter only; IndexedDB never conflicts (single-device).
    this.conflicts = new Map();
    // Connectivity restored → flush any re-queued writes immediately.
    if (typeof window !== 'undefined')
      window.addEventListener('online', () => this.flush());
  }
  async init() {}
  getAll(store) { return this.cache[store] ?? {}; }
  get(store, key) { return this.cache[store]?.[key]; }
  set(store, key, value) {
    const prev = this.cache[store][key];
    this.cache[store][key] = value;
    // Conflicted key: the cache keeps tracking edits (a "keep mine" resolution
    // pushes the CURRENT value), but no puts are enqueued meanwhile.
    if (!this.conflicts.has(`${store}/${key}`)) {
      this.saveQueue.set(`${store}/${key}`, { op: 'put', store, key, value });
      this.#schedule();
    }
    // Overwrites trigger GC too (not just remove()): an edit that drops the
    // last in-entity reference to a stored image — avatar cleared, swipe
    // images purged — must not leave the row orphaned.
    if (prev && this.imagesEnabled && imageRefDropped(prev, value)) this.#scheduleImageGc();
    this.dispatchEvent(new CustomEvent('storechange', { detail: { store, key } }));
  }
  remove(store, key) {
    const prevName = this.cache[store][key]?.name; // stashed on a delete-conflict for the UI
    delete this.cache[store][key];
    // Deleting a conflicted entity ends the conflict — the delete is blind.
    this._clearConflict(store, key);
    this.saveQueue.set(`${store}/${key}`, { op: 'delete', store, key, name: prevName });
    this.#schedule();
    this.#scheduleImageGc();
    this.dispatchEvent(new CustomEvent('storechange', { detail: { store, key } }));
  }
  // Shared persist path for puts: extract images out-of-band (rows first, so
  // the entity never references a missing image), then the entity itself.
  // New ids join this.images only after their row landed — a flush retry
  // re-extracts cleanly (dedupe via known is idempotent).
  async persistEntity(store, key, value) {
    if (!this.imagesEnabled) { await this.persistPut(store, key, value); return; }
    const { entity, images } = extractImages(value, this.images);
    for (const [id, dataUrl] of images) {
      await this.persistImage(id, dataUrl);
      this.images.set(id, dataUrl);
    }
    await this.persistPut(store, key, entity);
  }
  // Image GC: a reference scan, never refcounting. Debounced behind deletes
  // and reference-dropping overwrites (and after the flush that lands them):
  // walk the whole cache (data URLs are rehydrated there) and drop every
  // stored image no entity references. Cache is the single source of truth,
  // so a live — or merely queued — entity's images can never be reclaimed.
  // Inline mode: nothing stored out-of-band, sweep stays a no-op. The server
  // adapter overrides collectImages with a server-side sweep when /version
  // advertises the gc capability.
  #scheduleImageGc() {
    if (!this.imagesEnabled) return;
    clearTimeout(this.gcTimer);
    this.gcTimer = setTimeout(async () => {
      try { await this.flush(); } catch {}
      await this.collectImages();
    }, 2000);
  }
  // Boot sweep: one pass shortly after init bounds orphan growth (crashed
  // sessions, pre-GC builds). Rides the debounced scheduler — fire-and-forget,
  // flush-first, and failures just leave the orphans for the next sweep.
  scheduleBootImageGc() { this.#scheduleImageGc(); }
  // Distinct image URLs referenced anywhere in the live cache right now.
  referencedImageUrls() {
    const referenced = new Set();
    for (const s of STORES)
      for (const v of Object.values(this.cache[s])) collectImageUrls(v, referenced);
    return referenced;
  }
  async collectImages() {
    const referenced = this.referencedImageUrls();
    for (const [id, dataUrl] of [...this.images]) {
      if (referenced.has(dataUrl)) continue;
      // The snapshot above predates the async delete loop: re-check against
      // the CURRENT cache before each delete, so an entity saved mid-sweep
      // can't lose an image it just started referencing (GC-vs-persist race).
      if (this.referencedImageUrls().has(dataUrl)) continue;
      try {
        await this.persistDeleteImage(id);
        this.images.delete(id);
      } catch (e) { console.error('FictionPad: image GC failed', e); }
    }
  }
  async persistPut() {}
  async persistDelete() {}
  async persistImage() {}
  async persistDeleteImage() {}
  #schedule() {
    clearTimeout(this.saveTimer);
    const streaming = this._streamKey && this.saveQueue.has(this._streamKey);
    this.saveTimer = setTimeout(() => this.flush(), streaming ? 3000 : 500);
  }
  beginStream(store, key) { this._streamKey = `${store}/${key}`; }
  endStream() {
    if (!this._streamKey) return;
    this._streamKey = null;
    this.flush();
  }
  // Lazy-image hydration — base adapters are eager (boot rehydrates
  // everything), so both are no-ops here. ServerDBAdapter overrides.
  async hydrate() {}
  async hydrateAll() {}
  // Distinct image ids referenced anywhere in the live cache right now, in
  // EITHER form: unresolved imgref sentinels (lazy mode) count directly,
  // data URLs count via the in-memory id → url map.
  referencedImageIds() {
    const ids = new Set(), urls = new Set();
    for (const s of STORES)
      for (const v of Object.values(this.cache[s])) {
        collectImageUrls(v, urls);
        collectImgrefIds(v, ids);
      }
    for (const [id, url] of this.images) if (urls.has(url)) ids.add(id);
    return ids;
  }
  // Serialized: a set() mid-flush schedules another flush 500 ms later, and
  // two concurrent flushes against a slow server can complete same-key puts
  // out of order (the older value would win). Chaining starts a later flush
  // only after the earlier one has finished.
  flush() {
    const p = (this._flushChain ?? Promise.resolve()).then(() => this.#flushOnce());
    this._flushChain = p.catch(() => {}); // a failed flush must not poison the chain
    return p;
  }
  async #flushOnce() {
    clearTimeout(this.saveTimer);
    clearTimeout(this.retryTimer);
    const items = [...this.saveQueue.values()];
    this.saveQueue.clear();
    let failed = false, fatal = null;
    for (const item of items) {
      try {
        if (item.op === 'put') await this.persistEntity(item.store, item.key, item.value);
        else await this.persistDelete(item.store, item.key);
      } catch (e) {
        // Optimistic-concurrency 409: never retried or re-queued — the key
        // parks in `conflicts` until the user picks a winner (resolveConflict).
        // A delete conflict carries the entity's last-known name (its cache
        // entry is already gone) so the modal can label the row.
        if (e?.conflict) {
          this._addConflict({ ...e.conflict, name: item.name ?? this.cache[item.store]?.[item.key]?.name });
          continue;
        }
        console.error('FictionPad: persist failed', e);
        // Re-queue instead of dropping — edits made while the server is
        // unreachable must survive. Keyed by store/key, so re-adding an item
        // that was re-set while we were flushing never duplicates work.
        if (!this.saveQueue.has(`${item.store}/${item.key}`))
          this.saveQueue.set(`${item.store}/${item.key}`, item);
        // A full disk never heals on a timer — surface it as a persistent
        // failure instead of retrying (the next set()/flush retries anyway).
        if (e?.name === 'QuotaExceededError')
          fatal = 'Browser storage is full (quota exceeded) — changes are NOT being saved. Free up storage or export and prune data, then make any edit to retry.';
        failed = true;
      }
    }
    if (fatal) {
      this._retries = 0;
      this.#savestate({ retrying: false, failed: fatal });
      return;
    }
    if (failed) {
      // Bounded exponential backoff (5s → 10 → 20 → 40 → 60s), then give up
      // and flag the failure rather than retrying a permanent error forever.
      // A later set(), flush(), or 'online' event starts the cycle over.
      this._retries = (this._retries ?? 0) + 1;
      if (this._retries > 5) {
        this._retries = 0;
        this.#savestate({ retrying: false, failed: 'Saving keeps failing — recent changes may not persist. Check the server/connection, then make any edit to retry.' });
        return;
      }
      this.#savestate({ retrying: true, failed: null });
      this.retryTimer = setTimeout(() => this.flush(), Math.min(60000, 5000 * 2 ** (this._retries - 1)));
      return;
    }
    this._retries = 0;
    this.#savestate({ retrying: false, failed: null });
  }
  // Detail is { retrying, failed } — retrying = writes queued for another
  // attempt; failed = a message when saving gave up (null while healthy).
  #savestate(detail) {
    const prev = this._savestate ?? {};
    if (!!prev.retrying === !!detail.retrying && (prev.failed ?? null) === detail.failed) return;
    this._savestate = detail;
    this.dispatchEvent(new CustomEvent('savestate', { detail }));
  }
  // Conflict events carry the full current list as detail. Underscore-named
  // (not #private) so ServerDBAdapter's resolution paths can drive them.
  _addConflict(c) {
    // A re-parked conflict (the server moved again) keeps the prior entry's
    // stashed name — delete conflicts lose their cache entry at remove().
    if (c.name == null) c.name = this.conflicts.get(`${c.store}/${c.key}`)?.name;
    this.conflicts.set(`${c.store}/${c.key}`, c);
    this.dispatchEvent(new CustomEvent('conflict', { detail: this.conflictList() }));
  }
  _clearConflict(store, key) {
    if (!this.conflicts.delete(`${store}/${key}`)) return;
    this.dispatchEvent(new CustomEvent('conflict', { detail: this.conflictList() }));
  }
  conflictList() { return [...this.conflicts.values()]; }
  // Base adapter never conflicts — the server adapter overrides this with the
  // real theirs/yours/copy resolution.
  async resolveConflict(store, key) { this._clearConflict(store, key); }
}

class IndexedDBAdapter extends AbstractStorage {
  constructor(dbName = 'FictionPad') {
    super();
    this.dbName = dbName;
    this.db = null;
    this.imagesEnabled = true;
  }
  async init() {
    this.db = await new Promise((resolve, reject) => {
      // v2 added the Characters store, v3 the Images store (out-of-band image
      // payloads), v4 the Mirror store (ServerDBAdapter's local snapshot —
      // unused here); onupgradeneeded creates any missing store idempotently,
      // so old databases upgrade cleanly.
      const req = indexedDB.open(this.dbName, 4);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        for (const s of [...STORES, 'Images', 'Mirror'])
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
    });
    // Local-mode writes share the physical database with the server adapter's
    // mirror. Using browser storage invalidates the mirror's rev snapshot —
    // the next server boot must do a full fetch, not a delta against revs
    // that no longer match these rows.
    try {
      await new Promise((resolve, reject) => {
        const r = this.db.transaction('Mirror', 'readwrite').objectStore('Mirror').delete('revs');
        r.onsuccess = () => resolve(); r.onerror = () => reject(r.error);
      });
    } catch {}
    // Images first: entities are rehydrated from them (imgref: → data URL).
    this.images = new Map(Object.entries(await this.#readAll('Images')));
    for (const s of STORES) {
      const all = await this.#readAll(s);
      for (const k of Object.keys(all)) all[k] = rehydrateImages(all[k], this.images);
      this.cache[s] = all;
    }
    try {
      if (navigator.storage?.persist && !(await navigator.storage.persisted()))
        await navigator.storage.persist();
    } catch {}
    this.scheduleBootImageGc(); // one sweep after rehydration bounds orphan growth
  }
  #readAll(store) {
    return new Promise((resolve, reject) => {
      const out = {};
      const req = this.db.transaction(store, 'readonly').objectStore(store).openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { out[cursor.key] = cursor.value; cursor.continue(); }
        else resolve(out);
      };
      req.onerror = () => reject(req.error);
    });
  }
  persistPut(store, key, value) {
    if (!this.db) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const req = this.db.transaction(store, 'readwrite').objectStore(store).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
  persistDelete(store, key) {
    if (!this.db) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const req = this.db.transaction(store, 'readwrite').objectStore(store).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
  persistImage(id, dataUrl) { return this.persistPut('Images', id, dataUrl); }
  persistDeleteImage(id) { return this.persistDelete('Images', id); }
}

// Server storage adapter (mikupad ServerDBAdapter pattern): same interface as
// IndexedDBAdapter — the debounced save queue and synchronous cache reads in
// AbstractStorage are shared, so React never knows which backend is active.
// init() throws when the server doesn't speak the storage protocol → boot
// falls back to IndexedDB (fresh browsers) or shows the blocking server gate
// (browsers that were previously on server storage — see App).
class ServerDBAdapter extends AbstractStorage {
  constructor(serverToken = '') {
    super();
    this.serverToken = serverToken;
    // Optimistic concurrency (server /version `rev` capability): last-seen
    // revision per entity — boot reads them from the mirror snapshot (or
    // /all on a fresh browser), saves send theirs as baseRev and store the
    // bumped rev from the response. Off against pre-rev servers: blind
    // last-write-wins, exactly the old behavior.
    this.revEnabled = false;
    this.revs = {};
    // Wire compression (server /version `gzip` capability): request bodies
    // over a threshold go out gzipped; responses are handled transparently
    // by fetch.
    this.gzipEnabled = false;
    // Local mirror: the same 'FictionPad' IndexedDB database the IndexedDB
    // adapter uses (schema v4 adds the Mirror store for the rev snapshot).
    // Entities land here in their raw (sentinel) form on every boot/pull/
    // save, images write through on persist — boot then reads locally and
    // delta-syncs against the server instead of downloading everything, and
    // the browser-storage fallback boots from a complete recent copy.
    this.mdb = null;
    this._imgInflight = new Map();      // image id → in-flight load promise
    this._hydrateInflight = new Map();  // store/key → in-flight hydrate promise
  }
  #headers() {
    return {
      'Content-Type': 'application/json',
      ...(this.serverToken ? { 'Authorization': `Bearer ${this.serverToken}` } : {}),
    };
  }
  // A Bearer token the server doesn't actually require (e.g. a stale token on
  // a Basic-auth deployment) earns a 401; retry bare once so the browser's
  // cached Basic creds take over before we give up.
  async #fetch(route, opts = {}, extraHeaders = {}) {
    const headers = { ...this.#headers(), ...extraHeaders };
    let res = await fetch(route, { ...opts, headers });
    if (res.status === 401 && headers.Authorization) {
      const { Authorization, ...bare } = headers;
      res = await fetch(route, { ...opts, headers: bare });
    }
    return res;
  }
  async #post(route, body) {
    const json = JSON.stringify(body ?? {});
    let payload = json, extra = {};
    // Wire compression for fat payloads (big chats, data-URL image rows) —
    // only against servers that advertised the capability.
    if (this.gzipEnabled && json.length > 16384 && typeof CompressionStream !== 'undefined') {
      try { payload = await gzipString(json); extra = { 'Content-Encoding': 'gzip' }; }
      catch { payload = json; }
    }
    const res = await this.#fetch(route, { method: 'POST', body: payload }, extra);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`, json2 = null;
      try { json2 = await res.json(); msg = json2?.error ?? msg; } catch {}
      const err = new Error(msg);
      err.status = res.status;
      err.body = json2; // 409 carries { error: 'conflict', rev }
      throw err;
    }
    return res.json();
  }

  // ---- IndexedDB mirror ----
  async #mirrorOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('FictionPad', 4);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        for (const s of [...STORES, 'Images', 'Mirror'])
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
    });
  }
  #mReq(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  #mGet(store, key) {
    if (!this.mdb) return Promise.resolve(undefined);
    return this.#mReq(this.mdb.transaction(store, 'readonly').objectStore(store).get(key));
  }
  #mPut(store, key, value) {
    if (!this.mdb) return Promise.resolve();
    return this.#mReq(this.mdb.transaction(store, 'readwrite').objectStore(store).put(value, key));
  }
  #mDel(store, key) {
    if (!this.mdb) return Promise.resolve();
    return this.#mReq(this.mdb.transaction(store, 'readwrite').objectStore(store).delete(key));
  }
  #mAll(store) {
    if (!this.mdb) return Promise.resolve({});
    return new Promise((resolve, reject) => {
      const out = {};
      const req = this.mdb.transaction(store, 'readonly').objectStore(store).openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { out[cursor.key] = cursor.value; cursor.continue(); }
        else resolve(out);
      };
      req.onerror = () => reject(req.error);
    });
  }
  #mAllKeys(store) {
    if (!this.mdb) return Promise.resolve([]);
    return this.#mReq(this.mdb.transaction(store, 'readonly').objectStore(store).getAllKeys());
  }
  // Mirror writes never block persistence — a mirror failure degrades the
  // next boot to a full fetch, nothing more.
  #mFire(p) { p?.catch?.(e => console.warn('FictionPad: mirror write failed', e)); }
  // The rev snapshot is the mirror's trust marker: it exists only after a
  // completed server-mode boot, and local-mode boots delete it. Debounced —
  // a lost trailing second just makes the next delta boot over-fetch.
  #saveMirrorRevs() {
    if (!this.mdb || !this.revEnabled) return;
    clearTimeout(this._revTimer);
    this._revTimer = setTimeout(() => {
      this.#mFire(this.#mPut('Mirror', 'revs', { revs: this.revs }));
    }, 1000);
  }

  async init() {
    const mirrorP = this.#mirrorOpen()
      .then(db => { this.mdb = db; })
      .catch(e => console.warn('FictionPad: local mirror unavailable, booting without it:', e?.message || e));
    const res = await this.#fetch('/version');
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status; // 401 → wrong/missing FICTIONPAD_TOKEN (boot gate shows a token field)
      throw err;
    }
    const info = await res.json();
    if (info?.version !== 1 || info?.storage !== true) throw new Error('not a FictionPad storage server');
    // Out-of-band images need a server that knows the Images store; without
    // the capability the adapter stays in inline mode (entities persist
    // verbatim, no 'unknown store' 400s) — today's behavior, just fat saves.
    this.imagesEnabled = info.images === true;
    // Server-side image GC: the server scans ALL stored entities (every
    // device's) for imgref refs and deletes unreferenced Images rows in one
    // POST /gc-images. Without the capability collectImages() below falls
    // back to the local cache-scan sweep (old servers).
    this.gcEnabled = info.gc === true;
    this.revEnabled = info.rev === true;
    this.gzipEnabled = info.gzip === true;
    // Lazy images: boot pulls NO image payloads — entities keep unresolved
    // imgref: sentinels until hydrate() fetches them (mirror first, server
    // second). Inline mode (old servers) stays eager by construction.
    this.lazyImages = this.imagesEnabled;
    this.images = new Map();
    await mirrorP;
    // Trusted mirror snapshot? The revs record is the trust marker — and the
    // boundary between the two worlds sharing these object stores: rows whose
    // key is in the snapshot are mirror-tracked (server state, reseeded and
    // pruned freely); rows that are not are LOCAL-MODE data (this is the same
    // database IndexedDBAdapter uses) and must survive every server boot
    // untouched — dormant, invisible to server mode, there again when the
    // user next boots browser storage.
    let snap = null, prevRevs = null;
    if (this.mdb && this.revEnabled) {
      try {
        const rec = await this.#mGet('Mirror', 'revs');
        if (rec?.revs) {
          prevRevs = rec.revs;
          snap = { revs: rec.revs, stores: {} };
          for (const s of STORES) snap.stores[s] = await this.#mAll(s);
        }
      } catch (e) { console.warn('FictionPad: mirror read failed, doing a full boot:', e?.message || e); snap = null; }
    }
    if (snap) {
      // Delta boot: seed from the mirror-TRACKED rows of the local snapshot
      // (dormant local-mode rows never enter the server-mode cache), then
      // pull only what the server says changed (one cheap /all per store, in
      // parallel).
      this.revs = snap.revs;
      await Promise.all(STORES.map(async (s) => {
        const local = snap.stores[s] ?? {};
        const out = {};
        for (const k of Object.keys(this.revs[s] ?? {})) if (k in local) out[k] = local[k];
        const res2 = await this.#post('/all', { store: s, refs: true, known: this.revs[s] ?? {} });
        const entries = res2.entries ?? {};
        this.revs[s] = { ...(res2.revs ?? this.revs[s] ?? {}) };
        for (const k of Object.keys(entries)) {
          out[k] = rehydrateImages(entries[k], this.images);
          this.#mFire(this.#mPut(s, k, entries[k])); // mirror keeps the raw form
        }
        // A server that predates delta sync ignores `known` and returns
        // every entry with no `deleted` field — then absence from entries
        // IS the deletion signal.
        const gone = res2.deleted ? new Set(res2.deleted)
          : new Set(Object.keys(out).filter(k => !(k in entries)));
        for (const k of gone) { delete out[k]; this.#mFire(this.#mDel(s, k)); }
        this.cache[s] = out;
      }));
    } else {
      // Full boot (fresh browser, untrusted mirror, or pre-rev server).
      await Promise.all(STORES.map(async (s) => {
        const res2 = await this.#post('/all', { store: s, refs: true });
        const all = res2.entries ?? {};
        if (this.revEnabled) this.revs[s] = { ...(res2.revs ?? {}) };
        const out = {};
        for (const k of Object.keys(all)) out[k] = rehydrateImages(all[k], this.images);
        this.cache[s] = out;
        if (this.mdb) this.#mFire((async () => {
          // Reseed: overlay server state. Only mirror-TRACKED rows are
          // deleted when missing from the server — untracked rows are
          // dormant local-mode data, never the mirror's to touch.
          const tracked = prevRevs?.[s] ?? {};
          const existing = await this.#mAllKeys(s);
          for (const k of existing) if (!(k in all) && k in tracked) await this.#mDel(s, k);
          for (const k of Object.keys(all)) await this.#mPut(s, k, all[k]);
        })());
      }));
    }
    this.#saveMirrorRevs();
    this.scheduleBootImageGc(); // one sweep after rehydration bounds orphan growth
  }
  // Guarded write: the baseRev is the rev our copy is based on (0 = "must not
  // exist yet"); the server 409s a mismatch instead of clobbering the newer
  // write from another device. Images rows stay blind — content-addressed
  // (same id = same bytes), a guard would only add round-trips. Every landed
  // write is mirrored locally (raw form) for the next delta boot.
  async persistPut(store, key, value) {
    if (!this.revEnabled || store === 'Images') {
      const r = await this.#post('/save', { store, key, data: value });
      this.#mFire(this.#mPut(store, key, value));
      return r;
    }
    try {
      const res = await this.#post('/save', { store, key, data: value, baseRev: this.revs[store]?.[key] ?? 0 });
      if (Number.isInteger(res?.rev)) {
        (this.revs[store] ??= {})[key] = res.rev;
        this.#saveMirrorRevs();
      }
      this.#mFire(this.#mPut(store, key, value));
      return res;
    } catch (e) {
      if (e?.status === 409) {
        const err = new Error('save conflict — changed on another device');
        err.conflict = { store, key, rev: e.body?.rev ?? null };
        throw err;
      }
      throw e;
    }
  }
  // Guarded delete: the symmetric hole to the guarded write — without it a
  // stale device silently deletes an entity another device advanced. baseRev
  // 0 means "I never synced this key": a row that exists server-side with a
  // higher rev 409s into the conflict flow instead of vanishing. Pre-rev
  // servers ignore baseRev — a blind delete, exactly the old behavior.
  async persistDelete(store, key) {
    const baseRev = this.revEnabled ? (this.revs[store]?.[key] ?? 0) : undefined;
    try {
      await this.#post('/delete', baseRev === undefined ? { store, key } : { store, key, baseRev });
    } catch (e) {
      if (e?.status === 409) {
        const err = new Error('delete conflict — changed on another device');
        err.conflict = { store, key, rev: e.body?.rev ?? null, op: 'delete' };
        throw err;
      }
      throw e;
    }
    if (this.revs[store]) { delete this.revs[store][key]; this.#saveMirrorRevs(); }
    this.#mFire(this.#mDel(store, key));
  }
  // Images write through to the mirror, so the browser-storage fallback
  // always boots from a complete copy and hydrate() can serve repeats
  // locally.
  persistImage(id, dataUrl) {
    this.#mFire(this.#mPut('Images', id, dataUrl));
    return this.#post('/save', { store: 'Images', key: id, data: dataUrl });
  }
  persistDeleteImage(id) {
    this.#mFire(this.#mDel('Images', id));
    return this.#post('/delete', { store: 'Images', key: id });
  }
  // With the gc capability the sweep runs server-side (one POST, covers every
  // device's entities); the local cache-scan stays the fallback for older
  // servers. Afterwards prune the in-memory map AND the mirror by the same
  // sentinel-aware reference scan, so a later save can't reference a row the
  // server just dropped and the mirror doesn't accumulate orphans.
  async collectImages() {
    if (!this.gcEnabled) { await super.collectImages(); this.#pruneLocalImages(); return; }
    try {
      await this.#post('/gc-images', {});
    } catch (e) { console.error('FictionPad: image GC failed', e); return; }
    this.#pruneLocalImages();
  }
  #pruneLocalImages() {
    const ids = this.referencedImageIds();
    for (const [id] of [...this.images]) if (!ids.has(id)) this.images.delete(id);
    this.#mFire((async () => {
      // The object stores also hold DORMANT local-mode entities (untracked
      // by the rev snapshot) — scanning only the server-mode cache would
      // delete images a dormant entity still references, breaking the
      // browser-storage world. Scan the stores themselves; a legacy inline
      // entity references by data URL, so rows are kept on either match.
      const refIds = new Set(), refUrls = new Set();
      for (const s of STORES)
        for (const v of Object.values(await this.#mAll(s))) {
          collectImageUrls(v, refUrls);
          collectImgrefIds(v, refIds);
        }
      const rows = await this.#mAll('Images');
      for (const [k, url] of Object.entries(rows))
        if (!refIds.has(k) && !refUrls.has(url)) await this.#mDel('Images', k);
    })());
  }
  // Used by the settings migration helpers. No refs hint: the server
  // rehydrates, so pulled entities always travel self-contained (inline).
  async remoteAll(store, opts) { return (await this.#post('/all', { store, ...opts })).entries ?? {}; }
  // A pulled entity lands in the cache rehydrated with whatever images are
  // already loaded (unresolved refs stay sentinels — hydrate() fills them on
  // demand), in the mirror in raw form, and in the rev map.
  async #applyRemote(store, key, raw, rev) {
    this.cache[store][key] = rehydrateImages(raw, this.images);
    if (this.revEnabled && Number.isInteger(rev)) {
      (this.revs[store] ??= {})[key] = rev;
      this.#saveMirrorRevs();
    }
    this.#mFire(this.#mPut(store, key, raw));
    this.dispatchEvent(new CustomEvent('storechange', { detail: { store, key } }));
  }
  // On-demand image fetch: memory → mirror → server. Server hits are cached
  // in the mirror so the next boot serves them locally.
  async #loadImage(id) {
    const hit = this.images.get(id);
    if (hit !== undefined) return hit;
    if (this._imgInflight.has(id)) return this._imgInflight.get(id);
    const p = (async () => {
      try {
        const local = await this.#mGet('Images', id);
        if (typeof local === 'string') { this.images.set(id, local); return local; }
        const res = await this.#post('/load', { store: 'Images', key: id });
        if (typeof res?.data === 'string') {
          this.images.set(id, res.data);
          this.#mFire(this.#mPut('Images', id, res.data));
          return res.data;
        }
      } catch (e) { console.warn('FictionPad: image pull failed', e); }
      return null;
    })();
    this._imgInflight.set(id, p);
    try { return await p; } finally { this._imgInflight.delete(id); }
  }
  // Lazy-image hydration: fetch every image an entity references that isn't
  // loaded yet, then rehydrate the CURRENT cache value (it may have been
  // rewritten while fetches were in flight) and notify. In-flight deduped
  // per entity; no-op for eager adapters (base class) and inline mode.
  async hydrate(store, key) {
    if (!this.lazyImages) return;
    const id = `${store}/${key}`;
    if (this._hydrateInflight.has(id)) return this._hydrateInflight.get(id);
    const p = (async () => {
      const entity = this.cache[store]?.[key];
      if (!entity) return;
      const missing = collectImgrefIds(entity);
      for (const loaded of this.images.keys()) missing.delete(loaded);
      if (!missing.size) return;
      let any = false;
      for (const imgId of missing) if (await this.#loadImage(imgId)) any = true;
      if (!any) return;
      const cur = this.cache[store]?.[key];
      if (!cur) return;
      this.cache[store][key] = rehydrateImages(cur, this.images);
      this.dispatchEvent(new CustomEvent('storechange', { detail: { store, key } }));
    })();
    this._hydrateInflight.set(id, p);
    try { return await p; } finally { this._hydrateInflight.delete(id); }
  }
  // Full hydration for whole-library exports — resolves every sentinel in
  // every store. Genuinely fetches the world; call only when the user asked
  // for a complete export.
  async hydrateAll() {
    if (!this.lazyImages) return;
    for (const s of STORES)
      for (const k of Object.keys(this.cache[s]))
        await this.hydrate(s, k);
  }
  // User picked a winner for a 409'd key:
  //   theirs — pull the server version over the local cache (local edits
  //            lost; for a delete conflict, restores the row the delete
  //            would have clobbered)
  //   yours  — re-put the CURRENT cache value against the rev the server
  //            reported (delete conflict: re-issue the delete against it);
  //            a newer server write in between just re-conflicts
  //   copy   — Chats only, put conflicts: keep both; the local version
  //            lands as a new chat
  async resolveConflict(store, key, mode) {
    const conflict = this.conflicts.get(`${store}/${key}`);
    if (conflict?.op === 'delete') {
      if (mode === 'yours') { // delete anyway, against the reported rev
        try {
          await this.#post('/delete', { store, key, baseRev: conflict.rev ?? 0 });
        } catch (e) {
          if (e?.status === 409) { // moved again — refresh the conflict
            this._addConflict({ store, key, rev: e.body?.rev ?? null, op: 'delete' });
            return;
          }
          throw e;
        }
        if (this.revs[store]) { delete this.revs[store][key]; this.#saveMirrorRevs(); }
        this.#mFire(this.#mDel(store, key));
        await super.resolveConflict(store, key);
        return;
      }
      // 'theirs' — restore the server version (a 404 means it vanished
      // anyway: the delete effectively won, just clear the conflict).
      try {
        const res = await this.#post('/load', { store, key, refs: true });
        await this.#applyRemote(store, key, res.data, res.rev);
      } catch (e) { if (e?.status !== 404) throw e; }
      await super.resolveConflict(store, key);
      return;
    }
    if (mode === 'copy' && store === 'Chats') {
      const mine = this.cache.Chats?.[key];
      if (mine) {
        const clone = deepClone(mine);
        clone.id = uid();
        clone.name = `${mine.name || 'Chat'} (copy)`;
        clone.updatedAt = Date.now();
        this.set('Chats', clone.id, clone);
      }
      mode = 'theirs'; // the original key then takes the server version
    }
    if (mode === 'yours') {
      const value = this.cache[store]?.[key];
      if (value === undefined) { await super.resolveConflict(store, key); return; }
      const baseRev = this.conflicts.get(`${store}/${key}`)?.rev ?? 0;
      try {
        let entity = value;
        if (this.imagesEnabled) {
          const out = extractImages(value, this.images);
          entity = out.entity;
          for (const [id, dataUrl] of out.images) {
            await this.persistImage(id, dataUrl);
            this.images.set(id, dataUrl);
          }
        }
        const res = await this.#post('/save', { store, key, data: entity, baseRev });
        if (Number.isInteger(res?.rev)) {
          (this.revs[store] ??= {})[key] = res.rev;
          this.#saveMirrorRevs();
        }
        this.#mFire(this.#mPut(store, key, entity));
      } catch (e) {
        if (e?.status === 409) { // the server moved again — refresh the conflict
          this._addConflict({ store, key, rev: e.body?.rev ?? null });
          return;
        }
        throw e;
      }
      await super.resolveConflict(store, key);
      return;
    }
    // 'theirs' (and the original key after 'copy')
    let res;
    try {
      res = await this.#post('/load', { store, key, refs: true });
    } catch (e) {
      if (e?.status === 404) { // deleted server-side in the meantime
        delete this.cache[store][key];
        if (this.revs[store]) { delete this.revs[store][key]; this.#saveMirrorRevs(); }
        this.#mFire(this.#mDel(store, key));
        await super.resolveConflict(store, key);
        this.dispatchEvent(new CustomEvent('storechange', { detail: { store, key } }));
        return;
      }
      throw e;
    }
    await this.#applyRemote(store, key, res.data, res.rev);
    await super.resolveConflict(store, key);
  }
  // Focus sync: ONE cheap /list diff when the tab regains attention — not
  // polling, no sockets. Entities that changed on other devices are pulled
  // into the cache (storechange updates the UI); keys with in-flight local
  // writes or an open conflict are left to the rev guard. Meta is excluded:
  // settings stay boot-sync + guarded writes only. Emits `sync` with an
  // { updated, removed } summary when anything changed.
  async syncFromServer() {
    if (!this.revEnabled) return null;
    const now = Date.now();
    if (this._lastSync && now - this._lastSync < 10000) return null;
    this._lastSync = now;
    try {
      await this.flush(); // local writes land first so the diff can't undo them
      const remote = (await this.#post('/list', { revs: true }))?.revs ?? {};
      const dirty = (store, key) =>
        this.saveQueue.has(`${store}/${key}`) || this.conflicts.has(`${store}/${key}`);
      let updated = 0, removed = 0;
      for (const store of STORES) {
        if (store === 'Meta') continue;
        const remoteRevs = remote[store] ?? {};
        const localRevs = this.revs[store] ?? {};
        for (const [key, rev] of Object.entries(remoteRevs)) {
          if (localRevs[key] === rev || dirty(store, key)) continue;
          try {
            const res = await this.#post('/load', { store, key, refs: true });
            await this.#applyRemote(store, key, res.data, Number.isInteger(res?.rev) ? res.rev : rev);
            updated++;
          } catch (e) { if (e?.status !== 404) console.warn('FictionPad: sync pull failed', e); }
        }
        for (const key of Object.keys(this.cache[store] ?? {})) {
          if (key in remoteRevs || dirty(store, key)) continue;
          // In cache, not on the server, nothing queued locally: deleted on
          // another device (a local create-not-yet-saved is dirty, so it can
          // never reach this branch).
          delete this.cache[store][key];
          if (this.revs[store]) { delete this.revs[store][key]; this.#saveMirrorRevs(); }
          this.#mFire(this.#mDel(store, key));
          removed++;
          this.dispatchEvent(new CustomEvent('storechange', { detail: { store, key } }));
        }
      }
      if (updated || removed)
        this.dispatchEvent(new CustomEvent('sync', { detail: { updated, removed } }));
      return { updated, removed };
    } catch (e) {
      console.warn('FictionPad: focus sync failed', e);
      return null;
    }
  }
  // Pre-generation freshness check (one cheap rev-map fetch, throttled 5 s
  // PER KEY — a global throttle would skip the check for a second chat
  // generated right after the first): is the server's rev for this key the
  // one our copy is based on? A moved,
  // locally clean key is pulled on the spot ('pulled' — the caller re-reads
  // the cache and works against the fresh copy); a locally dirty key flushes
  // into the 409 path instead ('conflict'); a key deleted server-side drops
  // from the cache ('removed'); anything else is 'fresh'. The rev guard
  // stays the backstop for a write that lands between check and save.
  async checkFresh(store, key) {
    if (!this.revEnabled) return 'fresh';
    const now = Date.now();
    const id = `${store}/${key}`;
    this._lastFresh ??= {};
    if (this._lastFresh[id] && now - this._lastFresh[id] < 5000) return 'fresh';
    this._lastFresh[id] = now;
    const remote = (await this.#post('/list', { revs: true }))?.revs ?? {};
    this._lastSync = now; // covers the focus sync's next throttle window too
    const serverRev = (remote[store] ?? {})[key];
    const localRev = this.revs[store]?.[key];
    if (serverRev === undefined) {
      // Gone server-side — only sweep a clean, previously-synced local copy.
      if (this.cache[store]?.[key] === undefined || localRev === undefined
        || this.saveQueue.has(id) || this.conflicts.has(id)) return 'fresh';
      delete this.cache[store][key];
      if (this.revs[store]) { delete this.revs[store][key]; this.#saveMirrorRevs(); }
      this.#mFire(this.#mDel(store, key));
      this.dispatchEvent(new CustomEvent('storechange', { detail: { store, key } }));
      return 'removed';
    }
    if (serverRev === localRev) return 'fresh';
    if (this.conflicts.has(id)) return 'conflict';
    if (this.saveQueue.has(id)) {
      // Local writes in flight against the old rev — flush them now; the 409
      // parks the key as a conflict for the user to resolve.
      await this.flush();
      return this.conflicts.has(id) ? 'conflict' : 'fresh';
    }
    try {
      const res = await this.#post('/load', { store, key, refs: true });
      await this.#applyRemote(store, key, res.data, Number.isInteger(res?.rev) ? res.rev : serverRev);
      return 'pulled';
    } catch (e) {
      if (e?.status === 404) return 'fresh'; // vanished mid-check — the save re-creates
      throw e;
    }
  }
}

