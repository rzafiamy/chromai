import { createBrowserSession, createAdapter } from './agent.js';
import { getSettings, saveHistory, loadHistory, clearHistory } from './storage.js';
import { renderMessage, showTyping, hideTyping, showToast, updateModelBadge, updateAssistantMessage, renderMarkdown, resetCognitiveStats, setSendButtonState, renderWelcome } from './ui.js';
import { capturePageContext, captureViewportBase64, setFocusRegion, getFocusRegion, setOnRegionAutoExpand, setOnAgentPick, isAgentPickActive, sendToContentScript } from './tools.js';
import { buildMessageWithContext } from './prompt.js';
import { prepareContext, resetSessionContext } from './context.js';
import { isAbortError } from './abort.js';
import { getEntries, clearLogs, onLogUpdate, logSystem } from './logger.js';


let session = null;
let isRunning = false;
let currentSettings = null;
let isPickerActive = false;

const initSession = async (restoreHistory = true) => {
  currentSettings = await getSettings();
  if (!currentSettings.apiKey) {
    renderMessage('system', '⚙ No API key configured. Click the settings icon to add your API key.');
    return null;
  }
  session = createBrowserSession({ settings: currentSettings });
  updateModelBadge(currentSettings.model);
  if (restoreHistory) {
    const history = await loadHistory();
    if (history.length > 0) session.loadHistory(history);
  }
  return session;
};

const handleSubmit = async (userText) => {
  if (isRunning) {
    if (session) {
      // Trips the shared abort handle: aborts the in-flight LLM fetch, drops any
      // queued tool calls, and dismisses an open confirmation modal immediately.
      session.abort?.();
      session.aborted = true;
    }
    showToast('Stopping agent...');
    return;
  }

  if (!userText || !userText.trim()) return;

  // "remove", "clear", "deselect", "reset" the region → clear it immediately
  if (getFocusRegion() && /\b(remove|clear|deselect|reset|cancel|delete)\b.*\b(region|selection|focus|frame|zone|area)\b|\b(region|selection|focus|frame|zone|area)\b.*\b(remove|clear|deselect|reset|cancel|delete)\b/i.test(userText)) {
    clearFocusRegion();
    showToast('Focus region cleared');
    return;
  }

  if (!session) {
    session = await initSession();
    if (!session) return;
  }

  // Fresh abort handle for this run (clears any prior cancelled state).
  if (session.resetAbort) session.resetAbort();
  else session.aborted = false;

  isRunning = true;
  setSendButtonState(true);
  
  const userInput = document.getElementById('user-input');
  if (userInput) userInput.disabled = true;

  // Clear any prior unified verifier elements so they don't carry over
  const oldVerifier = document.getElementById('unified-goal-verifier');
  if (oldVerifier) {
    oldVerifier.remove();
  }

  renderMessage('user', userText);
  showTyping();

  try {
    const ctx = await capturePageContext();

    // Enrich with decomposed URL (every turn) + AI page profile (once per
    // session). Non-fatal: enrichment failures must never block the message.
    if (ctx) {
      try {
        const adapter = createAdapter(currentSettings);
        const { urlParts, pageProfile } = await prepareContext(ctx, {
          adapter,
          settings: currentSettings,
          sendToContentScript,
          captureVisual: captureViewportBase64
        });
        ctx.urlParts = urlParts;
        ctx.pageProfile = pageProfile;
      } catch {
        // Best-effort — proceed with the raw context if enrichment fails.
      }
    }

    if (ctx && currentSettings.visualContext) {
      try {
        const adapter = createAdapter(currentSettings);
        const imageBase64 = await captureViewportBase64();
        const result = await adapter.describeImage({
          imageBase64,
          prompt: 'Describe the visual scene of this web page in 2-3 sentences: layout, prominent UI elements, any modals or overlays, and the overall visual state. Be concise.'
        });
        ctx.visualDescription = result.description;
      } catch {
        // Visual context is best-effort — never block the message if it fails
      }
    }

    const message = ctx ? buildMessageWithContext(userText, ctx) : userText;
    
    if (typeof session.stream === 'function') {
      const responseStream = await session.stream(message);

      let assistantMsgEl = null;
      let bodyEl = null;
      let fullText = '';
      const warningRegex = /---\s*(?:⚠️|⚡|🚨|\u26A0\uFE0F)?\s*\*\*Goal Verification Warning\*\*[\s\S]*$/i;

      for await (const chunk of responseStream) {
        if (session.aborted) throw new Error('Agent execution cancelled by user');
        if (!assistantMsgEl) {
          hideTyping(); // Clear typing indicator as soon as the first stream chunk arrives!
          assistantMsgEl = renderMessage('assistant', '');
          bodyEl = assistantMsgEl.querySelector('.msg-body');
        }
        fullText += chunk;
        if (bodyEl) {
          bodyEl.innerHTML = renderMarkdown(fullText.replace(warningRegex, '').trim());
        }
        // Auto scroll
        const container = document.getElementById('messages');
        container.scrollTop = container.scrollHeight;
      }

      if (assistantMsgEl) {
        updateAssistantMessage(assistantMsgEl, fullText);
      }
    } else {
      // session.run() appends to context.turns — conversation history is preserved
      const response = await session.run(message);
      hideTyping();
      renderMessage('assistant', typeof response === 'string' ? response : JSON.stringify(response));
    }
    // Persist turns so history survives sidebar reload
    saveHistory(session.context?.turns ?? []);
  } catch (err) {
    hideTyping();
    if (isAbortError(err)) {
      renderMessage('system', '⏹️ Agent execution stopped.');
    } else {
      renderMessage('error', `Error: ${err.message}`);
      console.error('[ChromAI]', err);
    }
  } finally {
    isRunning = false;
    setSendButtonState(false);
    const userInput = document.getElementById('user-input');
    if (userInput) {
      userInput.disabled = false;
      userInput.focus();
    }
  }
};

const clearChat = async () => {
  document.getElementById('messages').innerHTML = '';
  if (session) {
    try { session.reset(); } catch { /* ignore */ }
  }
  session = null;
  resetSessionContext();
  await clearHistory();
  await initSession(false);
  resetCognitiveStats(currentSettings?.maxSteps || 30, currentSettings?.contextWindow || 16000);
  // Refresh welcome with current tab context
  const tabCtx = await getActiveTabContext();
  renderWelcome(tabCtx);
  showToast('Chat cleared');
  logSystem('Chat cleared — new session started');
};


// ── ASR via Whisper ──
let mediaRecorder = null;
let audioChunks = [];

const startRecording = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.addEventListener('dataavailable', e => audioChunks.push(e.data));
    mediaRecorder.addEventListener('stop', async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      await transcribeAudio(blob);
    });
    mediaRecorder.start();
    document.getElementById('btn-mic').classList.add('recording');
    document.getElementById('btn-mic').title = 'Stop recording';
  } catch (err) {
    showToast('Microphone access denied', 'error');
    console.error('[ChromAI ASR]', err);
  }
};

const stopRecording = () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  document.getElementById('btn-mic').classList.remove('recording');
  document.getElementById('btn-mic').title = 'Voice input (Whisper ASR)';
};

const transcribeAudio = async (blob) => {
  if (!currentSettings?.apiKey) {
    showToast('Configure API key first', 'error');
    return;
  }
  const input = document.getElementById('user-input');
  input.placeholder = 'Transcribing…';
  input.disabled = true;
  try {
    const formData = new FormData();
    formData.append('file', blob, 'audio.webm');
    formData.append('model', 'whisper-large-v3');

    const asrUrl = currentSettings.asrUrl || currentSettings.baseUrl.replace(/\/v1\/?$/, '/v1') + '/audio/transcriptions';
    const resp = await fetch(asrUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${currentSettings.apiKey}` },
      body: formData
    });
    if (!resp.ok) throw new Error(`ASR error ${resp.status}`);
    const { text } = await resp.json();
    if (text?.trim()) {
      input.value = text.trim();
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
      showToast('Transcribed successfully');
    } else {
      showToast('No speech detected', 'error');
    }
  } catch (err) {
    showToast(`ASR failed: ${err.message}`, 'error');
    console.error('[ChromAI ASR]', err);
  } finally {
    input.placeholder = 'Ask about this page…';
    input.disabled = false;
    input.focus();
  }
};

// ── Event listeners ──

document.getElementById('input-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (isRunning) {
    handleSubmit('');
    return;
  }
  const input = document.getElementById('user-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  handleSubmit(text);
});

document.getElementById('user-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('input-form').dispatchEvent(new Event('submit'));
  }
});

document.getElementById('user-input').addEventListener('input', ({ target }) => {
  target.style.height = 'auto';
  target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
});

document.getElementById('btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.getElementById('btn-clear').addEventListener('click', clearChat);

// ── Light / dark theme (Microsoft 365 Fluent) — persisted in chrome.storage.sync ──
const applyTheme = (theme) => {
  document.body.classList.toggle('dark-theme', theme === 'dark');
};
chrome.storage.sync.get({ theme: 'light' }, ({ theme }) => applyTheme(theme));
document.getElementById('btn-theme').addEventListener('click', () => {
  const next = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
  applyTheme(next);
  chrome.storage.sync.set({ theme: next });
});

document.getElementById('btn-mic').addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopRecording();
  } else {
    startRecording();
  }
});

// Welcome chip quick-prompts + Continue button
document.getElementById('messages').addEventListener('click', (e) => {
  const chip = e.target.closest('.welcome-chip');
  if (chip) {
    const prompt = chip.dataset.prompt;
    if (prompt) handleSubmit(prompt);
    return;
  }
  // Continue button — injected by showStopReason in ui.js
  if (e.target.id === 'trace-continue-btn') {
    e.target.closest('.trace-stop')?.remove();
    handleSubmit('Continue from where you left off. Complete the task.');
  }
});

// ── Element picker ──

const updatePickerUI = () => {
  const btn = document.getElementById('btn-pick-region');
  const pill = document.getElementById('focus-region-pill');
  const pillText = document.getElementById('focus-region-text');
  const region = getFocusRegion();

  btn.classList.toggle('picker-active', isPickerActive);
  btn.title = isPickerActive ? 'Cancel region pick (Esc)' : 'Pick focus region';

  if (region) {
    pill.style.display = 'flex';
    pillText.textContent = region;
  } else {
    pill.style.display = 'none';
  }
};

const injectAndSend = async (action, extra = {}) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { action, ...extra });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/content-script.js'] });
    await new Promise(r => setTimeout(r, 150));
    await chrome.tabs.sendMessage(tab.id, { action, ...extra });
  }
};

const startPicker = async () => {
  isPickerActive = true;
  updatePickerUI();
  await injectAndSend('ENTER_PICK_MODE');
};

const cancelPicker = async () => {
  isPickerActive = false;
  updatePickerUI();
  await injectAndSend('EXIT_PICK_MODE');
};

const clearFocusRegion = async () => {
  setFocusRegion(null);
  updatePickerUI();
  await injectAndSend('CLEAR_REGION_HIGHLIGHT').catch(() => {});
};

// The agent asked the user to click an element it could not find
// (askUserToPickElement tool). Reflect picker state in the UI and tell the
// user what to click.
setOnAgentPick((state, lookingFor) => {
  isPickerActive = state === 'start';
  updatePickerUI();
  if (state === 'start') {
    showToast(`👆 The agent needs your help — click on: ${lookingFor}`);
    renderMessage('system', `👆 Please click on the page: ${lookingFor} (Esc to cancel)`);
  }
});

// When a click during an agent run opens a dialog outside the focus region,
// tools.js re-points the region to that dialog. Refresh the pill + highlight here.
setOnRegionAutoExpand((selector) => {
  updatePickerUI();
  showToast(`Focus region followed dialog: ${selector}`);
  injectAndSend('HIGHLIGHT_REGION', { selector }).catch(() => {});
});

document.getElementById('btn-pick-region').addEventListener('click', () => {
  if (isPickerActive) cancelPicker();
  else startPicker();
});

document.getElementById('btn-clear-region').addEventListener('click', clearFocusRegion);

// Tab change: reset session + optionally refresh the welcome screen
chrome.runtime.onMessage.addListener(({ action, selector, tabId }) => {
  if (action === 'REGION_PICKED') {
    // Agent-initiated picks (askUserToPickElement / confirm-modal retarget) are
    // consumed by their own listener in tools.js — don't set the focus region.
    if (isAgentPickActive()) return;
    isPickerActive = false;
    setFocusRegion(selector);
    updatePickerUI();
    showToast(`Focus region: ${selector}`);
    injectAndSend('HIGHLIGHT_REGION', { selector }).catch(() => {});
    return;
  }
  if (action === 'REGION_PICK_CANCELLED') {
    if (isAgentPickActive()) return;
    isPickerActive = false;
    updatePickerUI();
    return;
  }
  if (action !== 'TAB_CHANGED') return;

  // Clear focus region when navigating to a new tab
  setFocusRegion(null);
  updatePickerUI();

  // New tab → new page: drop the cached page profile so the next turn re-classifies.
  resetSessionContext();

  // Start a fresh session for the new tab — history from previous tab is irrelevant
  if (session) {
    try { session.reset(); } catch { /* ignore */ }
    session = null;
  }
  clearHistory();
  getSettings().then(async (s) => {
    currentSettings = s;
    if (s.apiKey) {
      session = createBrowserSession({ settings: s });
      updateModelBadge(s.model);
    }

    // ── Refresh welcome screen on tab switch ──────────────────────────────
    // Only update if:
    //   1. The UI is in empty state (welcome screen is visible)
    //   2. No agentic run is in progress (avoids clobbering an active session)
    const isEmptyState = !!document.querySelector('.welcome-message');
    if (isEmptyState && !isRunning) {
      // Fetch tab context — use the tabId relayed by the service worker so
      // we get the exact tab that just became active, not a stale query result.
      let tabCtx = null;
      try {
        if (tabId != null) {
          const tab = await chrome.tabs.get(tabId);
          tabCtx = { url: tab.url || '', title: tab.title || '' };
        } else {
          tabCtx = await getActiveTabContext();
        }
      } catch { /* non-fatal */ }

      // Wipe and repaint the welcome screen with fresh context
      const messagesContainer = document.getElementById('messages');
      if (messagesContainer) messagesContainer.innerHTML = '';
      renderWelcome(tabCtx);

      logSystem(`Tab changed → ${tabCtx?.url ?? 'unknown'}`);
    }
  });
});


// ── Session Cognitive Stats Toggle ──
const btnCognitiveStats = document.getElementById('btn-cognitive-stats');
const popupCognitiveStats = document.getElementById('cognitive-stats-popup');

if (btnCognitiveStats && popupCognitiveStats) {
  btnCognitiveStats.addEventListener('click', (e) => {
    e.stopPropagation();
    popupCognitiveStats.classList.toggle('hidden');
  });

  // Click outside to close the popup
  document.addEventListener('click', (e) => {
    if (!popupCognitiveStats.classList.contains('hidden') && !popupCognitiveStats.contains(e.target) && e.target !== btnCognitiveStats) {
      popupCognitiveStats.classList.add('hidden');
    }
  });
}

/** Safely query the active tab — returns { url, title } or null. */
const getActiveTabContext = async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return null;
    return { url: tab.url || '', title: tab.title || '' };
  } catch {
    return null;
  }
};

// ── Startup: fetch active tab context then initialise session ──
(async () => {
  const tabCtx = await getActiveTabContext();
  // Paint the contextual welcome screen immediately (before session init)
  // so the user sees domain + time-of-day greeting without waiting.
  const messagesContainer = document.getElementById('messages');
  if (messagesContainer) messagesContainer.innerHTML = '';
  renderWelcome(tabCtx);

  await initSession();
  logSystem(`Session initialized${tabCtx?.url ? ' · ' + tabCtx.url : ''}`);
})();


// ── Log Viewer Panel ──────────────────────────────────────────────────────

const logPanel    = document.getElementById('log-panel');
const logList     = document.getElementById('log-list');
const logCount    = document.getElementById('log-count');
const logFilter   = document.getElementById('log-filter');
const btnLogs     = document.getElementById('btn-logs');

let logPanelOpen = false;
let activeFilter = '';

/** Format timestamp as HH:MM:SS.mmm */
const fmtTime = (ts) => {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
};

/** Truncate a long string for preview */
const trunc = (s, n = 120) => (s && s.length > n) ? s.slice(0, n) + '…' : s;

/** Build a DOM element for a single log entry */
const buildEntryEl = (entry) => {
  const hasDetail = entry.input || entry.output || entry.meta;

  const el = document.createElement('div');
  el.className = 'log-entry';
  el.dataset.id = entry.id;
  el.dataset.type = entry.type;

  const chevronSvg = hasDetail
    ? `<svg class="log-expand-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
         <polyline points="9 18 15 12 9 6"/>
       </svg>`
    : '';

  el.innerHTML = `
    <div class="log-entry-row">
      <span class="log-entry-icon">${entry.icon}</span>
      <div class="log-entry-info">
        <span class="log-entry-label">${entry.label}</span>
        <span class="log-entry-name">${entry.name ?? ''}${entry.status ? ` · ${entry.status}` : ''}</span>
      </div>
      <div class="log-entry-right">
        <span class="log-type-badge ${entry.color}">${entry.type}</span>
        <span class="log-entry-time">${fmtTime(entry.ts)}</span>
        ${chevronSvg}
      </div>
    </div>
    ${hasDetail ? `<div class="log-entry-detail">
      ${entry.input  ? `<div class="log-detail-section"><div class="log-detail-label">Input</div><pre class="log-detail-pre">${escapeLogHtml(trunc(entry.input, 800))}</pre></div>` : ''}
      ${entry.output ? `<div class="log-detail-section"><div class="log-detail-label">Output</div><pre class="log-detail-pre">${escapeLogHtml(trunc(entry.output, 800))}</pre></div>` : ''}
      ${entry.meta   ? `<div class="log-detail-section"><div class="log-detail-label">Metadata</div><pre class="log-detail-pre">${escapeLogHtml(trunc(JSON.stringify(entry.meta, null, 2), 800))}</pre></div>` : ''}
    </div>` : ''}
  `;

  if (hasDetail) {
    el.querySelector('.log-entry-row').addEventListener('click', () => {
      el.classList.toggle('log-entry-expanded');
    });
  }

  return el;
};

const escapeLogHtml = (s) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const updateLogCount = (entries) => {
  if (logCount) logCount.textContent = `${entries.length} event${entries.length !== 1 ? 's' : ''}`;
};

/** Full re-render of the log list (used on open / filter change / clear) */
const renderLogList = () => {
  if (!logList) return;
  const entries = getEntries(activeFilter || null);

  if (entries.length === 0) {
    logList.innerHTML = `
      <div class="log-empty">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
        </svg>
        <span>No log entries yet.<br>Run an agent task to see events here.</span>
      </div>`;
    updateLogCount([]);
    return;
  }

  logList.innerHTML = '';
  entries.forEach(e => logList.appendChild(buildEntryEl(e)));
  updateLogCount(entries);
  logList.scrollTop = logList.scrollHeight;
};

/** Append a single entry live (avoids full re-render during active runs) */
const appendLogEntry = (entry) => {
  if (!logPanelOpen || !logList) return;
  if (activeFilter && entry.type !== activeFilter) return;

  // Remove empty state if present
  const empty = logList.querySelector('.log-empty');
  if (empty) empty.remove();

  logList.appendChild(buildEntryEl(entry));
  updateLogCount(getEntries(activeFilter || null));

  // Auto-scroll only if already near the bottom
  const atBottom = logList.scrollHeight - logList.clientHeight - logList.scrollTop < 80;
  if (atBottom) logList.scrollTop = logList.scrollHeight;
};

/** Toggle log panel open/closed */
const toggleLogPanel = () => {
  logPanelOpen = !logPanelOpen;
  logPanel?.classList.toggle('hidden', !logPanelOpen);
  btnLogs?.classList.toggle('log-active', logPanelOpen);
  if (logPanelOpen) renderLogList();
};

// Register live callback so new events stream in while panel is open
onLogUpdate((entry) => {
  if (!logPanelOpen) return;
  if (entry === null) {
    renderLogList(); // full clear signal
  } else {
    appendLogEntry(entry);
  }
});

// Button wiring
btnLogs?.addEventListener('click', toggleLogPanel);
document.getElementById('log-close')?.addEventListener('click', toggleLogPanel);

document.getElementById('log-clear')?.addEventListener('click', () => {
  clearLogs();
  if (logPanelOpen) renderLogList();
  showToast('Logs cleared');
});

document.getElementById('log-export')?.addEventListener('click', () => {
  const entries = getEntries(activeFilter || null);
  const json = JSON.stringify(entries, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chromai-logs-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${entries.length} entries`);
});

logFilter?.addEventListener('change', () => {
  activeFilter = logFilter.value;
  if (logPanelOpen) renderLogList();
});

