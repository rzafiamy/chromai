const DEFAULTS = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  systemPrompt: ''
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
