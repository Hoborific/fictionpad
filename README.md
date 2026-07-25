# FictionPad

A single-file LLM roleplay and story-writing frontend. The entire app is one HTML file: open it in a browser and it runs, whether from `file://` or any web server. It talks to any OpenAI-compatible chat-completions endpoint (vLLM, OpenRouter, OpenAI, llama.cpp, koboldcpp, TabbyAPI, ...) with your own API key.

Download `fictionpad.html` from any [release](../../releases) and open it locally.

## Features

- Scenario-centric roleplay: per-scenario prompts, a lorebook with keyword triggers (whole-word / case-sensitive options) and semantic embedding-based activation, per-chat lore overlays, auto-memory, author's note
- Multi-character scenes: name-prefixed multi-speaker replies, global character cards, `/pov` command to rewrite a reply from another character's perspective
- Full conversation control: swipes and branching, message editing, drafts, lore templates, complete export/import
- Generation introspection: token-probability heatmap with resampling, logit bias editor, sampler controls with per-chat overrides and custom user-defined samplers, model reasoning ("thinking") display
- Tool calling: built-in and custom tools, story variables, emergent lore generation
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

### Auth and configuration

All via environment variables:

| Variable | Effect |
| --- | --- |
| `FICTIONPAD_AUTH=user:password` | HTTP Basic auth for the whole server (everything except `/health`). These creds are never forwarded upstream. |
| `FICTIONPAD_TOKEN=secret` | Bearer token required on the storage and `/proxy` routes; set the same value as `serverToken` in the app. |
| `FICTIONPAD_DB=/path/to.db` | SQLite storage path (default: `fictionpad.db` next to `server.mjs`). |
| `FICTIONPAD_PROXY_ALLOW=host1,host2` | Comma-separated allowlist of `/proxy` target hosts (default: any). |

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

This repository's history was reconstructed retroactively from dated snapshots: every commit is one milestone version, tagged `v1.0` through `v4.2`, with rapid patch snapshots folded into their minor line (the per-snapshot detail is preserved in [CHANGELOG.md](CHANGELOG.md), which grows alongside the history commit by commit). The latest tag has a GitHub release with the runnable `fictionpad.html` attached.

## Credits

FictionPad was designed, implemented and documented end to end by Kimi (K3, high effort), an AI coding agent by Moonshot AI, working under the direction of [@Hoborific](https://github.com/Hoborific). That covers the app, the server, the tests, the build tooling, this README, the changelog, and the reconstructed history itself.
