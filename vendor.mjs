#!/usr/bin/env node
// FictionPad assembler + dependency vendoring / compiler (docs/DESIGN.md §7 P1).
//
// Two steps:
//  1. assemble: template.html + src/styles.css + src/*.js (ordered below)
//     → fictionpad.html (the readable single-file source, esm.sh importmap).
//     fictionpad.html is GENERATED — edit template.html / src/*, never it.
//  2. compile: fictionpad.html → fictionpad.compiled.html by replacing the
//     VENDORED-IMPORTMAP block with data: URL entries holding the pinned deps
//     themselves — no runtime CDN dependency, works identically over http(s)
//     and file://. (mikupad does the same via Parcel; we skip the bundler.)
//
//   node vendor.mjs          assemble + compile (writes only on change)
//   node vendor.mjs --check  fail if either artifact is missing or stale
//
// Deps are pinned by URL + SHA-256 and cached (pristine) in vendor/ (gitignored).
// To bump a dependency: change `url`, run `node vendor.mjs --rehash` to print
// the new hash, paste it into `sha256`, delete the vendor/ cache file, re-run.

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(ROOT, 'template.html');
const SRC_DIR = join(ROOT, 'src');
const SRC = join(ROOT, 'fictionpad.html');
const OUT = join(ROOT, 'fictionpad.compiled.html');
const CACHE = join(ROOT, 'vendor');

// Appended verbatim, in this order, into template.html's module script.
// Concatenated scripts share one scope — order matters, names must not collide.
const SRC_FILES = [
  '00-imports.js',
  '10-themes.js',
  '20-prose.js',
  '30-core.js',
  '40-storage.js',
  '50-api.js',
  '60-hooks.js',
  '70-util.js',
  '80-base-components.js',
  '81-scenario-editor.js',
  '82-personas.js',
  '83-settings.js',
  '84-logit-bias.js',
  '85-inspector.js',
  '86-memory-panel.js',
  '87-chat-options.js',
  '88-messages.js',
  '89-composer.js',
  '90-chat-pane.js',
  '91-sidebar.js',
  '92-modals.js',
  '93-panels.js',
  '96-characters.js',
  '94-main.js',
  '95-app.js',
];

async function assemble() {
  let template = await readFile(TEMPLATE, 'utf8');
  // Drift guard: every src/*.js fragment must be registered in SRC_FILES —
  // an unregistered file would otherwise be silently omitted from the build.
  const onDisk = (await readdir(SRC_DIR)).filter(f => f.endsWith('.js'));
  const unregistered = onDisk.filter(f => !SRC_FILES.includes(f));
  if (unregistered.length)
    throw new Error(`src fragment(s) missing from SRC_FILES in vendor.mjs: ${unregistered.join(', ')}`);
  const css = (await readFile(join(SRC_DIR, 'styles.css'), 'utf8')).replace(/\n$/, '');
  const parts = [];
  for (const f of SRC_FILES)
    parts.push((await readFile(join(SRC_DIR, f), 'utf8')).replace(/\n$/, ''));
  const js = parts.join('\n');
  if (!template.includes('/*__STYLE__*/\n') || !template.includes('//__SCRIPT__\n'))
    throw new Error('template.html placeholders (/*__STYLE__*/ / //__SCRIPT__) not found');
  // Function replacers: src content may contain `$&`-style patterns that
  // String.replace would otherwise interpret in the replacement string.
  return template.replace('/*__STYLE__*/\n', () => css + '\n').replace('//__SCRIPT__\n', () => js + '\n');
}

const DEPS = [
  {
    spec: 'react',
    file: 'react.mjs',
    url: 'https://esm.sh/react@19.2.7/es2022/react.mjs',
    sha256: 'b3d382311b81990c02fbfad394d0eaa38fad8c4a8c39b01e6349b21f2760cdc7',
  },
  {
    spec: 'react-dom/client',
    file: 'react-dom-client.mjs',
    url: 'https://esm.sh/react-dom@19.2.7/es2022/client.bundle.mjs?external=react',
    sha256: 'e4d715976d99910ed91cf2c2a79a2ad5a2b3a0dd6e9e2259ce0fbfb648ce57de',
    // The bundle imports react + scheduler via esm.sh-absolute paths —
    // unresolvable from a data: URL module. Rewrite to bare specifiers so the
    // importmap entries (the vendored copies) satisfy them.
    rewrite: [
      ['"/react@19.2.7/es2022/react.mjs"', '"react"'],
      ['"/scheduler@^0.27.0/cjs/scheduler.production?target=es2022"', '"scheduler"'],
    ],
  },
  {
    spec: 'scheduler',
    file: 'scheduler.mjs',
    url: 'https://esm.sh/scheduler@0.27.0/es2022/scheduler.mjs',
    sha256: 'b1ba1723bf253d62b0aa1c3c0603d0d025010642158b0e746ae1fd6f7500deeb',
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
    url: 'https://esm.sh/marked@18.0.6/es2022/marked.bundle.mjs',
    sha256: '9ed7f4041b510337da206c06ac115fdedd9fc3396c3e3067ece2a683d1d329cb',
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

// Step 1: assemble fictionpad.html from template + src.
const assembled = await assemble();
const currentSrc = existsSync(SRC) ? await readFile(SRC, 'utf8') : null;
if (mode === '--check' && currentSrc !== assembled) {
  console.error('fictionpad.html is missing or stale (template.html/src changed) — run `node vendor.mjs`');
  process.exit(1);
}
if (currentSrc !== assembled) {
  await writeFile(SRC, assembled);
  console.log(`assembled fictionpad.html (${SRC_FILES.length} sources, ${assembled.length} bytes)`);
}

// Step 2: compile the distribution artifact.
const compiled = compile(assembled, buildBlock(sources));
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
