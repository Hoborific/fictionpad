// FictionPad — server.mjs storage tests.
// Spawns server.mjs on OS-picked ephemeral ports (argv "0"; the bound port is
// read from its startup log) with a temp FICTIONPAD_DB, asserts the storage
// protocol over HTTP, then checks the on-disk gzip encoding directly.
// Run: node tests/server.test.mjs

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync, gzipSync } from 'node:zlib';
import http from 'node:http';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SERVER = join(ROOT, 'server.mjs');

let failures = 0;
function ok(cond, name) {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}`); }
}

const post = (port, route, body, headers = {}) => fetch(`http://127.0.0.1:${port}${route}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body ?? {}),
});

async function waitReady(port) {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`server on :${port} did not start`);
}

// argv "0" = OS-picked ephemeral port, so parallel runs never collide. The
// server logs the bound port at startup ("app: http://localhost:N/") — read
// it from stdout; child.port resolves to it.
function startServer(env) {
  const child = spawn(process.execPath, [SERVER, '0'], {
    // Never auto-build the compiled artifact from tests — the suite spawns
    // several servers per run, and the build is orthogonal to what they assert.
    env: { FICTIONPAD_AUTOBUILD: '0', ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  child.port = new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (d) => {
      const m = /localhost:(\d+)/.exec(buf += d);
      if (m) resolve(Number(m[1]));
    });
    child.on('exit', () => reject(new Error('server exited before reporting its port')));
  });
  return child;
}

const stopServer = (child) => child && new Promise(r => { child.on('exit', r); child.kill(); });

const tmp = mkdtempSync(join(tmpdir(), 'fp-server-test-'));
const dbPath = join(tmp, 'test.db');
let portA, portB, portC, portU, portD, portE, portF, portG;
let a = null, b = null, c = null, d = null, e = null, f = null, g = null, upstream = null;
let hangClosed = false;

try {
  a = startServer({ FICTIONPAD_DB: dbPath });
  b = startServer({ FICTIONPAD_DB: join(tmp, 'auth.db'), FICTIONPAD_TOKEN: 'secret-tok' });
  [portA, portB] = await Promise.all([a.port, b.port]);
  await Promise.all([waitReady(portA), waitReady(portB)]);

  // /version shape
  const v = await (await fetch(`http://127.0.0.1:${portA}/version`)).json();
  ok(v.version === 1 && v.storage === true && v.images === true && v.gc === true && v.rev === true && v.gzip === true,
    '/version → {version:1, storage:true, images:true, gc:true, rev:true, gzip:true}');

  // save → load roundtrip (incl. unicode + nesting)
  const entity = { id: 'abc', name: 'Tést ☃', nested: { arr: [1, 2, 3], flag: true } };
  ok((await post(portA, '/save', { store: 'Scenarios', key: 'abc', data: entity })).ok, '/save → ok');
  const loadRes = await post(portA, '/load', { store: 'Scenarios', key: 'abc' });
  ok(loadRes.ok, '/load existing → 200');
  ok(JSON.stringify((await loadRes.json()).data) === JSON.stringify(entity), '/load roundtrips the entity');
  ok((await post(portA, '/load', { store: 'Scenarios', key: 'missing' })).status === 404, '/load missing → 404');

  // /save requires a key — a missing/empty key must not store a literal
  // "undefined"/"" row.
  ok((await post(portA, '/save', { store: 'Scenarios', data: { id: 'x' } })).status === 400, '/save without key → 400');
  ok((await post(portA, '/save', { store: 'Scenarios', key: '', data: { id: 'x' } })).status === 400, '/save with empty key → 400');

  // /all + /list + /delete
  await post(portA, '/save', { store: 'Scenarios', key: 'def', data: { id: 'def' } });
  await post(portA, '/save', { store: 'Chats', key: 'c1', data: { id: 'c1' } });
  const all = (await (await post(portA, '/all', { store: 'Scenarios' })).json()).entries;
  ok(Object.keys(all ?? {}).sort().join(',') === 'abc,def', '/all returns all entries for the store');
  const list = (await (await post(portA, '/list', {})).json()).stores;
  ok(list?.Scenarios === 2 && list?.Chats === 1, '/list counts per store');
  await post(portA, '/delete', { store: 'Scenarios', key: 'def' });
  ok((await post(portA, '/load', { store: 'Scenarios', key: 'def' })).status === 404, '/delete removes the row');

  // upsert semantics: same key overwritten (last write wins)
  await post(portA, '/save', { store: 'Scenarios', key: 'abc', data: { id: 'abc', v: 2 } });
  ok((await (await post(portA, '/load', { store: 'Scenarios', key: 'abc' })).json()).data.v === 2,
    '/save upserts (last write wins)');

  // ---- optimistic concurrency (rev-guarded writes) ----
  // Multi-device clobber guard: a client sends the rev its copy is based on
  // (baseRev); a mismatch is refused with 409 instead of overwriting the
  // newer write from another device. No baseRev = legacy blind upsert.
  {
    // Blind save (old client) bumps the rev and reports it.
    const s1 = await (await post(portA, '/save', { store: 'Chats', key: 'rev1', data: { id: 'rev1', v: 1 } })).json();
    ok(s1.ok === true && s1.rev === 1, 'blind /save on a new key → rev 1');
    const s2 = await (await post(portA, '/save', { store: 'Chats', key: 'rev1', data: { id: 'rev1', v: 2 } })).json();
    ok(s2.rev === 2, 'blind /save bumps the rev');
    ok((await (await post(portA, '/load', { store: 'Chats', key: 'rev1' })).json()).rev === 2,
      '/load returns the current rev');
    // Guarded save: matching baseRev wins, stale baseRev → 409 with the
    // current rev and NO overwrite.
    const g1 = await post(portA, '/save', { store: 'Chats', key: 'rev1', data: { id: 'rev1', v: 3 }, baseRev: 2 });
    ok(g1.ok && (await g1.json()).rev === 3, 'guarded /save with matching baseRev → 200, rev bumped');
    const stale = await post(portA, '/save', { store: 'Chats', key: 'rev1', data: { id: 'rev1', v: 99 }, baseRev: 2 });
    ok(stale.status === 409 && (await stale.json()).rev === 3, 'stale baseRev → 409 carrying the current rev');
    ok((await (await post(portA, '/load', { store: 'Chats', key: 'rev1' })).json()).data.v === 3,
      'the refused write did not land');
    ok((await post(portA, '/save', { store: 'Chats', key: 'rev1', data: {}, baseRev: 0 })).status === 409,
      'baseRev 0 on an existing row → 409');
    // Guarded create: missing row + baseRev 0 → rev 1.
    const gc = await post(portA, '/save', { store: 'Chats', key: 'rev2', data: { id: 'rev2' }, baseRev: 0 });
    ok(gc.ok && (await gc.json()).rev === 1, 'guarded /save on a missing row with baseRev 0 → rev 1');
    ok((await post(portA, '/save', { store: 'Chats', key: 'rev2', data: {}, baseRev: -1 })).status === 400,
      'negative baseRev → 400');
    // /all carries per-key revs alongside the entries.
    const allRev = await (await post(portA, '/all', { store: 'Chats' })).json();
    ok(allRev.revs?.rev1 === 3 && allRev.revs?.rev2 === 1, '/all returns per-key revs');
    // /list { revs: true } returns the cross-store diff map; plain /list doesn't.
    const listRev = await (await post(portA, '/list', { revs: true })).json();
    ok(listRev.revs?.Chats?.rev1 === 3 && listRev.revs?.Scenarios?.abc != null, '/list revs:true → per-key rev map');
    ok((await (await post(portA, '/list', {})).json()).revs === undefined, 'plain /list carries no rev map');
    // Delete, then a guarded save with the pre-delete rev → 409 (rev null);
    // baseRev 0 re-creates.
    await post(portA, '/delete', { store: 'Chats', key: 'rev2' });
    const ghost = await post(portA, '/save', { store: 'Chats', key: 'rev2', data: {}, baseRev: 1 });
    ok(ghost.status === 409 && (await ghost.json()).rev === null, 'guarded save on a deleted row → 409 with rev null');
    ok((await post(portA, '/save', { store: 'Chats', key: 'rev2', data: { id: 'rev2' }, baseRev: 0 })).ok,
      'baseRev 0 re-creates a deleted row');
    // Pre-rev databases migrate: rows from before the column existed read as
    // rev 0 and the first guarded write against them succeeds.
    const mdb = new DatabaseSync(join(tmp, 'migrate.db'));
    mdb.exec('CREATE TABLE kv (store TEXT, key TEXT, data BLOB, PRIMARY KEY (store, key))');
    mdb.prepare('INSERT INTO kv (store, key, data) VALUES (?, ?, ?)').run('Chats', 'old', gzipSync(Buffer.from('{"id":"old"}')));
    mdb.close();
    g = startServer({ FICTIONPAD_DB: join(tmp, 'migrate.db') });
    portG = await g.port;
    await waitReady(portG);
    ok((await (await post(portG, '/load', { store: 'Chats', key: 'old' })).json()).rev === 0,
      'migrated pre-rev row reads as rev 0');
    ok((await post(portG, '/save', { store: 'Chats', key: 'old', data: { id: 'old', v: 2 }, baseRev: 0 })).ok,
      'guarded save against a migrated rev-0 row succeeds');
    await stopServer(g); g = null;
  }

  // ---- delta /all (multi-device boot sync) ----
  // `known` maps key → the client's last-seen rev: only changed/new entries
  // come back, `revs` still covers every stored key, and `deleted` lists
  // known keys that vanished server-side. Without `known` the response is
  // the legacy full dump with NO deleted field (its absence is how the
  // client detects an old server that ignored the hint).
  {
    await post(portA, '/save', { store: 'Personas', key: 'p1', data: { id: 'p1', v: 1 } });
    await post(portA, '/save', { store: 'Personas', key: 'p2', data: { id: 'p2', v: 1 } });
    await post(portA, '/save', { store: 'Personas', key: 'p3', data: { id: 'p3', v: 1 } });
    const known = (await (await post(portA, '/all', { store: 'Personas' })).json()).revs;
    // Since the snapshot: p2 changed, p3 deleted, p4 created.
    await post(portA, '/save', { store: 'Personas', key: 'p2', data: { id: 'p2', v: 2 } });
    await post(portA, '/delete', { store: 'Personas', key: 'p3' });
    await post(portA, '/save', { store: 'Personas', key: 'p4', data: { id: 'p4', v: 1 } });
    const delta = await (await post(portA, '/all', { store: 'Personas', known })).json();
    ok(delta.entries?.p2?.v === 2, 'delta /all returns the changed key');
    ok(!('p1' in (delta.entries ?? {})), 'delta /all omits the unchanged key');
    ok(delta.entries?.p4?.v === 1, 'delta /all returns keys the client never knew');
    ok(JSON.stringify(delta.deleted) === JSON.stringify(['p3']),
      'delta /all lists the server-deleted known key');
    ok(delta.revs?.p1 === known.p1 && delta.revs?.p2 === known.p2 + 1 &&
      delta.revs?.p4 != null && !('p3' in delta.revs),
      'delta /all revs still covers every stored key');
    // A known key that never existed server-side is reported deleted too.
    const ghost = await (await post(portA, '/all', { store: 'Personas', known: { nope: 4 } })).json();
    ok(ghost.deleted?.includes('nope') && Object.keys(ghost.entries ?? {}).length === 3,
      'delta /all: unknown known keys reported deleted, everything else sent');
    // Backward compat: no `known` → full entries, NO deleted field at all.
    const full = await (await post(portA, '/all', { store: 'Personas' })).json();
    ok(Object.keys(full.entries ?? {}).sort().join(',') === 'p1,p2,p4',
      '/all without known returns the full store');
    ok(!('deleted' in full), '/all without known carries no deleted field');
    for (const k of ['p1', 'p2', 'p4']) await post(portA, '/delete', { store: 'Personas', key: k });
  }

  // ---- guarded /delete ----
  // Same optimistic-concurrency contract as /save: baseRev is the rev the
  // client's copy is based on; a stale baseRev is refused with 409 instead
  // of deleting a newer write from another device. No baseRev = legacy
  // blind delete; a missing row succeeds (nothing to clobber).
  {
    await post(portA, '/save', { store: 'Chats', key: 'del1', data: { v: 1 } }); // → rev 1
    ok((await post(portA, '/delete', { store: 'Chats', key: 'del1', baseRev: 1 })).ok,
      'guarded /delete with matching baseRev → 200');
    ok((await post(portA, '/load', { store: 'Chats', key: 'del1' })).status === 404,
      'guarded /delete removed the row');
    await post(portA, '/save', { store: 'Chats', key: 'del2', data: { v: 1 } });
    await post(portA, '/save', { store: 'Chats', key: 'del2', data: { v: 2 } }); // → rev 2
    const staleDel = await post(portA, '/delete', { store: 'Chats', key: 'del2', baseRev: 1 });
    ok(staleDel.status === 409 && JSON.stringify(await staleDel.json()) === JSON.stringify({ error: 'conflict', rev: 2 }),
      'stale baseRev → 409 {error:conflict, rev}');
    const intact = await (await post(portA, '/load', { store: 'Chats', key: 'del2' })).json();
    ok(intact.data?.v === 2 && intact.rev === 2, 'the refused delete left the row intact');
    ok((await post(portA, '/delete', { store: 'Chats', key: 'never-there', baseRev: 7 })).ok,
      'guarded /delete on a missing row → 200 (nothing to clobber)');
    ok((await post(portA, '/delete', { store: 'Chats', key: 'del2' })).ok,
      '/delete without baseRev → legacy blind delete');
    ok((await post(portA, '/load', { store: 'Chats', key: 'del2' })).status === 404,
      'the blind delete removed the row');
    ok((await post(portA, '/delete', { store: 'Chats', key: 'del1', baseRev: 1.5 })).status === 400,
      'non-integer baseRev on /delete → 400');
    ok((await post(portA, '/delete', { store: 'Chats', key: 'del1', baseRev: -1 })).status === 400,
      'negative baseRev on /delete → 400');
  }

  // unknown store → 400
  ok((await post(portA, '/save', { store: 'Nope', key: 'x', data: {} })).status === 400, 'unknown store → 400');
  ok((await post(portA, '/all', { store: 'Nope' })).status === 400, 'unknown store on /all → 400');

  // Images store + imgref rehydration for pre-v4.11 clients.
  {
    const imgId = '0123456789abcdef';
    const dataUrl = 'data:image/webp;base64,REHYDRATEME';
    ok((await post(portA, '/save', { store: 'Images', key: imgId, data: dataUrl })).ok, 'Images store accepted on /save');
    const refChat = { id: 'cimg', avatar: `imgref:${imgId}`, extra: 'imgref:nothex', missing: 'imgref:fedcba9876543210' };
    await post(portA, '/save', { store: 'Chats', key: 'cimg', data: refChat });
    // Old client (no refs hint): sentinels rehydrated inline.
    const oldView = (await (await post(portA, '/load', { store: 'Chats', key: 'cimg' })).json()).data;
    ok(oldView.avatar === dataUrl, '/load rehydrates imgref for old clients');
    ok(oldView.extra === 'imgref:nothex', '/load leaves ref-shaped user text alone');
    ok(oldView.missing === 'imgref:fedcba9876543210', '/load passes unknown refs through');
    const oldAll = (await (await post(portA, '/all', { store: 'Chats' })).json()).entries;
    ok(oldAll?.cimg?.avatar === dataUrl, '/all rehydrates imgref for old clients');
    // New client (refs: true): sentinels pass through (client rehydrates).
    const newView = (await (await post(portA, '/load', { store: 'Chats', key: 'cimg', refs: true })).json()).data;
    ok(newView.avatar === `imgref:${imgId}`, '/load with refs:true keeps sentinels');
    const newAll = (await (await post(portA, '/all', { store: 'Chats', refs: true })).json()).entries;
    ok(newAll?.cimg?.avatar === `imgref:${imgId}`, '/all with refs:true keeps sentinels');
    const imagesAll = (await (await post(portA, '/all', { store: 'Images' })).json()).entries;
    ok(imagesAll?.[imgId] === dataUrl, 'Images store roundtrips on /all');
    await post(portA, '/delete', { store: 'Images', key: imgId });
    ok(!(imgId in ((await (await post(portA, '/all', { store: 'Images' })).json()).entries ?? {})),
      'Images store row deleted');
    await post(portA, '/delete', { store: 'Chats', key: 'cimg' });
  }

  // corrupted kv blob: one bad row must not crash the server or kill /all.
  {
    const raw = new DatabaseSync(dbPath);
    raw.exec('PRAGMA busy_timeout=5000;');
    raw.prepare('INSERT OR REPLACE INTO kv (store, key, data) VALUES (?, ?, ?)')
      .run('Scenarios', 'bogus', Buffer.from('not-a-gzip-blob'));
    raw.close();
  }
  const allCorrupt = await post(portA, '/all', { store: 'Scenarios' });
  ok(allCorrupt.ok, 'corrupted row: /all → 200');
  const allCorruptEntries = (await allCorrupt.json()).entries;
  ok(!('bogus' in (allCorruptEntries ?? {})) && 'abc' in (allCorruptEntries ?? {}),
    'corrupted row: /all skips the bad row, keeps the good ones');
  ok((await post(portA, '/load', { store: 'Scenarios', key: 'bogus' })).status === 500,
    'corrupted row: /load of the bad key → 500');
  ok((await fetch(`http://127.0.0.1:${portA}/health`)).ok, 'server survives corrupted kv rows');

  // auth (server B has FICTIONPAD_TOKEN)
  const unauthVersion = await fetch(`http://127.0.0.1:${portB}/version`);
  ok(unauthVersion.status === 401, 'token: /version without header → 401');
  ok(unauthVersion.headers.get('x-fictionpad-auth') === 'required',
    'own 401 carries X-FictionPad-Auth: required');
  ok((await post(portB, '/save', { store: 'Chats', key: 'x', data: {} })).status === 401, 'token: /save without header → 401');
  ok((await post(portB, '/list', {})).status === 401, 'token: /list without header → 401');
  const auth = { Authorization: 'Bearer secret-tok' };
  ok((await fetch(`http://127.0.0.1:${portB}/version`, { headers: auth })).ok, 'token: /version with header → 200');
  ok((await post(portB, '/save', { store: 'Chats', key: 'x', data: { id: 'x' } }, auth)).ok, 'token: /save with header → 200');
  // open routes stay open even with a token set
  ok((await fetch(`http://127.0.0.1:${portB}/health`)).ok, 'token: /health stays open');

  // ---- whole-server Basic auth (server C: FICTIONPAD_AUTH + FICTIONPAD_TOKEN) ----
  c = startServer({
    FICTIONPAD_DB: join(tmp, 'basic.db'),
    FICTIONPAD_AUTH: 'alice:wonderland',
    FICTIONPAD_TOKEN: 'secret-tok',
  });
  portC = await c.port;
  await waitReady(portC);
  const basic = { Authorization: `Basic ${Buffer.from('alice:wonderland').toString('base64')}` };
  const basicWrong = { Authorization: `Basic ${Buffer.from('alice:nope').toString('base64')}` };

  const noCreds = await fetch(`http://127.0.0.1:${portC}/`);
  ok(noCreds.status === 401, 'basic: / without creds → 401');
  ok((noCreds.headers.get('www-authenticate') ?? '').includes('Basic realm="fictionpad"'),
    'basic: 401 carries WWW-Authenticate challenge');
  ok(noCreds.headers.get('x-fictionpad-auth') === 'required',
    'basic: own 401 carries X-FictionPad-Auth: required');
  ok((await fetch(`http://127.0.0.1:${portC}/version`)).status === 401, 'basic: storage route without creds → 401');
  ok((await fetch(`http://127.0.0.1:${portC}/`, { headers: basicWrong })).status === 401, 'basic: wrong creds → 401');
  ok((await fetch(`http://127.0.0.1:${portC}/`, { headers: basic })).ok, 'basic: correct creds → 200 on /');
  ok((await fetch(`http://127.0.0.1:${portC}/health`)).ok, 'basic: /health stays open');
  // both set → either credential suffices (one Authorization header per
  // request; app subrequests use Bearer, the browser uses Basic).
  ok((await fetch(`http://127.0.0.1:${portC}/version`, { headers: basic })).ok,
    'basic+bearer: storage route with Basic → 200');
  ok((await fetch(`http://127.0.0.1:${portC}/version`, { headers: auth })).ok,
    'basic+bearer: storage route with Bearer → 200');
  ok((await fetch(`http://127.0.0.1:${portC}/`, { headers: auth })).ok,
    'basic+bearer: app route with Bearer → 200');
  // a failed Bearer gets a plain JSON 401 WITHOUT WWW-Authenticate, so app
  // subrequests never trigger the browser's native password sheet.
  const badBearer = await fetch(`http://127.0.0.1:${portC}/version`,
    { headers: { Authorization: 'Bearer wrong' } });
  ok(badBearer.status === 401, 'basic+bearer: wrong Bearer → 401');
  ok(badBearer.headers.get('www-authenticate') === null,
    'basic+bearer: Bearer 401 carries no WWW-Authenticate (no password-sheet loop)');
  ok(badBearer.headers.get('x-fictionpad-auth') === 'required',
    'basic+bearer: Bearer 401 still carries X-FictionPad-Auth: required');

  // ---- /backup (checkpointed full-db download) ----
  await post(portA, '/save', { store: 'Meta', key: 'bkp', data: { stamp: 'backup-me' } });
  const bak = await fetch(`http://127.0.0.1:${portA}/backup`);
  ok(bak.status === 200, '/backup → 200');
  ok(bak.headers.get('content-type') === 'application/octet-stream',
    '/backup Content-Type is application/octet-stream');
  const cd = bak.headers.get('content-disposition') ?? '';
  ok(cd.includes('attachment') && /filename="fictionpad-backup-.+\.db"/.test(cd),
    '/backup Content-Disposition carries a dated .db filename');
  const bakBuf = Buffer.from(await bak.arrayBuffer());
  ok(bak.headers.get('content-length') === String(bakBuf.length),
    '/backup Content-Length matches the streamed body byte count');
  ok(bakBuf.length > 100 && bakBuf.subarray(0, 15).toString('utf8') === 'SQLite format 3' && bakBuf[15] === 0,
    '/backup body is a SQLite database file');
  // The row saved moments ago lives only in the WAL until a checkpoint — its
  // presence in the streamed .db proves /backup checkpoints before reading.
  const bakCopy = join(tmp, 'backup-copy.db');
  writeFileSync(bakCopy, bakBuf);
  {
    const raw = new DatabaseSync(bakCopy);
    ok(!!raw.prepare('SELECT data FROM kv WHERE store = ? AND key = ?').get('Meta', 'bkp'),
      '/backup contains the just-saved row (checkpoint-before-stream)');
    raw.close();
  }
  ok((await post(portA, '/backup', {})).status === 405, '/backup rejects POST (405)');
  const bakNoAuth = await fetch(`http://127.0.0.1:${portB}/backup`);
  ok(bakNoAuth.status === 401 && bakNoAuth.headers.get('x-fictionpad-auth') === 'required',
    '/backup: token server without Bearer → tagged 401');
  ok((await fetch(`http://127.0.0.1:${portB}/backup`, { headers: auth })).ok,
    '/backup: token server with Bearer → 200');
  ok((await fetch(`http://127.0.0.1:${portC}/backup`, { headers: basic })).ok,
    '/backup: basic server with Basic → 200');
  ok((await fetch(`http://127.0.0.1:${portC}/backup`, { headers: auth })).ok,
    '/backup: basic server with Bearer → 200 (either credential)');

  // CORS preflight must allow the X-Real-Authorization header the app sends.
  const preflight = await fetch(`http://127.0.0.1:${portA}/proxy/x`, { method: 'OPTIONS' });
  ok((preflight.headers.get('access-control-allow-headers') ?? '').includes('X-Real-Authorization'),
    'CORS preflight allows X-Real-Authorization');

  // CORS lockdown: CORS headers (incl. the preflight answer) are emitted only
  // when the Origin header is absent (same-origin/curl) or exactly 'null'
  // (file://). Any other Origin is still served, but gets no ACAO header.
  const evil = { Origin: 'https://evil.example' };
  const vNull = await fetch(`http://127.0.0.1:${portA}/version`, { headers: { Origin: 'null' } });
  ok(vNull.headers.get('access-control-allow-origin') === '*',
    'CORS: Origin "null" (file://) gets ACAO');
  const vEvil = await fetch(`http://127.0.0.1:${portA}/version`, { headers: evil });
  ok(vEvil.ok, 'CORS: foreign Origin is still served normally (200)');
  ok(vEvil.headers.get('access-control-allow-origin') === null,
    'CORS: foreign Origin gets NO ACAO header');
  const preNull = await fetch(`http://127.0.0.1:${portA}/proxy/x`,
    { method: 'OPTIONS', headers: { Origin: 'null' } });
  ok(preNull.headers.get('access-control-allow-origin') === '*' &&
    (preNull.headers.get('access-control-allow-headers') ?? '').includes('X-Real-Authorization'),
    'CORS: preflight from Origin "null" answered with full headers');
  const preEvil = await fetch(`http://127.0.0.1:${portA}/proxy/x`, { method: 'OPTIONS', headers: evil });
  ok(preEvil.headers.get('access-control-allow-origin') === null &&
    preEvil.headers.get('access-control-allow-headers') === null,
    'CORS: preflight from a foreign Origin carries no CORS headers');

  // CSRF write guard: ACAO only gates READING — simple cross-site POSTs (a
  // form with text/plain) still reach the server — so the mutating routes
  // reject any request carrying a foreign Origin outright.
  const csrfSave = await post(portA, '/save', { store: 'Meta', key: 'csrf', data: { pwned: true } }, evil);
  ok(csrfSave.status === 403, 'CSRF: /save with a foreign Origin → 403');
  ok((await post(portA, '/load', { store: 'Meta', key: 'csrf' })).status === 404,
    'CSRF: the foreign-origin write did not land');
  ok((await post(portA, '/save', { store: 'Meta', key: 'csrf', data: { ok: 1 } }, { Origin: 'null' })).ok,
    'CSRF: Origin "null" (file:// app) may still write');
  ok((await post(portA, '/save', { store: 'Meta', key: 'csrf', data: { ok: 2 } },
    { Origin: `http://127.0.0.1:${portA}` })).ok, 'CSRF: same-host Origin may still write');
  ok((await post(portB, '/save', { store: 'Meta', key: 'csrf', data: {} }, evil)).status === 403,
    'CSRF: guard runs before auth — foreign Origin → 403 even on the token server');

  // ---- /gc-images (server-side sweep over ALL stored entities) ----
  // The leftover corrupt Scenarios/bogus row would abort the sweep by design
  // (an undecodable row might reference images) — remove it first.
  await post(portA, '/delete', { store: 'Scenarios', key: 'bogus' });
  {
    const refImg = 'aaaa1111bbbb2222', orphanImg = 'cccc3333dddd4444';
    await post(portA, '/save', { store: 'Images', key: refImg, data: 'data:image/webp;base64,REFERENCED' });
    await post(portA, '/save', { store: 'Images', key: orphanImg, data: 'data:image/webp;base64,ORPHAN' });
    await post(portA, '/save', { store: 'Chats', key: 'gc-chat', data: { id: 'gc-chat', msgs: [{ pic: `imgref:${refImg}` }] } });
    const gc = await post(portA, '/gc-images');
    ok(gc.status === 200, '/gc-images → 200');
    ok((await gc.json()).deleted === 1, '/gc-images deletes exactly the orphan row');
    const imgs = (await (await post(portA, '/all', { store: 'Images' })).json()).entries ?? {};
    ok(imgs[refImg] === 'data:image/webp;base64,REFERENCED', '/gc-images keeps the referenced image row');
    ok(!(orphanImg in imgs), '/gc-images removes the unreferenced image row');
    // Meta is excluded from the reference scan but must never be swept.
    ok((await post(portA, '/load', { store: 'Meta', key: 'bkp' })).ok, '/gc-images leaves Meta rows alone');
    ok((await fetch(`http://127.0.0.1:${portA}/gc-images`)).status === 405, '/gc-images rejects GET (405)');
    ok((await post(portA, '/gc-images', {}, evil)).status === 403, '/gc-images: foreign Origin → 403');
    ok((await post(portB, '/gc-images')).status === 401, '/gc-images: token server without Bearer → 401');
    ok((await post(portB, '/gc-images', {}, auth)).ok, '/gc-images: token server with Bearer → 200');
    await post(portA, '/delete', { store: 'Chats', key: 'gc-chat' });
    await post(portA, '/delete', { store: 'Images', key: refImg });
  }

  // ---- request body cap (FICTIONPAD_MAX_BODY_MB) ----
  g = startServer({ FICTIONPAD_DB: join(tmp, 'cap.db'), FICTIONPAD_MAX_BODY_MB: '1' });
  portG = await g.port;
  await waitReady(portG);
  {
    const big = { store: 'Meta', key: 'big', data: { blob: 'x'.repeat(1024 * 1024) } }; // > 1 MB as JSON
    ok((await post(portG, '/save', big)).status === 413, 'body cap: oversized /save → 413');
    ok((await post(portG, '/load', { store: 'Meta', key: 'big' })).status === 404,
      'body cap: the oversized write did not land');
    ok((await post(portG, '/save', { store: 'Meta', key: 'small', data: { blob: 'y'.repeat(1024) } })).ok,
      'body cap: a body under the cap is still accepted');
    ok((await fetch(`http://127.0.0.1:${portG}/health`)).ok, 'server survives an oversized body');
  }

  // ---- gzip wire compression ----
  // JSON responses over 1 KB are gzipped when the client accepts it (undici
  // decompresses automatically and keeps the Content-Encoding header, so the
  // decoded body AND the on-the-wire encoding are both observable); storage
  // request bodies may arrive gzipped. /version's gzip:true is asserted above.
  {
    const big = { id: 'gz', blob: 'x'.repeat(8 * 1024) };
    await post(portA, '/save', { store: 'Chats', key: 'gz', data: big });
    const gzRes = await fetch(`http://127.0.0.1:${portA}/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip' },
      body: JSON.stringify({ store: 'Chats', key: 'gz' }),
    });
    ok(gzRes.headers.get('content-encoding') === 'gzip',
      'large response with Accept-Encoding: gzip → Content-Encoding: gzip');
    ok(JSON.stringify((await gzRes.json()).data) === JSON.stringify(big),
      'the gzipped response decodes to the stored entity');
    // Small replies are not worth compressing.
    const smallRes = await post(portA, '/save', { store: 'Chats', key: 'gz2', data: { id: 'gz2' } },
      { 'Accept-Encoding': 'gzip' });
    ok(smallRes.ok && smallRes.headers.get('content-encoding') === null,
      'small response is NOT gzipped even when accepted');
    // No gzip in Accept-Encoding → plain even for a large payload.
    const plainRes = await post(portA, '/load', { store: 'Chats', key: 'gz' },
      { 'Accept-Encoding': 'identity' });
    ok(plainRes.headers.get('content-encoding') === null,
      'large response without gzip acceptance stays plain');
    // The app HTML route is served gzipped from its mtime-keyed cache.
    const htmlRes = await fetch(`http://127.0.0.1:${portA}/`, { headers: { 'Accept-Encoding': 'gzip' } });
    ok(htmlRes.headers.get('content-encoding') === 'gzip', 'app HTML served gzipped when accepted');
    ok((await htmlRes.text()).includes('<'), 'the gzipped app HTML decodes to markup');
    // A gzipped request body round-trips through /save.
    const gzEntity = { id: 'gzreq', nested: { n: 42 } };
    const wireRes = await fetch(`http://127.0.0.1:${portA}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
      body: gzipSync(Buffer.from(JSON.stringify({ store: 'Chats', key: 'gzreq', data: gzEntity }))),
    });
    ok(wireRes.ok, 'gzipped /save body accepted');
    ok(JSON.stringify((await (await post(portA, '/load', { store: 'Chats', key: 'gzreq' })).json()).data) === JSON.stringify(gzEntity),
      'gzipped /save body round-trips');
    // An encoding the server doesn't speak is refused, not misread.
    const brRes = await fetch(`http://127.0.0.1:${portA}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'br' },
      body: JSON.stringify({ store: 'Chats', key: 'x', data: {} }),
    });
    ok(brRes.status === 415, 'unsupported Content-Encoding → 415');
    // The wire cap bounds the compressed bytes; the DECOMPRESSED payload is
    // capped too (zip-bomb guard). On the 1 MB cap server: 2 MB of highly
    // compressible JSON is tiny on the wire but over the cap inflated.
    const bomb = gzipSync(Buffer.from(JSON.stringify(
      { store: 'Meta', key: 'bomb', data: { blob: 'z'.repeat(2 * 1024 * 1024) } })));
    ok(bomb.length < 1024 * 1024, 'the compressed bomb body fits under the wire cap');
    const bombRes = await fetch(`http://127.0.0.1:${portG}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
      body: bomb,
    });
    ok(bombRes.status === 413, 'decompressed-over-limit body → 413');
    ok((await post(portG, '/load', { store: 'Meta', key: 'bomb' })).status === 404,
      'the over-limit write did not land');
    await post(portA, '/delete', { store: 'Chats', key: 'gz' });
    await post(portA, '/delete', { store: 'Chats', key: 'gz2' });
    await post(portA, '/delete', { store: 'Chats', key: 'gzreq' });
  }

  // ---- proxy credential hygiene (mock upstream echoes headers) ----
  upstream = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      // 302 to a host OFF the allowlist — the proxy must not follow it.
      res.writeHead(302, { Location: `http://localhost:${portU}/echo` });
      return res.end();
    }
    if (req.url === '/unauthorized') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'upstream says no' }));
    }
    if (req.url === '/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunks = ['data: one\n\n', 'data: two\n\n', 'data: three\n\n'];
      let i = 0;
      const tick = () => {
        if (i < chunks.length) { res.write(chunks[i++]); setTimeout(tick, 50); }
        else res.end();
      };
      tick();
      return;
    }
    if (req.url === '/hang') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: hi\n\n');
      req.on('close', () => { hangClosed = true; });
      return; // never ends — the client disconnect must tear this down
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.headers));
  });
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  portU = upstream.address().port; // in-process server: read the OS-picked port directly
  const viaProxy = (headers) => fetch(`http://127.0.0.1:${portC}/proxy/http://127.0.0.1:${portU}/echo`, { headers });

  const echoed1 = await (await viaProxy({ ...basic, cookie: 'session=abc' })).json();
  ok(!('authorization' in echoed1), 'proxy: server Basic creds NOT forwarded upstream');
  ok(!('cookie' in echoed1), 'proxy: Cookie NOT forwarded upstream');

  const echoed2 = await (await viaProxy({ ...basic, 'X-Real-Authorization': 'Bearer llm-key-123' })).json();
  ok(echoed2.authorization === 'Bearer llm-key-123', 'proxy: X-Real-Authorization mapped to upstream Authorization');
  ok(!('x-real-authorization' in echoed2), 'proxy: X-Real-Authorization itself NOT forwarded upstream');

  // Token-only deployment (server B, no X-Real-Authorization): the server
  // Bearer token must not leak upstream either.
  const echoedB = await (await fetch(`http://127.0.0.1:${portB}/proxy/http://127.0.0.1:${portU}/echo`, { headers: auth })).json();
  ok(!('authorization' in echoedB), 'proxy: server Bearer token NOT forwarded upstream (token-only deployment)');

  // ---- proxy access policy (P3) ----
  const proxyTo = (port, target, headers = {}) =>
    fetch(`http://127.0.0.1:${port}/proxy/${target}`, { headers });
  const loop = `http://127.0.0.1:${portU}/echo`;

  // No-auth server (A): loopback targets allowed, anything else refused so an
  // exposed unauthenticated server is not an open relay.
  ok((await proxyTo(portA, loop)).ok, 'proxy policy: no-auth server → loopback target allowed');
  const denied = await proxyTo(portA, 'http://203.0.113.1:9/');
  ok(denied.status === 403, 'proxy policy: no-auth server → non-loopback target refused (403)');

  // Token-only server (B): the proxy requires the same Bearer as storage.
  ok((await proxyTo(portB, loop)).status === 401, 'proxy policy: token server → /proxy without Bearer → 401');
  ok((await proxyTo(portB, loop, auth)).ok, 'proxy policy: token server → /proxy with Bearer → 200');

  // Basic server (C): Basic alone suffices (whole-server gate already ran).
  ok((await proxyTo(portC, loop)).status === 401, 'proxy policy: basic server → /proxy without creds → 401');
  ok((await proxyTo(portC, loop, basic)).ok, 'proxy policy: basic server → /proxy with Basic → 200');

  // Allowlist server (D): FICTIONPAD_PROXY_ALLOW=127.0.0.1 — host must match,
  // regardless of loopback status; Bearer auth still applies.
  d = startServer({
    FICTIONPAD_DB: join(tmp, 'allow.db'),
    FICTIONPAD_TOKEN: 'secret-tok',
    FICTIONPAD_PROXY_ALLOW: '127.0.0.1',
  });
  portD = await d.port;
  await waitReady(portD);
  ok((await proxyTo(portD, loop, auth)).ok, 'proxy policy: allowlisted host → 200');
  const offList = await proxyTo(portD, `http://localhost:${portU}/echo`, auth);
  ok(offList.status === 403, 'proxy policy: non-allowlisted host (even loopback alias) → 403');

  // CORS lockdown on proxied responses: ACAO only for the allowed origins.
  ok((await proxyTo(portA, loop, { Origin: 'null' })).headers.get('access-control-allow-origin') === '*',
    'CORS: proxied response to Origin "null" carries ACAO');
  const csrfProxy = await proxyTo(portA, loop, evil);
  ok(csrfProxy.status === 403 && csrfProxy.headers.get('access-control-allow-origin') === null,
    'CSRF: /proxy with a foreign Origin → 403 (rejected before proxying, no ACAO)');

  // An allowlisted host 302-ing elsewhere must not be followed past the
  // policy — the 3xx passes through to the client as-is.
  const redir = await fetch(`http://127.0.0.1:${portD}/proxy/http://127.0.0.1:${portU}/redirect`,
    { headers: auth, redirect: 'manual' });
  ok(redir.status === 302, 'proxy: upstream redirect NOT followed (3xx passed through)');

  // Malformed proxy target (bad percent-encoding) → 400, not a crashed worker.
  const malformed = await fetch(`http://127.0.0.1:${portA}/proxy/http%zz`);
  ok(malformed.status === 400, 'proxy: malformed target encoding → 400');
  ok((await fetch(`http://127.0.0.1:${portA}/health`)).ok, 'server survives malformed proxy target');

  // Upstream 401 passes through WITHOUT the server's own X-FictionPad-Auth tag.
  const upstream401 = await fetch(`http://127.0.0.1:${portA}/proxy/http://127.0.0.1:${portU}/unauthorized`);
  ok(upstream401.status === 401, 'proxy: upstream 401 passes through');
  ok(upstream401.headers.get('x-fictionpad-auth') === null,
    'proxy: upstream 401 NOT tagged with X-FictionPad-Auth');

  // SSE-style streaming: multi-chunk body arrives complete, in order, with
  // the upstream Content-Type preserved.
  const sse = await fetch(`http://127.0.0.1:${portA}/proxy/http://127.0.0.1:${portU}/stream`);
  ok((sse.headers.get('content-type') ?? '').includes('text/event-stream'),
    'proxy SSE: Content-Type preserved');
  ok((await sse.text()) === 'data: one\n\ndata: two\n\ndata: three\n\n',
    'proxy SSE: all chunks received in order');

  // Client disconnect mid-stream aborts the upstream request.
  {
    const acClient = new AbortController();
    const hangRes = await fetch(`http://127.0.0.1:${portA}/proxy/http://127.0.0.1:${portU}/hang`,
      { signal: acClient.signal });
    const reader = hangRes.body.getReader();
    await reader.read(); // first chunk arrived, stream is live
    acClient.abort();
    await reader.read().catch(() => {});
    let waited = 0;
    while (!hangClosed && waited < 5000) {
      await new Promise(r => setTimeout(r, 100));
      waited += 100;
    }
    ok(hangClosed, 'proxy: client disconnect aborts the upstream request');
  }

  // ---- WAL durability ----
  // Periodic TRUNCATE checkpoint (short interval via FICTIONPAD_CHECKPOINT_MS):
  // after a write, the -wal sidecar is truncated back to zero without a
  // restart, so the on-disk .db is always a recent complete snapshot.
  e = startServer({ FICTIONPAD_DB: join(tmp, 'ckpt.db'), FICTIONPAD_CHECKPOINT_MS: '200' });
  portE = await e.port;
  await waitReady(portE);
  await post(portE, '/save', { store: 'Meta', key: 'ck', data: { n: 1 } });
  {
    const walPath = join(tmp, 'ckpt.db-wal');
    let truncated = false;
    for (let i = 0; i < 40 && !truncated; i++) {
      await new Promise(r => setTimeout(r, 100));
      truncated = !existsSync(walPath) || statSync(walPath).size === 0;
    }
    ok(truncated, 'periodic wal_checkpoint(TRUNCATE) empties the -wal sidecar');
  }

  // Graceful shutdown: SIGTERM closes the db — closing the last WAL connection
  // checkpoints and removes the -wal/-shm sidecars — and exits 0.
  f = startServer({ FICTIONPAD_DB: join(tmp, 'sig.db') });
  portF = await f.port;
  await waitReady(portF);
  await post(portF, '/save', { store: 'Chats', key: 's1', data: { id: 's1' } });
  const sigDb = join(tmp, 'sig.db');
  const exitInfo = await new Promise(r => { f.on('exit', (code, sig) => r({ code, sig })); f.kill('SIGTERM'); });
  f = null; // already exited — don't kill() it again in the finally block
  ok(exitInfo.code === 0, 'SIGTERM → graceful shutdown, exit code 0');
  ok(!existsSync(`${sigDb}-wal`) && !existsSync(`${sigDb}-shm`),
    'SIGTERM shutdown removes the -wal/-shm sidecars (checkpoint on close)');
  {
    const raw = new DatabaseSync(sigDb);
    ok(!!raw.prepare('SELECT data FROM kv WHERE store = ? AND key = ?').get('Chats', 's1'),
      'data saved just before SIGTERM is in the .db itself');
    raw.close();
  }
} finally {
  await Promise.all([stopServer(a), stopServer(b), stopServer(c), stopServer(d), stopServer(e), stopServer(f), stopServer(g)]);
  upstream?.close();
}

// On-disk gzip integrity (checked after the server released the db file).
{
  const db = new DatabaseSync(dbPath);
  const row = db.prepare('SELECT data FROM kv WHERE store = ? AND key = ?').get('Scenarios', 'abc');
  const raw = row?.data;
  ok(raw && raw[0] === 0x1f && raw[1] === 0x8b, 'stored blob is gzip (magic bytes)');
  const text = gunzipSync(Buffer.from(raw)).toString('utf8');
  ok(text === JSON.stringify({ id: 'abc', v: 2 }), 'gunzip(blob) is byte-equal to the saved JSON');
  db.close();
}

rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? '\nAll server tests passed.' : `\n${failures} server test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
