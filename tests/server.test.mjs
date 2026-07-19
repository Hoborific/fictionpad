// FictionPad — server.mjs storage tests.
// Spawns server.mjs on ephemeral ports with a temp FICTIONPAD_DB, asserts the
// storage protocol over HTTP, then checks the on-disk gzip encoding directly.
// Run: node tests/server.test.mjs

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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
const portA = 18931, portB = 18932, portC = 18933, portU = 18934;
let a = null, b = null, c = null, upstream = null;

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

  // auth (server B has FICTIONPAD_TOKEN)
  ok((await fetch(`http://127.0.0.1:${portB}/version`)).status === 401, 'token: /version without header → 401');
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
  ok((await fetch(`http://127.0.0.1:${portC}/version`)).status === 401, 'basic: storage route without creds → 401');
  ok((await fetch(`http://127.0.0.1:${portC}/`, { headers: basicWrong })).status === 401, 'basic: wrong creds → 401');
  ok((await fetch(`http://127.0.0.1:${portC}/`, { headers: basic })).ok, 'basic: correct creds → 200 on /');
  ok((await fetch(`http://127.0.0.1:${portC}/health`)).ok, 'basic: /health stays open');
  // both set → Basic is checked first and suffices (one Authorization header
  // per request); Bearer alone can't pass the whole-server Basic gate.
  ok((await fetch(`http://127.0.0.1:${portC}/version`, { headers: basic })).ok,
    'basic+bearer: storage route with Basic → 200 (Basic suffices)');
  ok((await fetch(`http://127.0.0.1:${portC}/version`, { headers: auth })).status === 401,
    'basic+bearer: Bearer-only → 401 (whole-server Basic checked first)');

  // ---- proxy credential hygiene (mock upstream echoes headers) ----
  upstream = http.createServer((req, res) => {
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
} finally {
  await Promise.all([stopServer(a), stopServer(b), stopServer(c)]);
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
