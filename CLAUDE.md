# ChromAI — CLAUDE.md

## Build

```bash
npm install
npm run build    # Vite (sidebar + settings + service worker) + IIFE content script
npm run dev      # Watch mode
```

Output goes to `dist/`. Load `dist/` as an unpacked Chrome extension.

> lemura is installed from local source at `/tmp/lemura-src` (built from `github:rzafiamy/lemura`). The GitHub package ships without `dist/`, so it must be cloned and built separately before `npm install`.

## Architecture

Three isolated Chrome extension contexts communicate via `chrome.runtime` message passing:

```
SIDEBAR (chrome-extension://…/public/sidebar.html)
  └── sidebar.js → agent.js (lemura SessionManager)
        └── tools.js → chrome.tabs.sendMessage(tabId, action)

CONTENT SCRIPT (injected into active tab)
  └── content-script.js — executes DOM actions, returns results

SERVICE WORKER (background/service-worker.js)
  └── opens side panel on icon click; relays TAB_CHANGED events to sidebar
```

The sidebar calls the content script directly (not through the service worker) to minimize latency per tool call. The service worker is intentionally thin.

## Key Files

| File | Role |
|---|---|
| [src/content/content-script.js](src/content/content-script.js) | All DOM actions live here. Handles 11 action types. Built as IIFE. |
| [src/sidebar/tools.js](src/sidebar/tools.js) | lemura `IToolDefinition[]` — each calls `sendToContentScript()` |
| [src/sidebar/agent.js](src/sidebar/agent.js) | Creates `SessionManager` with tools + system prompt |
| [src/sidebar/adapter.js](src/sidebar/adapter.js) | Custom `IProviderAdapter` using browser `fetch()` for OpenAI-compat endpoints |
| [src/sidebar/storage.js](src/sidebar/storage.js) | `chrome.storage.sync` get/set with defaults |
| [public/manifest.json](public/manifest.json) | MV3 manifest — references `public/sidebar.html`, `public/settings.html` |
| [vite.config.js](vite.config.js) | Multi-entry build; `base: './'` for relative asset paths in extension |
| [scripts/build-content.js](scripts/build-content.js) | Builds content script as IIFE; moves HTML from `dist/public/` to `dist/` |

## Build Quirks

**Two-step build** — the main Vite build handles sidebar, settings, and service worker as ESM. A separate Vite invocation in `scripts/build-content.js` builds the content script in IIFE format (Chrome injects content scripts as classic scripts, not modules).

**HTML output location** — Vite outputs HTML to `dist/public/` (mirroring the input path). The build script copies the built HTML files to `dist/` root. The manifest references `public/sidebar.html` so this copy is just for convenience; the actually used file remains at `dist/public/`.

**Node.js polyfills** — lemura imports `child_process` (for MCP stdio) and `crypto`. Both are aliased in `vite.config.js` to stub shims in `src/polyfills/`. `child_process` throws if called; `crypto` delegates to `globalThis.crypto.randomUUID`.

**Asset paths** — `base: './'` in vite.config.js produces relative paths (`../assets/...`) in HTML. These resolve correctly from `dist/public/`.

## Adding a New Tool

1. Add a handler to `src/content/content-script.js` in the `handlers` object
2. Add the `IToolDefinition` to `src/sidebar/tools.js`
3. The tool is automatically available to the agent on next build

## Settings Storage

Settings are stored via `chrome.storage.sync` (syncs across user's Chrome profiles):

| Key | Default | Description |
|---|---|---|
| `baseUrl` | `https://api.openai.com/v1` | OpenAI-compatible endpoint |
| `apiKey` | `''` | API key |
| `model` | `gpt-4o-mini` | Model name |
| `systemPrompt` | `''` | Appended to the default system prompt |

## Common Tasks

**Reload after build:** Go to `chrome://extensions` and click the refresh icon on the ChromAI card, or use the Extensions Reloader extension.

**Debug sidebar:** Right-click inside the sidebar → Inspect. The sidebar is a normal web page at `chrome-extension://<id>/public/sidebar.html`.

**Debug content script:** Open DevTools on the target page → Console. Content script logs appear there (not in the sidebar's DevTools).

**Debug service worker:** Go to `chrome://extensions` → ChromAI → "Service Worker" link → opens a dedicated DevTools.
