// ============================================================================
// STORAGE — AbstractStorage (EventTarget + 500 ms debounced save queue) with
// an IndexedDB adapter. Entities are stored one-key-per-entity; the adapter
// keeps an in-memory cache that React reads synchronously.
// ============================================================================
const STORES = ['Scenarios', 'Personas', 'Chats', 'Meta', 'Characters'];

class AbstractStorage extends EventTarget {
  constructor() {
    super();
    this.cache = Object.fromEntries(STORES.map(s => [s, {}]));
    this.saveQueue = new Map();
    this.saveTimer = null;
    this.retryTimer = null;
    // Connectivity restored → flush any re-queued writes immediately.
    if (typeof window !== 'undefined')
      window.addEventListener('online', () => this.flush());
  }
  async init() {}
  getAll(store) { return this.cache[store] ?? {}; }
  get(store, key) { return this.cache[store]?.[key]; }
  set(store, key, value) {
    this.cache[store][key] = value;
    this.saveQueue.set(`${store}/${key}`, { op: 'put', store, key, value });
    this.#schedule();
    this.dispatchEvent(new CustomEvent('storechange', { detail: { store, key } }));
  }
  remove(store, key) {
    delete this.cache[store][key];
    this.saveQueue.set(`${store}/${key}`, { op: 'delete', store, key });
    this.#schedule();
    this.dispatchEvent(new CustomEvent('storechange', { detail: { store, key } }));
  }
  #schedule() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 500);
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
        if (item.op === 'put') await this.persistPut(item.store, item.key, item.value);
        else await this.persistDelete(item.store, item.key);
      } catch (e) {
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
  async persistPut() {}
  async persistDelete() {}
}

class IndexedDBAdapter extends AbstractStorage {
  constructor(dbName = 'FictionPad') {
    super();
    this.dbName = dbName;
    this.db = null;
  }
  async init() {
    this.db = await new Promise((resolve, reject) => {
      // v2 added the Characters store; onupgradeneeded creates any missing
      // store idempotently, so old v1 databases upgrade cleanly.
      const req = indexedDB.open(this.dbName, 2);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        for (const s of STORES)
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
    });
    for (const s of STORES) this.cache[s] = await this.#readAll(s);
    try {
      if (navigator.storage?.persist && !(await navigator.storage.persisted()))
        await navigator.storage.persist();
    } catch {}
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
  async #fetch(route, opts = {}) {
    const headers = this.#headers();
    let res = await fetch(route, { ...opts, headers });
    if (res.status === 401 && headers.Authorization) {
      const { Authorization, ...bare } = headers;
      res = await fetch(route, { ...opts, headers: bare });
    }
    return res;
  }
  async #post(route, body) {
    const res = await this.#fetch(route, { method: 'POST', body: JSON.stringify(body ?? {}) });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = (await res.json())?.error ?? msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  }
  async init() {
    const res = await this.#fetch('/version');
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status; // 401 → wrong/missing FICTIONPAD_TOKEN (boot gate shows a token field)
      throw err;
    }
    const info = await res.json();
    if (info?.version !== 1 || info?.storage !== true) throw new Error('not a FictionPad storage server');
    for (const s of STORES) this.cache[s] = await this.remoteAll(s);
  }
  async persistPut(store, key, value) { await this.#post('/save', { store, key, data: value }); }
  async persistDelete(store, key) { await this.#post('/delete', { store, key }); }
  // Used by the settings migration helpers.
  async remoteAll(store) { return (await this.#post('/all', { store })).entries ?? {}; }
  async remoteSave(store, key, data) { await this.#post('/save', { store, key, data }); }
}

