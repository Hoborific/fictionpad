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
// loads images (server storage with the images capability). hydrationFailed
// tells a failed pull (parked for the session) apart from a loading one, and
// retryHydration is the explicit user retry (click on a failed placeholder) —
// both are inert no-ops on eager adapters.
let _hydrator = null;
function registerHydrator(storage) { _hydrator = storage?.lazyImages ? storage : null; }
function requestHydration(store, key) { if (store && key) _hydrator?.hydrate(store, key); }
function hydrationFailed(store, key) { return !!(store && key && _hydrator?.hydrationFailed(store, key)); }
function retryHydration(store, key) { if (store && key) _hydrator?.retryHydration(store, key); }

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
      // A write that failed to land (still queued) or parked as a conflict can
      // reference image rows the server never saw the entity for — the flush
      // above resolves rather than rejects on failure, so a server-side sweep
      // would reclaim those rows from under the retry/resolution. Skip this
      // pass; the next delete/overwrite/boot sweep retries.
      if (this.saveQueue.size || this.conflicts.size) return;
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
  // everything), so all of these are no-ops here. ServerDBAdapter overrides.
  async hydrate() {}
  async hydrateAll() {}
  hydrationFailed() { return false; }
  retryHydration() {}
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

