import { SessionManager, OpenAICompatibleAdapter } from 'lemura';
import { browserTools } from './tools.js';
import {
  showConfirm,
  showToolActivity,
  resolveToolActivity,
  showIterationBadge,
  showThinkingText,
  showStopReason,
  markContinuation,
  showBlockedBadge,
  showVerificationEvent,
  showGoalVerification,
  showGoalCorrection,
  updateCognitiveStats
} from './ui.js';
import { buildSystemPrompt } from './prompt.js';
import { describeToolCall, highlightOnPage } from './skills.js';

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

export const createBrowserSession = ({ settings }) => {
  let session = null;
  const pending = new Map();
  let iterationDiv = null;
  let lastThinkingDiv = null;

  const refreshStats = () => {
    if (session && session.cognitiveStats) {
      session.cognitiveStats.turns = session.context?.turns?.filter(t => t.role === 'user').length ?? 0;
      session.cognitiveStats.steps = session.stepCounter?.count ?? 0;
      
      // Fallback: estimate tokens if API metadata didn't provide them
      if (session.cognitiveStats.inputTokens === 0 && session.context) {
        const userTurns = session.context.turns?.filter(t => t.role === 'user') ?? [];
        const assistantTurns = session.context.turns?.filter(t => t.role === 'assistant') ?? [];
        
        const estInput = userTurns.reduce((sum, t) => sum + (t.tokenCount ?? 0), 0) + 
                         (session.adapter?.estimateTokens?.(session.context.systemPrompt || '') ?? 0);
        const estOutput = assistantTurns.reduce((sum, t) => sum + (t.tokenCount ?? 0), 0);
        
        session.cognitiveStats.inputTokens = estInput;
        session.cognitiveStats.outputTokens = estOutput;
      }
      
      updateCognitiveStats(session.cognitiveStats);
    }
  };

  const tracer = (event) => {
    // Eagerly check if the user triggered a stop/cancellation request!
    if (session && session.aborted) {
      throw new Error('Agent execution cancelled by user');
    }

    // Always refresh stats in real-time for every single event
    refreshStats();

    // ── Tool calls ──
    if (event.type === 'tool_call') {
      if (session && session.cognitiveStats) {
        session.cognitiveStats.activeToolCalls++;
      }
      refreshStats();
      const div = showToolActivity(event.name, event.input);
      pending.set(event.metadata?.id ?? event.name, div);

    } else if (event.type === 'tool_result') {
      if (session && session.cognitiveStats) {
        session.cognitiveStats.activeToolCalls = Math.max(0, session.cognitiveStats.activeToolCalls - 1);
      }
      refreshStats();
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
          lastThinkingDiv = showThinkingText(event.output);
        }
        
        if (event.status === 'done' && event.metadata?.usage && session && session.cognitiveStats) {
          session.cognitiveStats.inputTokens += event.metadata.usage.promptTokens ?? 0;
          session.cognitiveStats.outputTokens += event.metadata.usage.completionTokens ?? 0;
          refreshStats();
        }
      } else if (event.name === 'llm_stream_finished') {
        const reason = event.metadata?.finishReason;
        if (reason && reason !== 'tool_call' && reason !== 'stop') {
          showStopReason(reason, lastThinkingDiv);
        }
        
        if (event.metadata?.usage && session && session.cognitiveStats) {
          session.cognitiveStats.inputTokens += event.metadata.usage.promptTokens ?? 0;
          session.cognitiveStats.outputTokens += event.metadata.usage.completionTokens ?? 0;
          refreshStats();
        }
      }

    // ── Planning events ──
    } else if (event.type === 'planning') {
      if (event.name === 'max_steps_reached') {
        showStopReason('max_steps', lastThinkingDiv);
      } else if (event.name === 'continuation_detected') {
        markContinuation(iterationDiv, event.metadata?.action);
      } else if (event.name === 'step_retry' || event.name === 'step_failed' || event.name === 'step_skipped') {
        showVerificationEvent(event.name, event.metadata);
      }

    // ── Verification / goal events ──
    } else if (event.type === 'verification') {
      if (event.name === 'goal_verification_result') {
        const achieved = event.metadata?.achieved ?? true;
        showGoalVerification(achieved ? 'achieved' : 'failed', event.metadata?.reason || event.metadata?.missing);
      } else if (event.name === 'goal_correction_start' || event.name === 'goal_correction_done') {
        showGoalCorrection(event.name, event.metadata);
      }

    // ── Error events ──
    } else if (event.type === 'error') {
      if (event.name === 'goal_correction_failed') {
        showGoalCorrection(event.name, event.metadata);
      }

    // ── Budget / firewall ──
    } else if (event.type === 'budget' && event.name === 'firewall_blocked') {
      showBlockedBadge(event.metadata?.toolName);
    }
  };

  session = new SessionManager({
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
    enableGoalVerification: settings.enableGoalVerification,
    staticSystemPrompt: settings.staticSystemPrompt,
    parallelToolCalls: settings.parallelToolCalls,
    toolFirewall: makeFirewall(),
    toolRegistryTimeoutMs: 30000,
    maxTokensPerTool: settings.maxTokensPerTool,
    systemPrompt: buildSystemPrompt(settings.systemPrompt),
    onTrace: tracer
  });

  session.cognitiveStats = {
    turns: 0,
    activeToolCalls: 0,
    steps: 0,
    maxSteps: settings.maxSteps || 30,
    inputTokens: 0,
    outputTokens: 0,
    maxTokens: settings.contextWindow || 16000
  };

  refreshStats();

  return session;
};
