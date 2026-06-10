---
! In this file, you have to describe how the system works in details.
Rules is simple, one row per concept, as following syntax. Description should not be long but clear and complete. Ensure spacing exists between each row.

"""
**[Concept Name]**		[Description]
"""
---

**[ChromAI]**		MV3 Chrome extension ("ChromAI - Browser Copilot") that embeds an agentic AI copilot in the browser side panel; it reads, understands, and interacts with the active tab's page through an LLM agent driving DOM tools.

**[Architecture]**		Three isolated extension contexts communicate over chrome.runtime/chrome.tabs message passing: the Sidebar (agent brain + chat UI), the Content Script (DOM execution layer injected in the active tab), and a thin Service Worker (panel opening + tab-change relay). The sidebar messages the content script directly to minimize per-tool latency.

**[Sidebar]**		Side-panel page (public/sidebar.html + src/sidebar/*) hosting the chat UI, the lemura agent session, settings access, voice input, log viewer, and the focus-region picker controls. Opened via the toolbar icon.

**[Content Script]**		src/content/content-script.js, injected on all URLs at document_idle (and re-injected on demand if missing). Exposes ~24 action handlers (GET_PAGE_CONTENT, CLICK_ELEMENT, FILL_FORM, TYPE_TEXT, WAIT_FOR_IDLE, READ_THREAD, …) dispatched by an {action, ...params} message listener that replies {success, data|error}.

**[Service Worker]**		src/background/service-worker.js. Opens the side panel on icon click and broadcasts TAB_CHANGED (on tab activation and on page-load completion of the active tab) so the sidebar can reset its session and refresh the welcome screen.

**[Agent Session]**		createBrowserSession() (src/sidebar/agent.js) builds a lemura SessionManager with the browser tools, a tool firewall, goal planning/verification options, MCP servers, and an onTrace callback that feeds the UI trace and the logger. Settings control model, temperature (default 0), maxIterations/maxSteps, context window, and parallel tool calls.

**[Provider Adapter]**		lemura's OpenAICompatibleAdapter pointed at any OpenAI-compatible /chat/completions endpoint via browser fetch() (default baseUrl https://edpt-01.makix.fr/v1, default model Qwen3.5-4B). An optional visionModel setting redirects describeImage() calls to a separate vision-capable model. src/sidebar/adapter.js holds a legacy hand-rolled equivalent adapter.

**[Lemura Rebranding]**		agent.js monkey-patches lemura so all internal planning scaffolding uses <chromai:*> XML tags instead of <lemura:*> (GoalInjector block, system prompt, messages), and strips the injected [PAGE CONTEXT] block from the goal statement during mini-planning so goals stay clean.

**[Browser Tools]**		src/sidebar/tools.js defines ~25 lemura IToolDefinitions. Read tools: getPageContent, getPageMeta, getSelectedText, extractLinks, extractTable, getInteractiveElements, getForms, classifyPage, searchOnPage, readThread, scrollAndRead. Action tools: clickElement, fillForm, submitForm, typeText, pressKey, scrollPage, navigateTo, writeToRegion, dismissOverlay, clickAtCoordinates, highlightElement. Wait tools: waitForElement, waitForIdle. Vision tools: analyzePageVisually, captureRegion, ocrRegion, getLabeledScreenshot. Discovery: findActionButton, findCommentBox.

**[Tool Dispatch]**		sendToContentScript() queries the active tab, sends the action message, and on "receiving end does not exist" errors injects the content script via chrome.scripting.executeScript and retries once. Every call checks the abort handle first and races against Stop.

**[Page Context Injection]**		Before each user message, capturePageContext() pulls a GET_PAGE_CONTEXT snapshot (URL, title, DOM landmark summary, up to 40 interactive elements with stable selectors, text excerpt) and buildMessageWithContext() prepends it as a [PAGE CONTEXT]…[END PAGE CONTEXT] block the agent must never mention to the user.

**[Context Enrichment]**		src/sidebar/context.js enriches the raw context each turn: decomposeUrl() splits the URL into registrable domain, subdomain, path segments, and query params (pure string work, every turn); a Page Profile is computed once per session and cached until tab change or chat clear.

**[Page Profile]**		One-time-per-session AI classification: the heuristic CLASSIFY_PAGE result (URL/DOM-based type + feature flags) plus URL parts, title, landmarks, and a text excerpt are sent to the model, which returns compact JSON {kind, interface, primaryContent, suggestedApproach}. Run in parallel with a Visual Layout pass; failures are non-fatal and cached as null to avoid retries.

**[Visual Layout Pass]**		Once per session, a viewport screenshot is sent to the vision model for a 3-5 sentence prose description of the spatial layout (search box, forms, composer, nav, modals) so the agent starts with a human-like glance at the page.

**[System Prompt]**		src/sidebar/prompt.js. Enforces conversational prose output (no headers/JSON/code fences in answers), a three-lane intent classification (GENERAL QUESTION = answer from knowledge, PAGE QUESTION = read-only tools, ACTION = interaction tools), "act, don't announce" (emit tool calls instead of narrating), SPA strategies (findActionButton over hand-crafted selectors), an anti-hallucination protocol for driving AI chat sites (type → submit → waitForIdle → read the actual response), and social-media search URL patterns. User systemPrompt setting is appended.

**[Tool Firewall]**		A lemura toolFirewall with defaultDecision allow; fillForm, typeText, pressKey, clickElement, submitForm, and navigateTo are set to "ask". onAsk highlights the target element(s) in red on the page, then raises an abort-aware confirmation modal (Enter confirms, Escape cancels, Stop denies instantly) with a warning when the target element could not be located.

**[Confirm Highlight]**		Content-script overlays (CONFIRM_HIGHLIGHT/CLEAR_CONFIRM_HIGHLIGHT): a persistent red pulsing border + selector badge over every element a pending action will touch, scrolled into view, repositioned on scroll/resize, cleared once the modal settles — so the user never approves blind.

**[Focus Region]**		A user-pinned CSS selector (module state in tools.js) that scopes the agent's world: content-reading tools and the page context are limited to that subtree, screenshots are cropped to its rect, and action tools resolve selectors inside the region first with whole-page fallback (resolveActionTarget) so portaled dialogs still work.

**[Element Picker]**		Inspector mode (ENTER_PICK_MODE): crosshair cursor with a live indigo overlay + selector label following the hovered element; click picks it and sends REGION_PICKED back to the sidebar, Escape cancels. The picked selector becomes the focus region, shown in a dismissible pill and highlighted on the page with a persistent green overlay.

**[Region Auto-Expand]**		When a click opens a new dialog ([role=dialog], aria-modal, dialog[open]) outside the active focus region, the click handlers detect it, return its selector, and tools.js re-points the focus region to the dialog; the sidebar refreshes the pill, toasts, and re-highlights so the agent keeps acting inside the modal.

**[Abort System]**		src/sidebar/abort.js. lemura exposes no abort API, so cancellation is cooperative: one AbortHandle per run is shared by the wrapped adapter (fetch AbortSignal + promise race), every tool execute(), the tracer callback, and the confirm modal. Pressing the send/stop button mid-run trips the handle, aborting the in-flight LLM call, dropping queued tool calls, and dismissing any open modal.

**[Chat Flow]**		handleSubmit() (sidebar.js): capture + enrich page context, build the contextualized message, then session.stream() — chunks are rendered live as markdown with goal-verification warning blocks stripped — falling back to session.run(). Turns are persisted after each exchange; errors and user aborts render as system/error messages.

**[Chat History]**		chrome.storage.session keeps the last 40 user/assistant turns (role + content only); restored into the session on sidebar reload, cleared on tab change or Clear chat.

**[Tab Change Handling]**		On TAB_CHANGED the sidebar clears the focus region, drops the cached page profile, resets and recreates the session, clears history, and — if the welcome screen is showing and no run is active — repaints the welcome with the new tab's context.

**[Navigation Guard]**		navigateTo refuses to leave the current origin: navigation to a different origin throws before chrome.tabs.update. Same-origin navigations wait for tab status complete (15s cap) plus a 1.2s hydration grace period, then return fresh page content.

**[Network Tracker]**		The content script monkey-patches window.fetch and XMLHttpRequest to count in-flight requests (window.__chromaiNetworkTracker), installed once even across re-injections.

**[WAIT_FOR_IDLE]**		Resolves when the network is quiet (0 in-flight XHR/fetch) AND the DOM has stopped mutating for settleMs (default 1500ms), with an optional waitForSelector precondition and a hard timeout (default 30s). The primary anti-stale-read primitive after AI-chat submissions, searches, and SPA loads.

**[Auto-Wait Heuristic]**		clickElement auto-runs waitForIdle when the selector looks like a send/submit/search control (regex on selector text, EN+FR), and pressKey auto-waits after a bare Enter — so the agent reads settled content without being told to.

**[Goal Re-Planning]**		createBrowserSession() wraps session.stream()/run() to null the GoalInjector before each run — lemura only creates it on a session's first message, so without this every later message would execute under the first message's stale (often completed) goal block, causing the agent to drift. Default goalInjectionPosition is 'pre_turn' so the goal block lands at the end of the message list, where small models attend best.

**[Already-Sent Guard]**		Anti-double-submit signals: TYPE_TEXT returns autoSubmitted: true (with a hint) when the field is empty right after typing (the page auto-sent the text), and PRESS_KEY skips a bare Enter on an empty composer, returning skipped: true plus a page snapshot. The system prompt tells the agent these mean "already sent — read the response, don't submit again".

**[Stable Selector Builder]**		buildSelector() prefers handles that survive SPA re-renders: unique id → data-testid/data-cy/data-control-name → name attr → aria-label (optionally role-scoped) → ancestor path of stable class tokens + nth-of-type, validated for uniqueness at each step. Framework-generated class tokens (css-, sc-, MuiBox, 6+ char hashes, …) are never used as anchors.

**[Accessible Name]**		accessibleName() resolves an element's label roughly per the ARIA accname algorithm: aria-label → aria-labelledby → associated/wrapping <label> → title/placeholder → child img alt → trimmed text content, capped at 100 chars. Shared by all discovery tools so the agent reasons over consistent labels.

**[Shadow DOM Traversal]**		querySelectorDeep/querySelectorAllDeep recursively pierce shadow roots, so interactive elements and dialogs rendered inside Shadow DOM (LinkedIn, Facebook web components) remain findable.

**[Synthetic Interaction]**		CLICK_ELEMENT fires a full pointerover→mouseover→pointerdown→mousedown→pointerup→mouseup→click sequence at the element center so React/Vue synthetic handlers fire; TYPE_TEXT types char-by-char with keydown/input/keyup and uses the native value setter from the element prototype so framework state updates; FILL_FORM and clears use the same setter + input/change events; contenteditables go through execCommand('insertText') with manual-event fallback.

**[WRITE_TO_REGION]**		Robust rich-editor write used when a focus region is active: locate the editable in the region (contenteditable → textarea/input), click+focus to activate (Lexical/ProseMirror), clear, then try in order: synthetic clipboard paste → execCommand insertText → direct value/innerText assignment with manual events; returns the method used and a preview.

**[SUBMIT_FORM Strategy]**		Three escalating methods: click the form's own [type=submit] button (or requestSubmit/submit), else click a visible nearby Send/Submit-labeled button (EN+FR), else dispatch an Enter keydown sequence on the element (the SPA chat pattern).

**[FIND_ACTION_BUTTON]**		Fuzzy, ranked lookup of clickable controls by visible text/accessible name (exact > prefix > substring > word hits, slight on-screen bonus). The agent's prescribed way to click on SPAs with hashed class names; returns stable selectors for the top candidates.

**[FIND_COMMENT_BOX]**		Locates the comment/reply input via an ordered cascade of placeholder/aria-label/role=textbox patterns (EN+FR) and comment-form containers, returning its selector, type, and placeholder for subsequent typing.

**[READ_THREAD]**		Reads a discussion thread: clicks "load more"-style buttons (given selector or auto-detected by text, EN+FR), then extracts up to maxComments comment-like elements with author, time, and text.

**[CLASSIFY_PAGE]**		Deterministic page-type heuristic from URL patterns and DOM landmarks (login, search_results, video, social_feed/post, product, article, documentation, form, generic) plus feature flags (comments, pagination, infinite_scroll, search_box, forms, video_player). Feeds the AI Page Profile; the agent rarely calls it directly.

**[DISMISS_OVERLAY]**		Auto-dismisses cookie/GDPR banners and modal popups by clicking up to 3 visible buttons matched by accept/close text (EN+FR) or consent-container selectors.

**[Vision Tools]**		analyzePageVisually (full viewport or focus-region crop → vision model description/OCR), captureRegion (screenshot a specific element and analyze it), ocrRegion (verbatim transcription of image-rendered text). Screenshots use chrome.tabs.captureVisibleTab (sidebar-only API) and are cropped via GET_ELEMENT_RECT + OffscreenCanvas.

**[Labeled Screenshot]**		getLabeledScreenshot implements Set-of-Marks: GET_LABELED_ELEMENTS returns visible interactive elements with rects, the sidebar draws numbered indigo boxes onto the screenshot with OffscreenCanvas, sends the annotated image to the vision model, and returns the analysis plus a number→{selector,label,cx,cy} lookup for clickAtCoordinates.

**[clickAtCoordinates]**		Fires the full pointer/mouse sequence at an exact (x,y) viewport position via elementFromPoint — for canvas UIs, transformed containers, and elements with no reliable selector; also detects newly-opened dialogs for region auto-expand.

**[Voice Input]**		Mic button records audio (MediaRecorder, webm), posts it to an OpenAI-compatible /audio/transcriptions endpoint (whisper-large-v3; asrUrl setting or derived from baseUrl), and drops the transcript into the input box. Settings page surfaces microphone permission state with a request button.

**[Welcome Screen]**		Empty-session screen with logo, time-of-day greeting, active-tab domain/title line, debug strip (domain · weekday/time · URL), and quick-prompt chips. Chips are domain-aware (GitHub, YouTube, X, LinkedIn, Notion, StackOverflow, Reddit, search engines, docs) with generic fallbacks; clicking a chip submits its prompt. Repainted on tab switch when idle.

**[Trace UI]**		The tracer renders the agent run live in the chat: per-tool activity rows with spinner→checkmark, iteration ("Step N") badges, truncated/expandable LLM thinking text, stop-reason banners (stop/max_tokens/max_steps/max_iterations) with a Continue button that resumes the task, continuation badges, firewall-blocked badges, and step retry/fail/skip notices.

**[Goal Verification UI]**		A collapsible "Goal Verification Status" panel that tracks lemura verification events: achieved/failed verdicts with reasons, and the correction loop lifecycle (correcting → verifying → failed) with colored status badges.

**[Cognitive Stats]**		Per-session live stats popup: user turns, active tool calls, steps used vs maxSteps, estimated input/output tokens, and a context-budget percentage bar; refreshed on every tracer event from session context turn token counts.

**[Agentic Logger]**		src/sidebar/logger.js — in-memory ring buffer (500 entries) of every tracer event (tool_call, tool_result, thinking, planning, verification, error, budget, system) with typed icons and labels. The sidebar log panel renders it with live streaming append, type filter, expandable input/output/metadata details, clear, and JSON export.

**[Settings]**		Stored in chrome.storage.sync (syncs across the Chrome profile). Keys: baseUrl, apiKey, model, visionModel, asrUrl, systemPrompt, temperature, maxIterations/maxSteps/maxCompletionTokens/maxTokensPerTool, contextWindow, requestTimeout, retry tuning, visualContext, goal planning/injection/verification/continuation flags, parallelToolCalls, staticSystemPrompt, toolRegistryTimeoutMs, mcpServers, theme.

**[Settings Page]**		Options page (opened in a tab) with section navigation; loads/saves all settings, manages microphone permission, and edits MCP server cards (name, HTTP-POST or SSE transport, endpoint URL, JSON headers, enabled toggle, comma-separated disabled tools).

**[MCP Integration]**		Enabled MCP servers are passed to the lemura SessionManager; after mcpReady, per-server disabledTools are unregistered from the tool registry. MCP only supplements browsing tasks — the current tab remains the primary surface.

**[Visual Context Option]**		Optional per-message enrichment (visualContext setting): every turn, a viewport screenshot is described by the vision model in 2-3 sentences and injected as a "Visual Scene" section in the page context. Best-effort, never blocks the message.

**[Markdown Renderer]**		Hand-rolled regex renderer in ui.js: fenced code blocks with copy buttons, inline code, headings, bold/italic/strikethrough, images, links, ordered/unordered lists, GFM tables with alignment, blockquotes, and horizontal rules; all interpolated content is HTML-escaped.

**[Theme]**		Light/dark (Microsoft 365 Fluent-styled) toggle in the sidebar header, persisted under the theme key in chrome.storage.sync.

**[Build System]**		Two-step Vite build (npm run build): main ESM build for sidebar, settings, and service worker, then scripts/build-content.js builds the content script as an IIFE (Chrome injects content scripts as classic scripts) and copies built HTML from dist/public/ to dist/. base:'./' yields relative asset paths; dist/ is loaded as the unpacked extension.

**[Node Polyfills]**		lemura imports child_process (MCP stdio) and crypto; vite.config.js aliases them to stubs in src/polyfills/ — child_process throws if used, crypto delegates to globalThis.crypto.randomUUID.

**[Permissions]**		Manifest requests sidePanel, storage, activeTab, scripting, tabs, microphone, and <all_urls> host permissions; content script runs on all URLs, top frame only.

