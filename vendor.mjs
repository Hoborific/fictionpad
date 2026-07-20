#!/usr/bin/env node
// FictionPad dependency vendoring / compiler (docs/DESIGN.md §7 P1).
//
// fictionpad.html is the readable source: its importmap points at the esm.sh
// CDN. This script compiles the distribution artifact fictionpad.compiled.html
// by replacing the VENDORED-IMPORTMAP block with data: URL entries holding the
// pinned deps themselves — no runtime CDN dependency, works identically over
// http(s) and file://. (mikupad does the same via Parcel; we skip the bundler.)
//
//   node vendor.mjs          compile fictionpad.compiled.html (writes only on change)
//   node vendor.mjs --check  fail if the compiled file is missing or stale
//
// Deps are pinned by URL + SHA-256 and cached (pristine) in vendor/ (gitignored).
// To bump a dependency: change `url`, run `node vendor.mjs --rehash` to print
// the new hash, paste it into `sha256`, delete the vendor/ cache file, re-run.

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'fictionpad.html');
const OUT = join(ROOT, 'fictionpad.compiled.html');
const CACHE = join(ROOT, 'vendor');

const DEPS = [
  {
    spec: 'react',
    file: 'react.mjs',
    url: 'https://esm.sh/react@19.2.0/es2022/react.mjs',
    sha256: 'd19160930c1cb8323b5dc898d3283cee8776b2ff60eb852fca0deb5b469895f7',
  },
  {
    spec: 'react-dom/client',
    file: 'react-dom-client.mjs',
    url: 'https://esm.sh/react-dom@19.2.0/es2022/client.bundle.mjs?external=react',
    sha256: '0d59e3286f0ce1df61113199f53a1908863f56cd1a88c533c5bb07f631f7b5a3',
    // The bundle imports react via an esm.sh-absolute path — unresolvable from
    // a data: URL module. Rewrite to the bare specifier so the importmap's
    // "react" entry (the vendored copy above) satisfies it.
    rewrite: [['"/react@19.2.0/es2022/react.mjs"', '"react"']],
  },
  {
    spec: 'htm/react',
    file: 'htm-react.mjs',
    url: 'https://esm.sh/htm@3.1.1/es2022/react.bundle.mjs?external=react',
    sha256: '4f917bf19bc4bc1acceaf17c197835a125c1e7cc583564ad2c5e6808749fb993',
    rewrite: [['"/react?target=es2022"', '"react"']],
  },
  {
    spec: 'marked',
    file: 'marked.mjs',
    url: 'https://esm.sh/marked@16.4.1/es2022/marked.bundle.mjs',
    sha256: 'e577ff17f45bebe79e9cb73688cb6aaacb855cf32aa54fb8e933835b23b81b15',
  },
];

const BEGIN = '<!-- VENDORED-IMPORTMAP:BEGIN';
const END = '<!-- VENDORED-IMPORTMAP:END -->';
const mode = process.argv[2] ?? '';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function loadDep(dep) {
  const path = join(CACHE, dep.file);
  if (!existsSync(path)) {
    await mkdir(CACHE, { recursive: true });
    const res = await fetch(dep.url);
    if (!res.ok) throw new Error(`fetch ${dep.url} → HTTP ${res.status}`);
    await writeFile(path, Buffer.from(await res.arrayBuffer()));
    console.log(`  fetched ${dep.spec} (${dep.url})`);
  }
  const raw = await readFile(path);
  const hash = sha256(raw);
  if (mode === '--rehash') {
    console.log(`${dep.spec}: ${hash}`);
    return null;
  }
  if (hash !== dep.sha256)
    throw new Error(`${dep.spec}: SHA-256 mismatch (${hash} ≠ pinned ${dep.sha256}). ` +
      `Upstream content changed — inspect, then update the pin via --rehash.`);
  let text = raw.toString('utf8');
  for (const [from, to] of dep.rewrite ?? []) {
    if (!text.includes(from)) throw new Error(`${dep.spec}: rewrite target ${from} not found — upstream layout changed`);
    text = text.split(from).join(to);
  }
  return text;
}

function buildBlock(sources) {
  const imports = {};
  for (const dep of DEPS) imports[dep.spec] = `data:text/javascript,${encodeURIComponent(sources.get(dep.spec))}`;
  const versions = DEPS.map(d => d.url.match(/esm\.sh\/(@?[^@/]+@[^/]+)/)?.[1] ?? d.spec).join(', ');
  return [
    `${BEGIN} — vendored by vendor.mjs from esm.sh (${versions}). Regenerate with \`node vendor.mjs\`. -->`,
    '<script type="importmap">',
    JSON.stringify({ imports }, null, 2),
    '</script>',
    END,
  ].join('\n');
}

function compile(source, block) {
  const b = source.indexOf(BEGIN);
  const e = source.indexOf(END);
  if (b === -1 || e === -1 || e < b) throw new Error('VENDORED-IMPORTMAP markers not found (or out of order) in fictionpad.html');
  return source.slice(0, b) + block + source.slice(e + END.length);
}

const sources = new Map();
for (const dep of DEPS) {
  const text = await loadDep(dep);
  if (text != null) sources.set(dep.spec, text);
}
if (mode === '--rehash') process.exit(0);

const compiled = compile(await readFile(SRC, 'utf8'), buildBlock(sources));
const existing = existsSync(OUT) ? await readFile(OUT, 'utf8') : null;

if (mode === '--check') {
  if (existing !== compiled) {
    console.error('fictionpad.compiled.html is missing or stale — run `node vendor.mjs`');
    process.exit(1);
  }
  console.log('fictionpad.compiled.html is up to date');
} else if (existing === compiled) {
  console.log('fictionpad.compiled.html already up to date');
} else {
  await writeFile(OUT, compiled);
  console.log(`compiled fictionpad.compiled.html (${sources.size} deps inlined, ${compiled.length} bytes)`);
}
