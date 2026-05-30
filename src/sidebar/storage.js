const DEFAULTS = {
  baseUrl: 'https://edpt-01.makix.fr/v1',
  apiKey: '',
  model: 'Qwen3.5-4B',
  systemPrompt: '',
  maxIterations: 15,
  maxSteps: 30,
  maxCompletionTokens: 4096,
  contextWindow: 16000,
  requestTimeout: 120000,
  visionModel: '',
  asrUrl: '',
  visualContext: false,
  enableGoalPlanning: true,
  goalInjectionFrequency: 'always',
  goalInjectionPosition: 'system_prompt',
  enableContinuationPlanning: false,
  parallelToolCalls: true,
  maxTokensPerTool: 4000,
  staticSystemPrompt: false,
  enableGoalVerification: false,
  temperature: 0.0,
  toolRegistryTimeoutMs: 30000,
  maxRetries: 1,
  baseDelayMs: 1000
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

const HISTORY_KEY = 'chromai_chat_history';
const MAX_HISTORY_TURNS = 40;

export async function saveHistory(turns) {
  // Persist only role + content (skip internal lemura metadata)
  const serializable = turns
    .filter(t => t.role === 'user' || t.role === 'assistant')
    .slice(-MAX_HISTORY_TURNS)
    .map(t => ({ role: t.role, content: t.content }));
  return new Promise(resolve => {
    chrome.storage.session.set({ [HISTORY_KEY]: serializable }, resolve);
  });
}

export async function loadHistory() {
  return new Promise(resolve => {
    chrome.storage.session.get({ [HISTORY_KEY]: [] }, (r) => resolve(r[HISTORY_KEY]));
  });
}

export async function clearHistory() {
  return new Promise(resolve => {
    chrome.storage.session.remove(HISTORY_KEY, resolve);
  });
}
