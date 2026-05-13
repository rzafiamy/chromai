import { SessionManager, OpenAICompatibleAdapter } from 'lemura';
import { browserTools } from './tools.js';
import { showConfirm, showToolActivity, resolveToolActivity, showIterationBadge, showThinkingText, showStopReason, markContinuation, showBlockedBadge } from './ui.js';
import { buildSystemPrompt } from './prompt.js';
import { describeToolCall, highlightOnPage } from './skills.js';

const makeTracer = () => {
  const pending = new Map();
  let iterationDiv = null;
  let lastThinkingDiv = null;

  return (event) => {
    // ── Tool calls ──
    if (event.type === 'tool_call') {
      const div = showToolActivity(event.name, event.input);
      pending.set(event.metadata?.id ?? event.name, div);

    } else if (event.type === 'tool_result') {
      const key = event.metadata?.id ?? event.name;
      resolveToolActivity(pending.get(key));
      pending.delete(key);

    // ── LLM thinking ──
    } else if (event.type === 'thinking') {
      if (event.name === 'llm_call') {
        if (event.status === 'running') {
          iterationDiv = showIterationBadge(event.metadata?.iteration);
          lastThinkingDiv = null;
        } else if (event.status === 'done' && event.output) {
          // Show intermediate reasoning text (only when the LLM emitted text
          // before tool calls or before stopping — helps diagnose premature stops)
          lastThinkingDiv = showThinkingText(event.output);
        }
      } else if (event.name === 'llm_stream_finished') {
        const reason = event.metadata?.finishReason;
        if (reason && reason !== 'tool_call') {
          showStopReason(reason, lastThinkingDiv);
        }
      }

    // ── Planning events ──
    } else if (event.type === 'planning') {
      if (event.name === 'max_steps_reached') {
        showStopReason('max_steps', lastThinkingDiv);
      } else if (event.name === 'continuation_detected') {
        markContinuation(iterationDiv, event.metadata?.action);
      }

    // ── Budget / firewall ──
    } else if (event.type === 'budget' && event.name === 'firewall_blocked') {
      showBlockedBadge(event.metadata?.toolName);
    }
  };
};

const makeFirewall = () => ({
  defaultDecision: 'allow',
  rules: [
    { name: 'fillForm',     decision: 'ask', reason: 'Will fill form fields on the page' },
    { name: 'typeText',     decision: 'ask', reason: 'Will type text into an element on the page' },
    { name: 'pressKey',     decision: 'ask', reason: 'Will press a key on the page' },
    { name: 'clickElement', decision: 'ask', reason: 'Will click an element on the page' },
    { name: 'submitForm',   decision: 'ask', reason: 'Will submit a form on the page' },
    { name: 'navigateTo',   decision: 'ask', reason: 'Will navigate to a new URL on the same site' },
  ],
  onAsk: async (toolName, argsJson) => {
    try {
      const { selector, fields } = JSON.parse(argsJson);
      const target = selector ?? fields?.[0]?.selector;
      if (target) await highlightOnPage(target);
    } catch { /* ignore */ }
    const { description, detail } = describeToolCall(toolName, argsJson);
    return showConfirm({ toolName, description, detail });
  }
});

const makeAdapter = (settings) => {
  const adapter = new OpenAICompatibleAdapter({
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    defaultModel: settings.model || 'gpt-4o-mini',
    timeout: settings.requestTimeout || 120000,
    retry: { maxRetries: 1, baseDelayMs: 1000 }
  });

  if (settings.visionModel) {
    const { visionModel } = settings;
    const origDescribeImage = adapter.describeImage.bind(adapter);
    adapter.describeImage = (req) => origDescribeImage({ ...req, model: visionModel });
    adapter.getModelInfo = () => ({
      supportsVision: true,
      supportsTools: true,
      contextWindow: settings.contextWindow || 16000
    });
  }

  return adapter;
};

export const createAdapter = (settings) => makeAdapter(settings);

export const createBrowserSession = ({ settings }) => new SessionManager({
  adapter: makeAdapter(settings),
  model: settings.model || 'gpt-4o-mini',
  maxTokens: settings.contextWindow || 128000,
  maxIterations: settings.maxIterations,
  maxSteps: settings.maxSteps,
  maxCompletionTokens: settings.maxCompletionTokens,
  tools: browserTools,

  media: { enableTools: true, toolPrefix: 'media_' },

  enableGoalPlanning: settings.enableGoalPlanning,
  goalInjectionFrequency: settings.goalInjectionFrequency,
  goalInjectionPosition: settings.goalInjectionPosition,
  enableContinuationPlanning: settings.enableContinuationPlanning,

  parallelToolCalls: settings.parallelToolCalls,
  toolFirewall: makeFirewall(),
  toolRegistryTimeoutMs: 30000,
  maxTokensPerTool: settings.maxTokensPerTool,

  systemPrompt: buildSystemPrompt(settings.systemPrompt),
  onTrace: makeTracer()
});
