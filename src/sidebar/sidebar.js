import { createBrowserSession, createAdapter } from './agent.js';
import { getSettings } from './storage.js';
import { renderMessage, showTyping, hideTyping, showToast, updateModelBadge, updateAssistantMessage, renderMarkdown, resetCognitiveStats, setSendButtonState } from './ui.js';
import { capturePageContext, captureViewportBase64, setFocusRegion, getFocusRegion } from './tools.js';
import { buildMessageWithContext } from './prompt.js';
import { isAbortError } from './abort.js';

let session = null;
let isRunning = false;
let currentSettings = null;
let isPickerActive = false;

const initSession = async () => {
  currentSettings = await getSettings();
  if (!currentSettings.apiKey) {
    renderMessage('system', '⚙ No API key configured. Click the settings icon to add your API key.');
    return null;
  }
  // Reuse existing session if settings haven't changed (preserves conversation history)
  session = createBrowserSession({ settings: currentSettings });
  updateModelBadge(currentSettings.model);
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
  // Reset session so next message starts fresh
  if (session) {
    try { session.reset(); } catch { /* ignore */ }
  }
  session = null;
  await initSession();
  resetCognitiveStats(currentSettings?.maxSteps || 30, currentSettings?.contextWindow || 16000);
  showToast('Chat cleared');
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

document.getElementById('btn-pick-region').addEventListener('click', () => {
  if (isPickerActive) cancelPicker();
  else startPicker();
});

document.getElementById('btn-clear-region').addEventListener('click', clearFocusRegion);

// Tab change: reset session but preserve UI
chrome.runtime.onMessage.addListener(({ action, selector }) => {
  if (action === 'REGION_PICKED') {
    isPickerActive = false;
    setFocusRegion(selector);
    updatePickerUI();
    showToast(`Focus region: ${selector}`);
    injectAndSend('HIGHLIGHT_REGION', { selector }).catch(() => {});
    return;
  }
  if (action === 'REGION_PICK_CANCELLED') {
    isPickerActive = false;
    updatePickerUI();
    return;
  }
  if (action !== 'TAB_CHANGED') return;
  // Clear focus region when navigating to a new tab
  setFocusRegion(null);
  updatePickerUI();
  // Start a fresh session for the new tab — history from previous tab is irrelevant
  if (session) {
    try { session.reset(); } catch { /* ignore */ }
    session = null;
  }
  getSettings().then((s) => {
    currentSettings = s;
    if (s.apiKey) {
      session = createBrowserSession({ settings: s });
      updateModelBadge(s.model);
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

initSession();
