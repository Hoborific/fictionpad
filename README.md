# FictionPad

A single-file LLM roleplay and story-writing frontend. The entire app is one HTML file: open it in a browser and it runs, whether from `file://` or any web server. It talks to any OpenAI-compatible chat-completions endpoint (vLLM, OpenRouter, OpenAI, llama.cpp, koboldcpp, TabbyAPI, ...) with your own API key.

Download `fictionpad.html` from any [release](../../releases) and open it locally.

## Features

- Scenario-centric roleplay: per-scenario prompts, a lorebook with keyword triggers (whole-word / case-sensitive options) and semantic embedding-based activation, per-chat lore overlays, auto-memory, author's note
- Multi-character scenes: name-prefixed multi-speaker replies, global character cards with optional name colours, `/pov` command to rewrite a reply from another character's perspective
- ✦ AI generator: type a prompt and the model drafts the whole scenario, character card, or a single lore piece — optionally fleshing out characters the model registers mid-chat
- Full conversation control: swipes and branching, message editing, drafts, lore templates, full-text chat search, complete export/import, and SillyTavern-style character card import (PNG or JSON)
- Generation introspection: token-probability heatmap with resampling, logit bias editor, sampler controls with per-chat overrides and per-scenario/character defaults, custom user-defined samplers, model reasoning ("thinking") display
- Automatic context limits: detects each model's context length from `/v1/models` (vLLM, llama.cpp, OpenRouter) and sizes the context budget and response reserve to match — manual pinning and per-chat overrides included
- Tool calling: the model registers characters and lore mid-reply via built-in tools, story variables, emergent lore generation — plus a cadence-based maintenance pass that reviews the chat's lore and memory notes against the recent story and can propose new pieces, rewrite stale pieces (chat-scoped, branch-safe), and revise memory notes, all through a review queue (or fully automatic)
- Personas: reusable user identities with per-chat pick and an optional default
- Polish: themes (including Catppuccin), a mobile UI with swipe gestures, configurable date formats, chat previews and a context inspector showing exactly what was sent to the model
- Runs fully client-side with IndexedDB persistence; the optional Node server adds LLM proxying and server-side session storage

## Quick start

### Just the app

Download `fictionpad.html` from the [latest release](../../releases/latest) and open it in a browser. Releases from v3.4 up are fully self-contained (all dependencies inlined); v3.3 and earlier load their JS dependencies from esm.sh on open, so they need an internet connection.

### With the server (recommended)

Requires Node.js >= 22.13 (zero dependencies, uses `node:sqlite`).

```sh
node server.mjs          # serves on the default port 8788
node server.mjs 9000     # or pick any port
```

Then open http://localhost:8788 and point the in-app endpoint at the built-in proxy, which forwards to your real LLM server:

```
http://localhost:8788/proxy/https://api.openai.com
http://localhost:8788/proxy/http://127.0.0.1:8080
```

The server serves the app, proxies LLM calls (no CORS pain, your API key goes upstream as `X-Real-Authorization`), and optionally stores sessions in SQLite so they sync across browsers.

On first run the server builds the fully self-contained app (`fictionpad.compiled.html`) in the background — the pinned JS dependencies are fetched from esm.sh once, and after that nothing loads from any CDN. Until that build exists (e.g. an offline first run), the repo's dev build is served instead, which needs esm.sh reachable on every page open; the server log says which one it's serving.

### Auth and configuration

All via environment variables:

| Variable | Effect |
| --- | --- |
| `FICTIONPAD_AUTH=user:password` | HTTP Basic auth for the whole server (everything except `/health`). These creds are never forwarded upstream. |
| `FICTIONPAD_TOKEN=secret` | Bearer token required on the storage and `/proxy` routes; set the same value as `serverToken` in the app. |
| `FICTIONPAD_DB=/path/to.db` | SQLite storage path (default: `fictionpad.db` next to `server.mjs`). |
| `FICTIONPAD_PROXY_ALLOW=host1,host2` | Comma-separated allowlist of `/proxy` target hosts (default: any host when auth is configured; loopback-only with no auth). |
| `FICTIONPAD_CHECKPOINT_MS=60000` | WAL checkpoint interval in ms — the on-disk `.db` is always a recent complete snapshot; `GET /backup` (same auth as storage) checkpoints and streams a temp snapshot copy. |
| `FICTIONPAD_UPSTREAM_TIMEOUT_MS=300000` | Total-duration cap in ms per proxied LLM call (streams included) — raise it for very slow backends. |
| `FICTIONPAD_MAX_BODY_MB=64` | Request body cap in MB for storage and `/proxy` — image-heavy chats travel as JSON, so keep it well above a busy chat's size. |
| `FICTIONPAD_AUTOBUILD=0` | Disable the background build of the self-contained app artifact when it's missing (default: build once at startup, never blocking). |

Example, basic auth on a custom port:

```sh
FICTIONPAD_AUTH=me:hunter2 node server.mjs 8788
```

Safety note: with no auth configured, `/proxy` only forwards to loopback targets, so an exposed unauthenticated server is not an open relay. Still, put `FICTIONPAD_AUTH` on anything reachable from the network.

## Building from source

The app ships as one HTML file, but the source is split for maintainability:

- `template.html` plus `src/` (`styles.css` and numbered JS modules, concatenated in the order listed in `vendor.mjs`; shared scope, order matters)
- `node vendor.mjs` regenerates `fictionpad.html` and `fictionpad.compiled.html`. Dependencies (React 19, htm, marked) are pinned, fetched from esm.sh, SHA-256 verified, and inlined as `data:` URL importmap entries, so the compiled artifact has no runtime CDN dependency
- `node vendor.mjs --check` fails if the generated artifacts are stale
- Tests: `node tests/assembler.test.mjs` and `node tests/server.test.mjs`

## Version history

This repository's history through v4.2 was reconstructed retroactively from dated snapshots: every commit is one milestone version, with rapid patch snapshots folded into their minor line. Development since follows the same commit-per-release convention with full semver tags (`vX.Y.Z`); the per-release detail lives in [CHANGELOG.md](CHANGELOG.md). Every tag has a GitHub release with the runnable `fictionpad.html` attached.

## Credits

FictionPad was designed, implemented and documented end to end by Kimi (K3, high effort), an AI coding agent by Moonshot AI, working under the direction of [@Hoborific](https://github.com/Hoborific). That covers the app, the server, the tests, the build tooling, this README, the changelog, and the reconstructed history itself.
