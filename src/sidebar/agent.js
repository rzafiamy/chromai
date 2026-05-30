import { SessionManager, OpenAICompatibleAdapter, GoalInjector } from 'lemura';
import { browserTools } from './tools.js';

// Monkey-patch Lemura classes to use <chromai:> XML layout tags instead of <lemura:> tags
if (GoalInjector && GoalInjector.prototype) {
  GoalInjector.prototype.getFormattedBlock = function () {
    const { statement, successCriteria, decomposition, completedSubGoals = [] } = this.goal;
    const pending = decomposition.filter((sg) => !completedSubGoals.includes(sg));
    const completed = decomposition.filter((sg) => completedSubGoals.includes(sg));
    let block = `<chromai:goal>
<chromai:statement>${statement}</chromai:statement>
`;
    if (successCriteria.length > 0) {
      block += `<chromai:criteria>
${successCriteria.map((c) => `- ${c}`).join("\n")}
</chromai:criteria>
`;
    }
    if (pending.length > 0) {
      block += `<chromai:subgoals status="pending">
${pending.map((sg) => `- ${sg}`).join("\n")}
</chromai:subgoals>
`;
    }
    if (completed.length > 0) {
      block += `<chromai:subgoals status="done">
${completed.map((sg) => `- \u2705 ${sg}`).join("\n")}
</chromai:subgoals>
`;
    }
    block += "</chromai:goal>";
    return block;
  };
}

if (SessionManager && SessionManager.prototype) {
  const origRunMiniPlanningStep = SessionManager.prototype._runMiniPlanningStep;
  SessionManager.prototype._runMiniPlanningStep = function (userMessage) {
    let cleanGoal = userMessage;
    if (typeof userMessage === 'string') {
      if (userMessage.includes('[PAGE CONTEXT') && userMessage.includes('[END PAGE CONTEXT]')) {
        // Extract user intent
        const userText = userMessage.split('[END PAGE CONTEXT]').pop().trim();
        
        // Extract Title if present to give page context without the DOM noise
        const titleMatch = userMessage.match(/Title:\s*([^\n]+)/);
        if (titleMatch && titleMatch[1]) {
          cleanGoal = `"${userText}" on the page titled "${titleMatch[1].trim()}"`;
        } else {
          cleanGoal = userText;
        }
      }
    }
    
    if (this.goalInjector && cleanGoal !== userMessage) {
      this.goalInjector.goal.statement = cleanGoal;
    }
    
    return origRunMiniPlanningStep.call(this, cleanGoal);
  };

  const origBuildSystemPrompt = SessionManager.prototype.buildSystemPrompt;
  SessionManager.prototype.buildSystemPrompt = function (...args) {
    const res = origBuildSystemPrompt.apply(this, args);
    return res ? res.replace(/<lemura:/g, '<chromai:').replace(/<\/lemura:/g, '</chromai:') : res;
  };

  const origBuildMessages = SessionManager.prototype.buildMessages;
  SessionManager.prototype.buildMessages = function (...args) {
    const messages = origBuildMessages.apply(this, args);
    if (messages && Array.isArray(messages)) {
      return messages.map(msg => {
        if (typeof msg.content === 'string') {
          return {
            ...msg,
            content: msg.content.replace(/<lemura:/g, '<chromai:').replace(/<\/lemura:/g, '</chromai:')
          };
        }
        return msg;
      });
    }
    return messages;
  };
}
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
import { describeToolCall, selectorsForToolCall, showConfirmHighlight, clearConfirmHighlight } from './skills.js';
import { AbortHandle, AbortError } from './abort.js';
import { setAbortHandle } from './tools.js';

const makeFirewall = (getHandle) => ({
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
    const abortHandle = getHandle();
    // If the user already pressed Stop, never raise a modal — deny straight away.
    if (abortHandle.aborted) return false;

    // Mark the exact element(s) this action will touch with a persistent red,
    // pulsing border and scroll the first one into view — so the user can SEE
    // what they're approving instead of confirming blind. Stays up for the whole
    // decision; cleared once the modal settles (confirm / cancel / Stop).
    const selectors = selectorsForToolCall(toolName, argsJson);
    const highlighted = await showConfirmHighlight(selectors);

    const { description, detail } = describeToolCall(toolName, argsJson);
    try {
      // showConfirm resolves false the instant Stop is pressed (abort-aware modal).
      return await showConfirm({
        toolName,
        description,
        detail,
        // Warn the user if we couldn't locate the target so they don't approve blind.
        notFound: selectors.length > 0 && highlighted === 0,
        abortHandle: getHandle()
      });
    } finally {
      await clearConfirmHighlight();
    }
  }
});

// lemura's adapter takes no AbortSignal. Wrap complete()/stream() so that a press
// of Stop (a) aborts the in-flight fetch via the signal, and (b) immediately
// rejects the awaited promise instead of waiting for the network round-trip.
const wrapAdapterForAbort = (adapter, getHandle) => {
  const origComplete = adapter.complete?.bind(adapter);
  const origStream = adapter.stream?.bind(adapter);

  if (origComplete) {
    adapter.complete = (request) => {
      const handle = getHandle();
      handle?.throwIfAborted();
      const withSignal = handle ? { ...request, signal: handle.signal } : request;
      const call = origComplete(withSignal);
      return handle ? handle.race(call) : call;
    };
  }

  if (origStream) {
    adapter.stream = async function* (request) {
      const handle = getHandle();
      handle?.throwIfAborted();
      const withSignal = handle ? { ...request, signal: handle.signal } : request;
      for await (const chunk of origStream(withSignal)) {
        handle?.throwIfAborted();
        yield chunk;
      }
    };
  }

  return adapter;
};

const makeAdapter = (settings) => {
  const adapter = new OpenAICompatibleAdapter({
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    defaultModel: settings.model || 'gpt-4o-mini',
    timeout: settings.requestTimeout || 120000,
    retry: { 
      maxRetries: settings.maxRetries ?? 1, 
      baseDelayMs: settings.baseDelayMs ?? 1000 
    }
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

  // One cancellation handle per run. Recreated by resetAbort() before each run.
  let abortHandle = new AbortHandle();

  const refreshStats = () => {
    if (session && session.cognitiveStats) {
      session.cognitiveStats.turns = session.context?.turns?.filter(t => t.role === 'user').length ?? 0;
      session.cognitiveStats.steps = session.stepCounter?.count ?? 0;
      
      if (session.context) {
        const systemPromptTokens = session.adapter?.estimateTokens?.(session.context.systemPrompt || '') ?? 0;
        const inputTurns = session.context.turns?.filter(t => t.role === 'user' || t.role === 'tool' || t.role === 'system') ?? [];
        const assistantTurns = session.context.turns?.filter(t => t.role === 'assistant') ?? [];
        
        const estInput = inputTurns.reduce((sum, t) => sum + (t.tokenCount ?? 0), 0) + systemPromptTokens;
        const estOutput = assistantTurns.reduce((sum, t) => sum + (t.tokenCount ?? 0), 0);
        
        session.cognitiveStats.inputTokens = estInput;
        session.cognitiveStats.outputTokens = estOutput;
      }
      
      updateCognitiveStats(session.cognitiveStats);
    }
  };

  const tracer = (event) => {
    // Eagerly check if the user triggered a stop/cancellation request!
    if (abortHandle.aborted) {
      throw new AbortError();
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
        
        if (event.status === 'done' && session && session.cognitiveStats) {
          refreshStats();
        }
      } else if (event.name === 'llm_stream_finished') {
        const reason = event.metadata?.finishReason;
        if (reason && reason !== 'tool_call' && reason !== 'stop') {
          showStopReason(reason, lastThinkingDiv);
        }
        
        if (session && session.cognitiveStats) {
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

  const adapter = wrapAdapterForAbort(makeAdapter(settings), () => abortHandle);

  session = new SessionManager({
    adapter,
    model: settings.model || 'gpt-4o-mini',
    maxTokens: settings.contextWindow || 128000,
    maxIterations: settings.maxIterations,
    maxSteps: settings.maxSteps,
    maxCompletionTokens: settings.maxCompletionTokens,
    temperature: settings.temperature ?? 0.0,
    tools: browserTools,
    media: { enableTools: true, toolPrefix: 'media_' },
    enableGoalPlanning: settings.enableGoalPlanning,
    goalInjectionFrequency: settings.goalInjectionFrequency,
    goalInjectionPosition: settings.goalInjectionPosition,
    enableContinuationPlanning: settings.enableContinuationPlanning,
    enableGoalVerification: settings.enableGoalVerification,
    staticSystemPrompt: settings.staticSystemPrompt,
    parallelToolCalls: settings.parallelToolCalls,
    toolFirewall: makeFirewall(() => abortHandle),
    toolRegistryTimeoutMs: settings.toolRegistryTimeoutMs ?? 30000,
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

  // Cancellation surface. `session.aborted = true` (kept for back-compat) trips the
  // current handle; abort()/resetAbort() are the preferred entry points.
  Object.defineProperty(session, 'aborted', {
    get: () => abortHandle.aborted,
    set: (v) => { if (v) abortHandle.abort(); }
  });
  session.abort = () => abortHandle.abort();
  session.resetAbort = () => {
    abortHandle = new AbortHandle();
    setAbortHandle(abortHandle);
    return abortHandle;
  };
  session.getAbortHandle = () => abortHandle;

  // tools.js reads the active handle to bail out between content-script calls.
  setAbortHandle(abortHandle);

  refreshStats();

  return session;
};
