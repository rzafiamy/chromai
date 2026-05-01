import { getSettings, saveSettings } from '../sidebar/storage.js';

const form = document.getElementById('settings-form');
const statusMsg = document.getElementById('status-msg');

// Load current settings into the form
getSettings().then(settings => {
  document.getElementById('baseUrl').value = settings.baseUrl || '';
  document.getElementById('apiKey').value = settings.apiKey || '';
  document.getElementById('model').value = settings.model || '';
  document.getElementById('systemPrompt').value = settings.systemPrompt || '';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  await saveSettings({
    baseUrl: document.getElementById('baseUrl').value.trim(),
    apiKey: document.getElementById('apiKey').value.trim(),
    model: document.getElementById('model').value.trim(),
    systemPrompt: document.getElementById('systemPrompt').value.trim()
  });
  statusMsg.classList.remove('hidden');
  setTimeout(() => statusMsg.classList.add('hidden'), 2500);
});
