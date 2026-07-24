// FictionPad — server.mjs storage tests.
// Spawns server.mjs on ephemeral ports with a temp FICTIONPAD_DB, asserts the
// storage protocol over HTTP, then checks the on-disk gzip encoding directly.
// Run: node tests/server.test.mjs

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
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

function startServer(port, env) {
  return spawn(process.execPath, [SERVER, String(port)], {
    env: { ...process.env, ...env },
    stdio: 'ignore',
  });
}

const stopServer = (child) => child && new Promise(r => { child.on('exit', r); child.kill(); });

const tmp = mkdtempSync(join(tmpdir(), 'fp-server-test-'));
const dbPath = join(tmp, 'test.db');
const portA = 18931, portB = 18932, portC = 18933, portU = 18934, portD = 18935;
const portE = 18936, portF = 18937;
let a = null, b = null, c = null, d = null, e = null, f = null, upstream = null;
let hangClosed = false;

try {
  a = startServer(portA, { FICTIONPAD_DB: dbPath });
  b = startServer(portB, { FICTIONPAD_DB: join(tmp, 'auth.db'), FICTIONPAD_TOKEN: 'secret-tok' });
  await Promise.all([waitReady(portA), waitReady(portB)]);

  // /version shape
  const v = await (await fetch(`http://127.0.0.1:${portA}/version`)).json();
  ok(v.version === 1 && v.storage === true, '/version → {version:1, storage:true}');

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

  // unknown store → 400
  ok((await post(portA, '/save', { store: 'Nope', key: 'x', data: {} })).status === 400, 'unknown store → 400');
  ok((await post(portA, '/all', { store: 'Nope' })).status === 400, 'unknown store on /all → 400');

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
  c = startServer(portC, {
    FICTIONPAD_DB: join(tmp, 'basic.db'),
    FICTIONPAD_AUTH: 'alice:wonderland',
    FICTIONPAD_TOKEN: 'secret-tok',
  });
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
  await new Promise(r => upstream.listen(portU, '127.0.0.1', r));
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
  d = startServer(portD, {
    FICTIONPAD_DB: join(tmp, 'allow.db'),
    FICTIONPAD_TOKEN: 'secret-tok',
    FICTIONPAD_PROXY_ALLOW: '127.0.0.1',
  });
  await waitReady(portD);
  ok((await proxyTo(portD, loop, auth)).ok, 'proxy policy: allowlisted host → 200');
  const offList = await proxyTo(portD, `http://localhost:${portU}/echo`, auth);
  ok(offList.status === 403, 'proxy policy: non-allowlisted host (even loopback alias) → 403');

  // CORS lockdown on proxied responses: ACAO only for the allowed origins.
  ok((await proxyTo(portA, loop, { Origin: 'null' })).headers.get('access-control-allow-origin') === '*',
    'CORS: proxied response to Origin "null" carries ACAO');
  ok((await proxyTo(portA, loop, evil)).headers.get('access-control-allow-origin') === null,
    'CORS: proxied response to a foreign Origin carries no ACAO');

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
  e = startServer(portE, { FICTIONPAD_DB: join(tmp, 'ckpt.db'), FICTIONPAD_CHECKPOINT_MS: '200' });
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
  f = startServer(portF, { FICTIONPAD_DB: join(tmp, 'sig.db') });
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
  await Promise.all([stopServer(a), stopServer(b), stopServer(c), stopServer(d), stopServer(e), stopServer(f)]);
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
