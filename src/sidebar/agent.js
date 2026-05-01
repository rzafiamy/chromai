import { SessionManager, OpenAICompatibleAdapter } from 'lemura';
import { browserTools } from './tools.js';

export function createBrowserSession({ settings, onToolCall }) {
  const adapter = new OpenAICompatibleAdapter({
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    defaultModel: settings.model || 'gpt-4o-mini'
  });

  const customSystem = settings.systemPrompt
    ? `\n\n${settings.systemPrompt}`
    : '';

  const session = new SessionManager({
    adapter,
    model: settings.model || 'gpt-4o-mini',
    maxTokens: 32000,
    maxIterations: 15,
    maxSteps: 30,
    maxCompletionTokens: 4096,
    tools: browserTools,
    systemPrompt: `You are ChromAI, an AI browser copilot running inside the user's Chrome browser.
You have access to tools that let you read, interact with, and extract data from the current web page.

When asked to perform actions:
1. Use getPageContent first to understand the page structure.
2. Use specific tools to interact based on what you find.
3. After each action, verify the result before continuing.
4. Use highlightElement to visually show the user elements you are working with.
5. Prefer IDs and data-attributes in CSS selectors over positional or class-based selectors.

Be concise in your responses. Focus on the task. Today's date: ${new Date().toISOString().split('T')[0]}.${customSystem}`,

    onTrace: (event) => {
      if (event.type === 'tool_call_start' && onToolCall) {
        onToolCall(event.toolName || event.tool?.name || 'tool');
      }
    }
  });

  return session;
}
