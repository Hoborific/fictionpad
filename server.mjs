#!/usr/bin/env node
// FictionPad local server: serves fictionpad.html and proxies LLM API calls
// so the browser never hits CORS or mixed-content blocks (mikupad-style /proxy/*).
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

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync, gunzipSync } from 'node:zlib';

const PORT = Number(process.argv[2]) || 8788;
const ROOT = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.FICTIONPAD_DB || join(ROOT, 'fictionpad.db');
const TOKEN = process.env.FICTIONPAD_TOKEN || null; // when set, storage routes need Bearer auth

// ---- server-side storage (mikupad-style): one kv table, gzip-compressed JSON ----
const KNOWN_STORES = new Set(['Scenarios', 'Personas', 'Chats', 'Meta']);
const db = new DatabaseSync(DB_PATH);
db.exec('CREATE TABLE IF NOT EXISTS kv (store TEXT, key TEXT, data BLOB, PRIMARY KEY (store, key))');
const authed = (req) => !TOKEN || req.headers.authorization === `Bearer ${TOKEN}`;
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

  if (url.pathname === '/' || url.pathname === '/fictionpad.html') {
    try {
      const html = await readFile(join(ROOT, 'fictionpad.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('fictionpad.html not found next to server.mjs');
    }
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // ---- storage protocol ----
  if (url.pathname === '/version' && req.method === 'GET') {
    if (!authed(req)) return sendJson(res, 401, { error: 'unauthorized' });
    return sendJson(res, 200, { version: 1, storage: true });
  }

  if (['/load', '/save', '/all', '/delete', '/list'].includes(url.pathname)) {
    if (!authed(req)) return sendJson(res, 401, { error: 'unauthorized' });
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
    const target = decodeURIComponent(url.pathname.slice('/proxy/'.length)) + url.search;
    if (!/^https?:\/\//i.test(target)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('proxy target must start with http:// or https://');
    }

    // Collect the request body (if any).
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(k.toLowerCase()) && typeof v === 'string') headers[k] = v;
    }

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
  console.log(`  app:     http://localhost:${PORT}/`);
  console.log(`  proxy:   http://localhost:${PORT}/proxy/<real-endpoint>`);
  console.log(`  storage: SQLite kv at ${DB_PATH}`);
  if (TOKEN) console.log(`  auth:    FICTIONPAD_TOKEN required for storage routes`);
});
