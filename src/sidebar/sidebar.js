import { createBrowserSession } from './agent.js';
import { getSettings } from './storage.js';
import { renderMessage, showTyping, hideTyping, showToast, updateModelBadge } from './ui.js';
import { capturePageContext } from './tools.js';
import { buildMessageWithContext } from './prompt.js';

let session = null;
let isRunning = false;
let currentSettings = null;

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
  if (isRunning || !userText.trim()) return;

  if (!session) {
    session = await initSession();
    if (!session) return;
  }

  isRunning = true;
  document.getElementById('btn-send').disabled = true;
  renderMessage('user', userText);
  showTyping();

  try {
    const ctx = await capturePageContext();
    const message = ctx ? buildMessageWithContext(userText, ctx) : userText;
    // session.run() appends to context.turns — conversation history is preserved
    const response = await session.run(message);
    hideTyping();
    renderMessage('assistant', typeof response === 'string' ? response : JSON.stringify(response));
  } catch (err) {
    hideTyping();
    renderMessage('error', `Error: ${err.message}`);
    console.error('[ChromAI]', err);
  } finally {
    isRunning = false;
    document.getElementById('btn-send').disabled = false;
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

// Welcome chip quick-prompts
document.getElementById('messages').addEventListener('click', (e) => {
  const chip = e.target.closest('.welcome-chip');
  if (!chip) return;
  const prompt = chip.dataset.prompt;
  if (prompt) handleSubmit(prompt);
});

// Tab change: reset session but preserve UI
chrome.runtime.onMessage.addListener(({ action }) => {
  if (action !== 'TAB_CHANGED') return;
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

initSession();
