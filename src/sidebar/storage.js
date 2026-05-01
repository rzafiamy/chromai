const DEFAULTS = {
  baseUrl: 'https://edpt-01.makix.fr/v1',
  apiKey: '',
  model: 'Qwen3.5-4B',
  systemPrompt: '',
  maxIterations: 15,
  maxSteps: 30,
  contextWindow: 16000,
  requestTimeout: 120000,
  visionModel: ''
};

export async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(DEFAULTS, resolve);
  });
}

export async function saveSettings(patch) {
  return new Promise(resolve => {
    chrome.storage.sync.set(patch, resolve);
  });
}
