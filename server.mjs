#!/usr/bin/env node
// FictionPad local server: serves fictionpad.html, proxies LLM API calls
// (mikupad-style /proxy/*), and optionally stores sessions in SQLite.
// Zero dependencies — requires Node.js >= 18.
//
// Usage:
//   node server.mjs [port]          (default port 8788)
//   open http://localhost:8788
// Then set the in-app endpoint to your real LLM server as usual — but route it
// through the proxy:  http://localhost:8788/proxy/<your-real-endpoint>
// Example:  http://localhost:8788/proxy/http://127.0.0.1:8080
//           http://localhost:8788/proxy/https://api.openai.com
// (The app normalizes and appends /v1/chat/completions etc. — everything after
// /proxy/ is forwarded verbatim as the target URL.)
//
// Env:
//   FICTIONPAD_DB       SQLite path (default: fictionpad.db next to server.mjs)
//   FICTIONPAD_TOKEN    storage routes require Authorization: Bearer <token>
//   FICTIONPAD_AUTH     user:password — whole-server HTTP Basic auth (except
//                       /health). The proxy never forwards these creds upstream;
//                       the app sends its LLM key as X-Real-Authorization instead.
//   FICTIONPAD_PROXY_ALLOW  comma-separated target host allowlist for /proxy
//                       (e.g. "proxy.example.com,10.0.0.6"). Default: any host.
// Proxy access policy:
//   - FICTIONPAD_AUTH set   → /proxy is behind Basic like everything else.
//   - only FICTIONPAD_TOKEN → /proxy requires the same Bearer token.
//   - neither set           → /proxy only forwards to loopback targets
//                             (localhost/127.0.0.1/[::1]), so an exposed
//                             unauthenticated server is not an open relay.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync, gunzipSync } from 'node:zlib';

const PORT = Number(process.argv[2]) || 8788;
const ROOT = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.FICTIONPAD_DB || join(ROOT, 'fictionpad.db');
const TOKEN = process.env.FICTIONPAD_TOKEN || null; // when set, storage routes need Bearer auth

// Whole-server HTTP Basic auth (LAN exposure): FICTIONPAD_AUTH=user:password.
// Everything except /health requires it; checked before the Bearer token.
let BASIC_USER = null, BASIC_HEADER = null;
if (process.env.FICTIONPAD_AUTH) {
  const i = process.env.FICTIONPAD_AUTH.indexOf(':');
  if (i > 0) {
    BASIC_USER = process.env.FICTIONPAD_AUTH.slice(0, i);
    BASIC_HEADER = `Basic ${Buffer.from(process.env.FICTIONPAD_AUTH, 'utf8').toString('base64')}`;
  } else {
    console.warn('FICTIONPAD_AUTH is malformed (expected user:password) — ignoring it.');
  }
}
const bearerOk = (req) => !!TOKEN && req.headers.authorization === `Bearer ${TOKEN}`;
const basicOk = (req) => !!BASIC_HEADER && req.headers.authorization === BASIC_HEADER;
// One credential check for every gated route: Basic (when configured) OR
// Bearer (when configured) — a request carries only one Authorization header,
// and app subrequests legitimately use Bearer while the browser uses Basic.
// With neither configured the server is open (local dev; see the startup warning).
const credsOk = (req) => (!BASIC_HEADER && !TOKEN) || basicOk(req) || bearerOk(req);
const isBearer = (req) => /^Bearer /i.test(req.headers.authorization ?? '');
const basicChallenge = (res, req) => {
  // A request that already presented Bearer creds comes from an API client
  // (never a bare browser navigation) — answering with WWW-Authenticate would
  // make Safari/Chrome pop the native password sheet on every failed fetch.
  const headers = { 'Content-Type': 'application/json' };
  if (!isBearer(req)) headers['WWW-Authenticate'] = 'Basic realm="fictionpad"';
  res.writeHead(401, headers);
  res.end(JSON.stringify({ error: 'unauthorized' }));
};

// ---- server-side storage (mikupad-style): one kv table, gzip-compressed JSON ----
const KNOWN_STORES = new Set(['Scenarios', 'Personas', 'Chats', 'Meta', 'Characters']);
const db = new DatabaseSync(DB_PATH);
db.exec('CREATE TABLE IF NOT EXISTS kv (store TEXT, key TEXT, data BLOB, PRIMARY KEY (store, key))');
const sendJson = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
};
const readJsonBody = async (req) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
};

const HOP_BY_HOP = new Set([
  'host', 'connection', 'keep-alive', 'transfer-encoding', 'te',
  'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate',
]);

// /proxy target policy (see header comment). An allowlist always wins; an
// unauthenticated server is limited to loopback targets so it cannot be
// abused as an open relay.
const PROXY_ALLOW = (process.env.FICTIONPAD_PROXY_ALLOW ?? '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
function proxyTargetAllowed(target) {
  let host;
  try { host = new URL(target).hostname.toLowerCase(); }
  catch { return { ok: false, reason: 'unparseable proxy target' }; }
  if (PROXY_ALLOW.length) {
    return PROXY_ALLOW.includes(host)
      ? { ok: true }
      : { ok: false, reason: `proxy target host "${host}" is not in FICTIONPAD_PROXY_ALLOW` };
  }
  if (!BASIC_HEADER && !TOKEN && !LOOPBACK_HOSTS.has(host)) {
    return { ok: false, reason: `proxy only forwards to loopback targets while the server has no auth ` +
      `(set FICTIONPAD_AUTH or FICTIONPAD_TOKEN, or allow hosts via FICTIONPAD_PROXY_ALLOW)` };
  }
  return { ok: true };
}

// Serve the compiled (vendored, offline-capable) build when present — that's
// the distribution artifact; the readable source is the fallback (dev).
const APP_FILE = existsSync(join(ROOT, 'fictionpad.compiled.html'))
  ? 'fictionpad.compiled.html'
  : 'fictionpad.html';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // CORS preflight (only matters if the page is opened from another origin,
  // e.g. file:// — same-origin use needs no CORS at all).
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // Whole-server Basic auth (when FICTIONPAD_AUTH is set) — before everything
  // else. A valid Bearer token also passes (app subrequests use Bearer while
  // the browser uses Basic). /health stays open.
  if (BASIC_HEADER && !credsOk(req)) return basicChallenge(res, req);

  if (url.pathname === '/' || url.pathname === '/fictionpad.html') {
    try {
      const html = await readFile(join(ROOT, APP_FILE));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(html);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end(`${APP_FILE} not found next to server.mjs`);
    }
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // ---- storage protocol ----
  // Gated by either configured credential (Basic or Bearer); open when neither
  // is set (local dev default — see the startup warning).
  const storageOk = credsOk;
  if (url.pathname === '/version' && req.method === 'GET') {
    if (!storageOk(req)) return sendJson(res, 401, { error: 'unauthorized' });
    return sendJson(res, 200, { version: 1, storage: true });
  }

  if (['/load', '/save', '/all', '/delete', '/list'].includes(url.pathname)) {
    if (!storageOk(req)) return sendJson(res, 401, { error: 'unauthorized' });
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST required' });
    let body;
    try { body = await readJsonBody(req); }
    catch { return sendJson(res, 400, { error: 'invalid JSON' }); }
    const { store, key, data } = body ?? {};
    if (url.pathname !== '/list' && !KNOWN_STORES.has(store))
      return sendJson(res, 400, { error: `unknown store: ${store}` });
    switch (url.pathname) {
      case '/load': {
        const row = db.prepare('SELECT data FROM kv WHERE store = ? AND key = ?').get(store, String(key));
        if (!row) return sendJson(res, 404, { error: 'not found' });
        return sendJson(res, 200, { data: JSON.parse(gunzipSync(row.data).toString('utf8')) });
      }
      case '/save': {
        if (data === undefined) return sendJson(res, 400, { error: 'missing data' });
        const blob = gzipSync(Buffer.from(JSON.stringify(data), 'utf8'));
        db.prepare('INSERT OR REPLACE INTO kv (store, key, data) VALUES (?, ?, ?)').run(store, String(key), blob);
        return sendJson(res, 200, { ok: true });
      }
      case '/all': {
        const entries = {};
        for (const row of db.prepare('SELECT key, data FROM kv WHERE store = ?').all(store))
          entries[row.key] = JSON.parse(gunzipSync(row.data).toString('utf8'));
        return sendJson(res, 200, { entries });
      }
      case '/delete': {
        db.prepare('DELETE FROM kv WHERE store = ? AND key = ?').run(store, String(key));
        return sendJson(res, 200, { ok: true });
      }
      case '/list': {
        const stores = {};
        for (const row of db.prepare('SELECT store, COUNT(*) AS n FROM kv GROUP BY store').all())
          stores[row.store] = row.n;
        return sendJson(res, 200, { stores });
      }
    }
  }

  if (url.pathname.startsWith('/proxy/')) {
    // Gated by either configured credential, same as the storage routes; open
    // only when the server has no auth at all (and then loopback-only below).
    if (!credsOk(req)) return sendJson(res, 401, { error: 'unauthorized' });
    const target = decodeURIComponent(url.pathname.slice('/proxy/'.length)) + url.search;
    if (!/^https?:\/\//i.test(target)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('proxy target must start with http:// or https://');
    }
    const verdict = proxyTargetAllowed(target);
    if (!verdict.ok) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end(verdict.reason);
    }

    // Collect the request body (if any).
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const lk = k.toLowerCase();
      if (HOP_BY_HOP.has(lk) || lk === 'cookie' || lk === 'x-real-authorization') continue;
      if (lk === 'authorization' && BASIC_HEADER && v === BASIC_HEADER) continue; // never leak our own Basic creds upstream
      if (typeof v === 'string') headers[k] = v;
    }
    // The app sends the LLM key as X-Real-Authorization when routing through
    // this proxy; map it to the upstream Authorization header.
    const realAuth = req.headers['x-real-authorization'];
    if (typeof realAuth === 'string') headers['authorization'] = realAuth;

    // Propagate client disconnects to the upstream request.
    const ac = new AbortController();
    res.on('close', () => ac.abort());

    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body,
        signal: ac.signal,
      });

      const resHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      };
      res.writeHead(upstream.status, resHeaders);

      // Stream the body back chunk-by-chunk (keeps SSE/token streaming live).
      if (!upstream.body) return res.end();
      const reader = upstream.body.getReader();
      const pump = async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!res.write(value)) {
              await new Promise((resolve) => res.once('drain', resolve));
            }
          }
          res.end();
        } catch {
          res.destroy();
        }
      };
      pump();
    } catch (err) {
      if (err?.name === 'AbortError') return;
      res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end(`proxy error: ${err?.message || err}`);
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`FictionPad server running:`);
  console.log(`  app:     http://localhost:${PORT}/ (serving ${APP_FILE})`);
  console.log(`  proxy:   http://localhost:${PORT}/proxy/<real-endpoint>`);
  console.log(`  storage: SQLite kv at ${DB_PATH}`);
  if (BASIC_HEADER) console.log(`  auth:    basic (user ${BASIC_USER}) — FICTIONPAD_AUTH, whole server except /health`);
  if (TOKEN) console.log(`  auth:    FICTIONPAD_TOKEN required for storage + proxy routes`);
  if (PROXY_ALLOW.length) console.log(`  proxy:   target allowlist: ${PROXY_ALLOW.join(', ')}`);
  if (!BASIC_HEADER && !TOKEN)
    console.warn('  WARNING: no auth configured — anyone who can reach this port can use storage;' +
      ' /proxy is restricted to loopback targets. Set FICTIONPAD_AUTH=user:password before exposing this server.');
});
