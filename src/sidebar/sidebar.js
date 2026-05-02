import { createBrowserSession } from './agent.js';
import { getSettings } from './storage.js';
import { renderMessage, showTyping, hideTyping } from './ui.js';
import { capturePageContext } from './tools.js';
import { buildMessageWithContext } from './prompt.js';

let session = null;
let isRunning = false;

const initSession = async () => {
  const settings = await getSettings();
  if (!settings.apiKey) {
    renderMessage('system', '⚙ No API key configured. Click the settings icon to add your API key.');
    return null;
  }
  session = createBrowserSession({ settings });
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
  session = null;
  await initSession();
};

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

chrome.runtime.onMessage.addListener(({ action }) => {
  if (action !== 'TAB_CHANGED') return;
  session = null;
  getSettings().then((s) => {
    if (s.apiKey) session = createBrowserSession({ settings: s });
  });
});

initSession();
