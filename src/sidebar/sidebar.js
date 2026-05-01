import { createBrowserSession } from './agent.js';
import { getSettings } from './storage.js';
import { renderMessage, showTyping, hideTyping, showToolStatus, hideToolStatus } from './ui.js';

let session = null;
let isRunning = false;

async function initSession() {
  const settings = await getSettings();
  if (!settings.apiKey) {
    renderMessage('system', '⚙ No API key configured. Click the settings icon to add your API key.');
    return null;
  }
  session = createBrowserSession({
    settings,
    onToolCall: (toolName) => {
      const label = toolName.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
      showToolStatus(`Running: ${label}…`);
    }
  });
  return session;
}

async function handleSubmit(userText) {
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
    const response = await session.run(userText);
    hideTyping();
    hideToolStatus();
    renderMessage('assistant', typeof response === 'string' ? response : JSON.stringify(response));
  } catch (err) {
    hideTyping();
    hideToolStatus();
    renderMessage('error', `Error: ${err.message}`);
    console.error('[ChromAI]', err);
  } finally {
    isRunning = false;
    document.getElementById('btn-send').disabled = false;
  }
}

async function clearChat() {
  document.getElementById('messages').innerHTML = '';
  session = null;
  await initSession();
}

// Form submit
document.getElementById('input-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('user-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  handleSubmit(text);
});

// Ctrl+Enter or Enter to send, Shift+Enter for newline
document.getElementById('user-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('input-form').dispatchEvent(new Event('submit'));
  }
});

// Auto-resize textarea
document.getElementById('user-input').addEventListener('input', (e) => {
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
});

document.getElementById('btn-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('btn-clear').addEventListener('click', clearChat);

// Re-init context when user switches tabs
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'TAB_CHANGED') {
    // Reset session so the agent context reflects the new page
    session = null;
    getSettings().then(s => {
      if (s.apiKey) {
        session = createBrowserSession({
          settings: s,
          onToolCall: (toolName) => {
            showToolStatus(`Running: ${toolName.replace(/([A-Z])/g, ' $1').trim().toLowerCase()}…`);
          }
        });
      }
    });
  }
});

// Bootstrap
initSession();
