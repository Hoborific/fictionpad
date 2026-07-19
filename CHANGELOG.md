# Changelog

All notable changes to FictionPad, milestone by milestone. Each commit in this
repository is one milestone, tagged `v<version>`; rapid patch snapshots are folded
into their minor line, with the per-snapshot detail kept as subsections.


## v1.0 - Initial Release

FictionPad is a self-contained, single-HTML-file frontend for immersive LLM roleplay and story-writing. It runs straight from `file://` with no build step, talks to any OpenAI-compatible chat-completions endpoint (vLLM, OpenRouter, OpenAI, llama.cpp, koboldcpp, TabbyAPI…) with your own API key, and keeps all data client-side in IndexedDB.

**Added**

- Chat-first roleplay UI: message list, composer, and per-message actions - edit, regenerate, swipe between unlimited alternates, branch, rewind, delete
- Scenario-centric data model: scenarios with backstory, greeting, scenario instructions and lore pieces; separate personas with `{{user}}` macro; multiple chats per scenario
- Lore engine: keyword-triggered lore pieces with pinned flag, weights, linked-piece co-activation boost, per-piece enable and scan depth
- Layered context assembler with explicit per-layer token budgets (system prompt, scenario, persona, lore, memory, history, response-shaping)
- Context Inspector panel showing exactly which lore pieces and memories were injected into the last generation, with token costs
- Auto-memory: summarizes every 30 messages via a configurable auxiliary model; capped store with pinning and FIFO eviction; memory state versioned with the chat (branches fork it, rewinds roll it back)
- Slash commands: `/ooc <text>` for out-of-character directives and `/continue`
- Sampling settings (temperature, top_p, top_k, min_p, repetition penalty), response-length presets, editable platform system prompt, per-chat custom instructions
- JSON export/import of chats and scenarios
- Themes: Dark default plus Catppuccin Mocha / Macchiato / Frappé with selectable accent colors; markdown rendering with highlighted dialogue and per-character speaker name colors
- `server.mjs`: zero-dependency Node ≥18 server that serves the app and proxies LLM calls via `/proxy/<endpoint>` to bypass CORS and mixed-content blocks

