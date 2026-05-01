import { SessionManager, OpenAICompatibleAdapter } from 'lemura';
import { browserTools } from './tools.js';

export function createBrowserSession({ settings, onToolCall }) {
  const adapter = new OpenAICompatibleAdapter({
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    defaultModel: settings.model || 'gpt-4o-mini',
    timeout: settings.requestTimeout || 120000,
    retry: { maxRetries: 1, baseDelayMs: 1000 }
  });

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

    // Goal planning: keeps the agent focused on the original task across multi-step loops.
    // Must use 'system_prompt' position — vLLM models reject mid-conversation system messages.
    enableGoalPlanning: true,
    goalInjectionFrequency: 'always',
    goalInjectionPosition: 'system_prompt',

    // Disabled: continuation planning also injects mid-conversation system messages on step exhaustion.
    enableContinuationPlanning: false,

    // Run independent tool calls concurrently when the model issues multiple at once
    parallelToolCalls: true,

    // Allow all tool calls by default — no onAsk handler exists in the extension context
    toolFirewall: { defaultDecision: 'allow', rules: [] },

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
- navigateTo → use freely to open search pages, profiles, or platform URLs.
- scrollAndRead → use after navigating to a feed to load posts.
- highlightElement → show the user what you found.
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
