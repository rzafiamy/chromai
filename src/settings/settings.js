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
  document.getElementById('maxCompletionTokens').value = settings.maxCompletionTokens ?? 4096;
  document.getElementById('maxTokensPerTool').value = settings.maxTokensPerTool ?? 4000;
  document.getElementById('contextWindow').value = settings.contextWindow ?? 128000;
  document.getElementById('requestTimeout').value = settings.requestTimeout ?? 120000;
  document.getElementById('visualContext').checked = settings.visualContext ?? false;
  document.getElementById('enableGoalPlanning').checked = settings.enableGoalPlanning ?? true;
  document.getElementById('enableContinuationPlanning').checked = settings.enableContinuationPlanning ?? false;
  document.getElementById('parallelToolCalls').checked = settings.parallelToolCalls ?? true;
  document.getElementById('goalInjectionFrequency').value = settings.goalInjectionFrequency ?? 'always';
  document.getElementById('goalInjectionPosition').value = settings.goalInjectionPosition ?? 'system_prompt';
  document.getElementById('enableGoalVerification').checked = settings.enableGoalVerification ?? false;
  document.getElementById('staticSystemPrompt').checked = settings.staticSystemPrompt ?? false;
});

// ── Microphone permission UI ──
const micStatus = document.getElementById('mic-status');
const btnRequestMic = document.getElementById('btn-request-mic');

const updateMicStatus = (state) => {
  const labels = { granted: '✓ Granted', denied: '✗ Denied', prompt: 'Not yet granted' };
  const classes = { granted: 'granted', denied: 'denied', prompt: 'prompt' };
  micStatus.textContent = labels[state] ?? 'Unknown';
  micStatus.className = `mic-status ${classes[state] ?? ''}`;
  btnRequestMic.classList.toggle('hidden', state === 'granted');
};

if (navigator.permissions) {
  navigator.permissions.query({ name: 'microphone' }).then(result => {
    updateMicStatus(result.state);
    result.addEventListener('change', () => updateMicStatus(result.state));
  }).catch(() => updateMicStatus('prompt'));
} else {
  updateMicStatus('prompt');
}

btnRequestMic.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    updateMicStatus('granted');
  } catch {
    updateMicStatus('denied');
  }
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
    maxCompletionTokens: parseInt(document.getElementById('maxCompletionTokens').value, 10) || 4096,
    maxTokensPerTool: parseInt(document.getElementById('maxTokensPerTool').value, 10) || 4000,
    contextWindow: parseInt(document.getElementById('contextWindow').value, 10) || 128000,
    requestTimeout: parseInt(document.getElementById('requestTimeout').value, 10) || 120000,
    visualContext: document.getElementById('visualContext').checked,
    enableGoalPlanning: document.getElementById('enableGoalPlanning').checked,
    enableContinuationPlanning: document.getElementById('enableContinuationPlanning').checked,
    parallelToolCalls: document.getElementById('parallelToolCalls').checked,
    goalInjectionFrequency: document.getElementById('goalInjectionFrequency').value,
    goalInjectionPosition: document.getElementById('goalInjectionPosition').value,
    enableGoalVerification: document.getElementById('enableGoalVerification').checked,
    staticSystemPrompt: document.getElementById('staticSystemPrompt').checked
  });
  statusMsg.classList.remove('hidden');
  setTimeout(() => statusMsg.classList.add('hidden'), 2500);
});
