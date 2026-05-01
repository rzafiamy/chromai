# ChromAI — Browser Copilot

A Chrome extension that opens a right sidebar with an AI chat interface. The agent uses [lemura](https://github.com/rzafiamy/lemura) to run a ReAct loop with browser-specific tools, letting it read, interact with, and extract data from any web page you're viewing.

## Features

- Right sidebar chat panel (Chrome Side Panel API)
- Connects to any OpenAI-compatible endpoint (OpenAI, Groq, Ollama, LM Studio, etc.)
- Agent can read page content, click elements, fill forms, extract tables, scroll, and more
- Visually highlights elements it's working on
- Settings page for endpoint URL, API key, and model selection
- Session resets automatically when you switch tabs

## Browser Tools

| Tool | Description |
|---|---|
| `getPageContent` | Read visible text, title, and URL |
| `getPageMeta` | og:title, description, canonical URL, language |
| `getSelectedText` | User's current text selection |
| `extractLinks` | All links from the page or a CSS-scoped section |
| `extractTable` | Table rows by CSS selector |
| `clickElement` | Click any element by CSS selector |
| `fillForm` | Fill inputs with native events (React/Vue compatible) |
| `submitForm` | Submit a form or click a submit button |
| `scrollPage` | Scroll up/down/to element |
| `highlightElement` | Briefly outline an element in orange |
| `waitForElement` | Wait for async DOM elements to appear |

## Setup

### Prerequisites

- Node.js >= 18
- Chrome or Chromium-based browser

### Build

```bash
npm install
npm run build
```

This produces a `dist/` folder ready to load as an unpacked extension.

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked** and select the `dist/` folder
4. Click the ChromAI icon in the toolbar to open the sidebar

### Configure

Click the **⚙** icon in the sidebar (or right-click the extension icon → Options):

- **Base URL** — your OpenAI-compatible endpoint
- **API Key** — your API key
- **Model** — model name to use (e.g. `gpt-4o-mini`, `llama3`, `gemma2`)

## Compatible Providers

| Provider | Base URL |
|---|---|
| OpenAI | `https://api.openai.com/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| Together AI | `https://api.together.xyz/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Ollama (local) | `http://localhost:11434/v1` |
| LM Studio | `http://localhost:1234/v1` |

## Project Structure

```
chromai/
├── public/                  # Static assets copied to dist/
│   ├── manifest.json        # Chrome MV3 manifest
│   ├── sidebar.html         # Side panel entry
│   ├── sidebar.css
│   ├── settings.html        # Options page
│   ├── settings.css
│   └── icons/
├── src/
│   ├── background/
│   │   └── service-worker.js       # Opens side panel; relays tab events
│   ├── content/
│   │   └── content-script.js       # DOM executor — runs in the active tab
│   ├── sidebar/
│   │   ├── agent.js                # lemura SessionManager factory
│   │   ├── adapter.js              # OpenAI-compatible fetch adapter
│   │   ├── tools.js                # Browser tool definitions
│   │   ├── storage.js              # chrome.storage.sync wrappers
│   │   ├── sidebar.js              # Chat UI + agent wiring
│   │   └── ui.js                   # DOM rendering helpers
│   ├── settings/
│   │   └── settings.js             # Settings page logic
│   └── polyfills/
│       ├── crypto.js               # randomUUID shim for lemura
│       └── child_process.js        # Stub for lemura MCP stdio (unused in browser)
├── scripts/
│   └── build-content.js    # Builds content script as IIFE + moves HTML to dist root
└── vite.config.js
```

## How It Works

1. **User types** a message in the sidebar
2. **lemura SessionManager** starts a ReAct loop, calling the configured LLM
3. The LLM decides which **browser tool** to call
4. The tool sends a message to the **content script** running in the active tab
5. The content script executes the DOM action and returns the result
6. lemura feeds the result back to the LLM and continues until a final answer is produced
7. The answer is rendered in the sidebar chat

## Development

```bash
npm run dev      # Watch mode — rebuilds on file changes
npm run build    # Production build
```

After each build, reload the extension at `chrome://extensions` (click the refresh icon on the ChromAI card).

## Permissions

| Permission | Reason |
|---|---|
| `sidePanel` | Display the sidebar UI |
| `storage` | Save settings (API key, endpoint, model) |
| `activeTab` | Access the current tab's URL and ID |
| `scripting` | Fallback script injection |
| `tabs` | Listen for tab changes to reset agent context |
| `<all_urls>` | Allow content script on any page |

## License

MIT
