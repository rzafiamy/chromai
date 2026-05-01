import { SessionManager, OpenAICompatibleAdapter } from 'lemura';
import { browserTools } from './tools.js';
import { showConfirm } from './ui.js';

// Highlight an element in the active tab without going through a tool call
async function highlightOnPage(selector) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await chrome.tabs.sendMessage(tab.id, { action: 'HIGHLIGHT_ELEMENT', selector, color: '#6366f1' });
  } catch { /* page may not have content script yet */ }
}

// Human-readable summary of what a tool call is about to do
function describeToolCall(toolName, argsJson) {
  try {
    const args = JSON.parse(argsJson);
    if (toolName === 'fillForm') {
      const fields = (args.fields || []).map(f => `"${f.value}" → ${f.selector}`).join('\n');
      return { description: 'Fill form fields with the values below:', detail: fields };
    }
    if (toolName === 'clickElement') {
      return { description: `Click element: ${args.selector}`, detail: args.selector };
    }
    if (toolName === 'submitForm') {
      return { description: `Submit form: ${args.selector}`, detail: args.selector };
    }
    if (toolName === 'navigateTo') {
      return { description: `Navigate to:`, detail: args.url };
    }
  } catch { /* ignore parse errors */ }
  return { description: toolName, detail: argsJson.slice(0, 120) };
}

export function createBrowserSession({ settings, onToolCall }) {
  const adapter = new OpenAICompatibleAdapter({
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    defaultModel: settings.model || 'gpt-4o-mini',
    timeout: settings.requestTimeout || 120000,
    retry: { maxRetries: 1, baseDelayMs: 1000 }
  });

  // If a separate vision model is configured, wrap the adapter so describeImage uses it.
  if (settings.visionModel) {
    const visionModel = settings.visionModel;
    const origDescribeImage = adapter.describeImage.bind(adapter);
    adapter.describeImage = (req) => origDescribeImage({ ...req, model: visionModel });
    adapter.getModelInfo = () => ({
      supportsVision: true,
      supportsTools: true,
      contextWindow: settings.contextWindow || 16000
    });
  }

  const customSystem = settings.systemPrompt
    ? `\n\n${settings.systemPrompt}`
    : '';

  const session = new SessionManager({
    adapter,
    model: settings.model || 'gpt-4o-mini',
    maxTokens: settings.contextWindow || 128000,
    // Set high enough that the maxSteps forced-conclusion path is never triggered —
    // that path injects a mid-conversation system message which vLLM/Qwen rejects with HTTP 500.
    maxIterations: settings.maxIterations || 20,
    maxSteps: settings.maxSteps || 50,
    maxCompletionTokens: 4096,
    tools: browserTools,

    // Enable MediaBridge built-in tools (media_describe_image, etc.)
    media: { enableTools: true, toolPrefix: 'media_' },

    // Goal planning: keeps the agent focused on the original task across multi-step loops.
    // Must use 'system_prompt' position — vLLM models reject mid-conversation system messages.
    enableGoalPlanning: true,
    goalInjectionFrequency: 'always',
    goalInjectionPosition: 'system_prompt',

    // Disabled: continuation planning also injects mid-conversation system messages on step exhaustion.
    enableContinuationPlanning: false,

    // Run independent tool calls concurrently when the model issues multiple at once
    parallelToolCalls: true,

    toolFirewall: {
      defaultDecision: 'allow',
      rules: [
        // Destructive / mutating actions require user confirmation
        { name: 'fillForm',     decision: 'ask', reason: 'Will fill form fields on the page' },
        { name: 'clickElement', decision: 'ask', reason: 'Will click an element on the page' },
        { name: 'submitForm',   decision: 'ask', reason: 'Will submit a form on the page' },
        { name: 'navigateTo',   decision: 'ask', reason: 'Will navigate to a new URL' },
      ],
      onAsk: async (toolName, argsJson) => {
        // Highlight affected element(s) so user can see what will be acted on
        try {
          const args = JSON.parse(argsJson);
          const selector = args.selector || args.fields?.[0]?.selector;
          if (selector) await highlightOnPage(selector);
        } catch { /* ignore */ }

        const { description, detail } = describeToolCall(toolName, argsJson);
        return showConfirm({ toolName, description, detail });
      }
    },

    // Per-tool execution timeout (ms) — generous for slow pages
    toolRegistryTimeoutMs: 30000,

    // Cap each tool response to avoid flooding the context on large pages
    maxTokensPerTool: 4000,

    systemPrompt: `You are ChromAI, an AI browser copilot embedded in the user's Chrome browser via a sidebar extension.

CRITICAL: You are NOT a chatbot. You are a browser agent. You have tools — USE THEM.
- NEVER ask the user "which platform?" or "can you give me a URL?" — call getPageContent first to see what tab is open, then act.
- NEVER refuse or deflect tasks you can accomplish with tools.
- When in doubt: call a tool. Then call another. Only talk to the user to report results or if you are truly blocked.

## Default behavior for ambiguous requests
1. Call getPageContent immediately to identify the current page (URL + content).
2. If already on the right site, search/scroll there.
3. If on a neutral page (new tab, Google, etc.) and the user wants social media content, navigate to the most likely platform — prefer LinkedIn for professional content, Twitter/X for news/brands, Facebook for community posts.
4. Use scrollAndRead to load infinite-feed content after navigating.

## Tool usage rules
- getPageContent → always your first call to orient yourself.
- getInteractiveElements or getForms → use before fillForm or clickElement to discover selectors and labels.
- analyzePageVisually → use when the page is image-based, canvas-rendered, or text extraction fails; also use to visually identify form fields and their spatial relationship before filling.
- highlightElement → call this BEFORE fillForm/clickElement to show the user what you are about to act on.
- fillForm, clickElement, submitForm, navigateTo → these require user confirmation; the UI will pause and ask.
- scrollAndRead → use after navigating to a feed to load posts.
- Prefer IDs and data-attributes in CSS selectors over positional or class-based selectors.
- After each action, verify the result before continuing.

## Social media search patterns
- Twitter/X search: https://twitter.com/search?q=QUERY&f=live
- LinkedIn search: https://www.linkedin.com/search/results/content/?keywords=QUERY
- Facebook search: https://www.facebook.com/search/posts?q=QUERY

Today's date: ${new Date().toISOString().split('T')[0]}.${customSystem}`,

    onTrace: (event) => {
      if (event.type === 'tool_call' && onToolCall) {
        onToolCall(event.name || 'tool');
      }
    }
  });

  return session;
}
