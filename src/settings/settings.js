import { getSettings, saveSettings } from '../sidebar/storage.js';

const form = document.getElementById('settings-form');
const statusMsg = document.getElementById('status-msg');

// Load current settings into the form
getSettings().then(settings => {
  document.getElementById('baseUrl').value = settings.baseUrl || '';
  document.getElementById('apiKey').value = settings.apiKey || '';
  document.getElementById('model').value = settings.model || '';
  document.getElementById('systemPrompt').value = settings.systemPrompt || '';
  document.getElementById('visionModel').value = settings.visionModel || '';
  document.getElementById('asrUrl').value = settings.asrUrl || '';
  document.getElementById('maxIterations').value = settings.maxIterations ?? 15;
  document.getElementById('maxSteps').value = settings.maxSteps ?? 30;
  document.getElementById('contextWindow').value = settings.contextWindow ?? 128000;
  document.getElementById('requestTimeout').value = settings.requestTimeout ?? 120000;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  await saveSettings({
    baseUrl: document.getElementById('baseUrl').value.trim(),
    apiKey: document.getElementById('apiKey').value.trim(),
    model: document.getElementById('model').value.trim(),
    systemPrompt: document.getElementById('systemPrompt').value.trim(),
    visionModel: document.getElementById('visionModel').value.trim(),
    asrUrl: document.getElementById('asrUrl').value.trim(),
    maxIterations: parseInt(document.getElementById('maxIterations').value, 10) || 15,
    maxSteps: parseInt(document.getElementById('maxSteps').value, 10) || 30,
    contextWindow: parseInt(document.getElementById('contextWindow').value, 10) || 128000,
    requestTimeout: parseInt(document.getElementById('requestTimeout').value, 10) || 120000
  });
  statusMsg.classList.remove('hidden');
  setTimeout(() => statusMsg.classList.add('hidden'), 2500);
});
