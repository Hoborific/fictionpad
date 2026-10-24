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
    // Local mirror: separate Mirror<Store>/MirrorImages stores in the same
    // database as browser storage. Mirror/revs alone trusts the snapshot.
    this.mdb = null;
    this._mirrorNeedsFullBoot = true;
    this._mirrorFailure = 0;
    this._imgInflight = new Map();      // image id → in-flight load promise
    this._hydrateInflight = new Map();  // store/key → in-flight hydrate promise
    // Hydration failures remembered per store/key for the session: an entity
    // whose referenced image rows can't be pulled (missing Images row, pull
    // error) is parked here so surfaces render a failed placeholder instead
    // of re-firing the doomed fetch on every mount. Cleared by a successful
    // hydrate of the key, by a fresh server pull (#applyRemote — the new
    // copy may reference rows that exist now), or by an explicit retry.
    this._hydrateFailed = new Set();
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
  async #post(route, body, { timeoutMs = 0 } = {}) {
    const json = JSON.stringify(body ?? {});
    let payload = json, extra = {};
    // Wire compression for fat payloads (big chats, data-URL image rows) —
    // only against servers that advertised the capability.
    if (this.gzipEnabled && json.length > 16384 && typeof CompressionStream !== 'undefined') {
      try { payload = await gzipString(json); extra = { 'Content-Encoding': 'gzip' }; }
      catch { payload = json; }
    }
    const opts = { method: 'POST', body: payload };
    // Bounded waits for UI-blocking checks (genGuard's freshness round trip) —
    // a black-holed connection must not latch the composer's send forever.
    if (timeoutMs && typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function')
      opts.signal = AbortSignal.timeout(timeoutMs);
    const res = await this.#fetch(route, opts, extra);
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
  #mirrorOpen() { return openFictionPadDB('FictionPad'); }
  #mReq(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  #mPhysical(store) { return store === 'Mirror' ? store : mirrorStoreName(store); }
  #mGet(store, key) {
    if (!this.mdb) return Promise.resolve(undefined);
    const physical = this.#mPhysical(store);
    return this.#mReq(this.mdb.transaction(physical, 'readonly').objectStore(physical).get(key));
  }
  async #mPut(store, key, value) {
    if (!this.mdb) return true;
    try {
      const physical = this.#mPhysical(store);
      await this.#mReq(this.mdb.transaction(physical, 'readwrite').objectStore(physical).put(value, key));
      return true;
    } catch (e) {
      console.warn('FictionPad: mirror write failed', e);
      if (store === 'Mirror' || STORES.includes(store)) await this.#invalidateMirror();
      return false;
    }
  }
  async #mDel(store, key) {
    if (!this.mdb) return true;
    try {
      const physical = this.#mPhysical(store);
      await this.#mReq(this.mdb.transaction(physical, 'readwrite').objectStore(physical).delete(key));
      return true;
    } catch (e) {
      console.warn('FictionPad: mirror write failed', e);
      if (store === 'Mirror' || STORES.includes(store)) await this.#invalidateMirror();
      return false;
    }
  }
  #mAll(store) {
    if (!this.mdb) return Promise.resolve({});
    return new Promise((resolve, reject) => {
      const out = {}, physical = this.#mPhysical(store);
      const req = this.mdb.transaction(physical, 'readonly').objectStore(physical).openCursor();
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
    const physical = this.#mPhysical(store);
    return this.#mReq(this.mdb.transaction(physical, 'readonly').objectStore(physical).getAllKeys());
  }
  async #invalidateMirror() {
    this._mirrorNeedsFullBoot = true;
    this._mirrorFailure++;
    clearTimeout(this._revTimer);
    if (!this.mdb) return;
    try {
      await this.#mReq(this.mdb.transaction('Mirror', 'readwrite').objectStore('Mirror').delete('revs'));
    } catch (e) { console.warn('FictionPad: could not invalidate mirror revs', e); }
  }
  // Rev writes are allowed only while every mirrored entity write is known to
  // have landed. Any failure deletes trust and blocks later debounced writes
  // until a complete reseed succeeds.
  #saveMirrorRevs() {
    clearTimeout(this._revTimer);
    if (!this.mdb || !this.revEnabled || this._mirrorNeedsFullBoot) return;
    this._revTimer = setTimeout(() => { this.#writeMirrorRevs(); }, 1000);
  }
  #writeMirrorRevs() {
    if (!this.mdb || !this.revEnabled || this._mirrorNeedsFullBoot) return Promise.resolve(false);
    return this.#mPut('Mirror', 'revs', { revs: this.revs });
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
    if (this.mdb && !this.revEnabled) await this.#invalidateMirror();
    // Mirror/revs is the only trust marker. All entity rows come from the
    // separate mirror stores, so local same-id data can never leak into a
    // server boot or be pruned by a full reseed.
    let snap = null;
    if (this.mdb && this.revEnabled) {
      try {
        const rec = await this.#mGet('Mirror', 'revs');
        if (rec?.revs) {
          snap = { revs: rec.revs, stores: {} };
          for (const s of STORES) snap.stores[s] = await this.#mAll(s);
          this._mirrorNeedsFullBoot = false;
        }
      } catch (e) {
        console.warn('FictionPad: mirror read failed, doing a full boot:', e?.message || e);
        snap = null;
        await this.#invalidateMirror();
      }
    }
    const bootFailure = this._mirrorFailure;
    if (snap) {
      // Delta boot: seed from the trusted mirror, then pull only changed rows.
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
          await this.#mPut(s, k, entries[k]); // mirror keeps the raw form
        }
        // A server that predates delta sync ignores `known` and returns
        // every entry with no `deleted` field — then absence from entries
        // IS the deletion signal.
        const gone = res2.deleted ? new Set(res2.deleted)
          : new Set(Object.keys(out).filter(k => !(k in entries)));
        for (const k of gone) { delete out[k]; await this.#mDel(s, k); }
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
        if (this.mdb) try {
          const existing = await this.#mAllKeys(s);
          for (const k of existing) if (!(k in all)) await this.#mDel(s, k);
          for (const k of Object.keys(all)) await this.#mPut(s, k, all[k]);
        } catch (e) {
          console.warn('FictionPad: mirror reseed failed', e);
          await this.#invalidateMirror();
        }
      }));
    }
    if (this.mdb && this.revEnabled) {
      // A full reseed re-enables trust only if every entity write completed.
      // Delta boots keep their existing trust unless a write invalidated it.
      if (!snap && this._mirrorFailure === bootFailure) this._mirrorNeedsFullBoot = false;
      await this.#writeMirrorRevs();
    }
    this.scheduleBootImageGc(); // one sweep after rehydration bounds orphan growth
  }
  // Guarded write: the baseRev is the rev our copy is based on (0 = "must not
  // exist yet"); the server 409s a mismatch instead of clobbering the newer
  // write from another device. Images rows stay blind — content-addressed
  // (same id = same bytes), a guard would only add round-trips. Every landed
  // write is mirrored locally (raw form) for the next delta boot.
  async persistPut(store, key, value, opts) {
    if (!this.revEnabled || store === 'Images') {
      const r = await this.#post('/save', { store, key, data: value });
      await this.#mPut(store, key, value);
      return r;
    }
    try {
      const baseRev = opts?.baseRev ?? this.revs[store]?.[key] ?? 0;
      const res = await this.#post('/save', { store, key, data: value, baseRev });
      if (Number.isInteger(res?.rev)) {
        (this.revs[store] ??= {})[key] = res.rev;
        this.#saveMirrorRevs();
      }
      await this.#mPut(store, key, value);
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
    await this.#mDel(store, key);
  }
  // Images write through to MirrorImages after the server row lands, so the
  // explicit browser-storage fallback can import every available payload.
  async persistImage(id, dataUrl) {
    const result = await this.#post('/save', { store: 'Images', key: id, data: dataUrl });
    await this.#mPut('Images', id, dataUrl);
    return result;
  }
  async persistDeleteImage(id) {
    await this.#post('/delete', { store: 'Images', key: id });
    await this.#mDel('Images', id);
  }
  // Server GC can race a just-saved or newly pulled reference. Restore every
  // deleted row still referenced by the CURRENT cache when its payload is in
  // memory, then prune only unreferenced local copies. Re-upload failures keep
  // the payload in memory/mirror and are retried by a later GC pass.
  async collectImages() {
    try {
      if (!this.gcEnabled) {
        await super.collectImages();
        await this.#pruneLocalImages();
        return;
      }
      const result = await this.#post('/gc-images', {});
      const deletedIds = Array.isArray(result?.deletedIds) ? new Set(result.deletedIds) : null;
      if (deletedIds) {
        for (const id of deletedIds) {
          const dataUrl = this.images.get(id);
          if (dataUrl !== undefined && this.referencedImageIds().has(id))
            await this.persistImage(id, dataUrl);
        }
      }
      await this.#pruneLocalImages(deletedIds);
    } catch (e) { console.error('FictionPad: image GC failed', e); }
  }
  async #pruneLocalImages(deletedIds = null) {
    const refIds = new Set(), refUrls = new Set();
    for (const s of STORES)
      for (const v of Object.values(await this.#mAll(s))) {
        collectImageUrls(v, refUrls);
        collectImgrefIds(v, refIds);
      }
    const rows = await this.#mAll('Images');
    const ids = new Set([...this.images.keys(), ...Object.keys(rows)]);
    for (const id of ids) {
      if (deletedIds && !deletedIds.has(id)) continue;
      const url = this.images.get(id) ?? rows[id];
      if (refIds.has(id) || refUrls.has(url)) continue;
      if (this.referencedImageIds().has(id) || this.referencedImageUrls().has(url)) continue;
      this.images.delete(id);
      if (id in rows) await this.#mDel('Images', id);
    }
  }
  // Used by the settings migration helpers. No refs hint: the server
  // rehydrates, so pulled entities always travel self-contained (inline).
  async remoteAll(store, opts) { return (await this.#post('/all', { store, ...opts })).entries ?? {}; }
  // A pulled entity lands in the cache rehydrated with whatever images are
  // already loaded (unresolved refs stay sentinels — hydrate() fills them on
  // demand), in the mirror in raw form, and in the rev map.
  async #applyRemote(store, key, raw, rev) {
    this.cache[store][key] = rehydrateImages(raw, this.images);
    this._hydrateFailed.delete(`${store}/${key}`); // fresh copy — let hydration retry
    if (this.revEnabled && Number.isInteger(rev)) {
      (this.revs[store] ??= {})[key] = rev;
      this.#saveMirrorRevs();
    }
    await this.#mPut(store, key, raw);
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
          await this.#mPut('Images', id, res.data);
          return res.data;
        }
      } catch (e) { console.warn('FictionPad: image pull failed', e); }
      return null;
    })();
    this._imgInflight.set(id, p);
    try { return await p; } finally { this._imgInflight.delete(id); }
  }
  // Resolve to true only when the CURRENT entity has no unresolved sentinel.
  // The per-key in-flight promise keeps checking current refs after every
  // await, so a remote pull or local edit during hydration is included. A
  // failure parks only the exact entity copy whose refs were just attempted;
  // a changed copy gets its own fetch round before it can be marked failed.
  async hydrate(store, key) {
    if (!this.lazyImages) return true;
    const id = `${store}/${key}`;
    if (this._hydrateFailed.has(id)) return false;
    if (this._hydrateInflight.has(id)) return this._hydrateInflight.get(id);
    const p = (async () => {
      for (;;) {
        const entity = this.cache[store]?.[key];
        if (!entity) { this._hydrateFailed.delete(id); return true; }
        const missing = collectImgrefIds(entity);
        for (const loaded of this.images.keys()) missing.delete(loaded);
        for (const imgId of missing) await this.#loadImage(imgId);
        const cur = this.cache[store]?.[key];
        if (!cur) { this._hydrateFailed.delete(id); return true; }
        const hydrated = rehydrateImages(cur, this.images);
        const changed = hydrated !== cur;
        if (changed) this.cache[store][key] = hydrated;
        if (!collectImgrefIds(hydrated).size) {
          this._hydrateFailed.delete(id);
          if (changed) this.dispatchEvent(new CustomEvent('storechange', { detail: { store, key } }));
          return true;
        }
        if (cur !== entity) continue;
        this._hydrateFailed.add(id);
        this.dispatchEvent(new CustomEvent('storechange', { detail: { store, key } }));
        return false;
      }
    })();
    this._hydrateInflight.set(id, p);
    try { return await p; } finally { this._hydrateInflight.delete(id); }
  }
  // Surfaces ask this to tell a loading sentinel (hydration in flight or not
  // yet requested) from a failed one (the pull already came back empty).
  hydrationFailed(store, key) { return this._hydrateFailed.has(`${store}/${key}`); }
  // Explicit retry (click on a failed placeholder): unpark, notify so the
  // surface flips back to loading, and re-run the fetch.
  retryHydration(store, key) {
    this._hydrateFailed.delete(`${store}/${key}`);
    this.dispatchEvent(new CustomEvent('storechange', { detail: { store, key } }));
    return this.hydrate(store, key);
  }
  // Whole-library export contract: true means every current entity is fully
  // rehydrated. Otherwise throw one Error with `failures: [{ store, key }]`;
  // callers must not serialize the cache after that rejection.
  async hydrateAll() {
    if (!this.lazyImages) return true;
    const failures = [], failedIds = new Set();
    for (const s of STORES)
      for (const k of Object.keys(this.cache[s])) {
        if (await this.hydrate(s, k)) continue;
        failures.push({ store: s, key: k });
        failedIds.add(`${s}/${k}`);
      }
    // Include entities/refs that arrived during the fetch rounds. Reporting
    // success with any sentinel left would make a full backup silently lossy.
    for (const s of STORES)
      for (const [k, value] of Object.entries(this.cache[s])) {
        if (!collectImgrefIds(value).size || failedIds.has(`${s}/${k}`)) continue;
        failures.push({ store: s, key: k });
      }
    if (failures.length) {
      const err = new Error(`Could not load images for ${failures.length} ${failures.length === 1 ? 'entity' : 'entities'}; export cancelled.`);
      err.failures = failures;
      throw err;
    }
    return true;
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
        await this.#mDel(store, key);
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
        // The shared put path also answers missingImages before completion;
        // a failed re-upload keeps this conflict open for an explicit retry.
        await this.persistEntity(store, key, value, { baseRev });
      } catch (e) {
        if (e?.conflict) { // the server moved again — refresh the conflict
          this._addConflict({ ...e.conflict, name: conflict?.name });
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
        await this.#mDel(store, key);
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
  // into the cache (storechange updates the UI; Main adopts a pulled
  // Meta/app.settings into live settings). Keys with in-flight local writes
  // or an open conflict are left to the rev guard. Meta joins the pull but
  // never the removal pass — settings keys are never deleted server-side, and
  // a cache-only settings row must not vanish under the UI. Emits `sync`
  // with an { updated, removed } summary when anything changed.
  async syncFromServer() {
    if (!this.revEnabled) return null;
    const now = Date.now();
    if (this._lastSync && now - this._lastSync < 10000) return null;
    this._lastSync = now;
    try {
      await this.flush(); // local writes land first so the diff can't undo them
      const remote = (await this.#post('/list', { revs: true }))?.revs ?? {};
      // Streaming counts as dirty: the 3 s coalesced flush leaves windows
      // where the streaming chat's key isn't queued, and a mid-stream pull
      // would be silently re-clobbered by the generation's overlay writes.
      const dirty = (store, key) =>
        this.saveQueue.has(`${store}/${key}`) || this.conflicts.has(`${store}/${key}`)
        || this._streamKey === `${store}/${key}`;
      let updated = 0, removed = 0;
      for (const store of STORES) {
        const remoteRevs = remote[store] ?? {};
        const localRevs = this.revs[store] ?? {};
        for (const [key, rev] of Object.entries(remoteRevs)) {
          if (localRevs[key] === rev || dirty(store, key)) continue;
          try {
            const res = await this.#post('/load', { store, key, refs: true });
            // Re-check after the round trip: a set() landing meanwhile is
            // newer than the pull — leave it to the rev guard instead of
            // overwriting the cache (and the rev map) under it.
            if (dirty(store, key)) continue;
            await this.#applyRemote(store, key, res.data, Number.isInteger(res?.rev) ? res.rev : rev);
            updated++;
          } catch (e) { if (e?.status !== 404) console.warn('FictionPad: sync pull failed', e); }
        }
        if (store === 'Meta') continue; // settings are never deleted — no removal pass
        for (const key of Object.keys(this.cache[store] ?? {})) {
          if (key in remoteRevs || dirty(store, key)) continue;
          // In cache, not on the server, nothing queued locally: deleted on
          // another device (a local create-not-yet-saved is dirty, so it can
          // never reach this branch).
          delete this.cache[store][key];
          if (this.revs[store]) { delete this.revs[store][key]; this.#saveMirrorRevs(); }
          await this.#mDel(store, key);
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
    // Local writes land first (flush chains behind an in-flight one): a rev
    // comparison or pull against a half-flushed queue would read the key as
    // clean and clobber edits the put is still carrying.
    await this.flush();
    const remote = (await this.#post('/list', { revs: true }, { timeoutMs: 10000 }))?.revs ?? {};
    this._lastSync = now; // covers the focus sync's next throttle window too
    const serverRev = (remote[store] ?? {})[key];
    const localRev = this.revs[store]?.[key];
    if (serverRev === undefined) {
      // Gone server-side — only sweep a clean, previously-synced local copy.
      if (this.cache[store]?.[key] === undefined || localRev === undefined
        || this.saveQueue.has(id) || this.conflicts.has(id)) return 'fresh';
      delete this.cache[store][key];
      if (this.revs[store]) { delete this.revs[store][key]; this.#saveMirrorRevs(); }
      await this.#mDel(store, key);
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
      const res = await this.#post('/load', { store, key, refs: true }, { timeoutMs: 10000 });
      // A local set() landing during the round trip must win over the pull —
      // flush it into the 409 path instead of overwriting the cache.
      if (this.saveQueue.has(id) || this.conflicts.has(id)) {
        await this.flush();
        return this.conflicts.has(id) ? 'conflict' : 'fresh';
      }
      await this.#applyRemote(store, key, res.data, Number.isInteger(res?.rev) ? res.rev : serverRev);
      return 'pulled';
    } catch (e) {
      if (e?.status === 404) return 'fresh'; // vanished mid-check — the save re-creates
      throw e;
    }
  }
}

