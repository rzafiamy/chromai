// ── ChromAI Agentic Logger ─────────────────────────────────────────────────
// Central in-memory log store that captures every tracer event emitted by the
// Lemura session. The log viewer panel reads from here and renders entries.

const MAX_ENTRIES = 500;

/** @type {LogEntry[]} */
const entries = [];

let onUpdateCb = null;

let _seq = 0;
const nextId = () => ++_seq;

/**
 * @typedef {{ id: number, ts: number, type: string, name: string, status?: string,
 *   input?: string, output?: string, meta?: object, label: string, icon: string }} LogEntry
 */

const TYPE_META = {
  tool_call:    { icon: '🔧', color: 'log-type-tool' },
  tool_result:  { icon: '✅', color: 'log-type-result' },
  thinking:     { icon: '🧠', color: 'log-type-think' },
  planning:     { icon: '📋', color: 'log-type-plan' },
  verification: { icon: '🔍', color: 'log-type-verify' },
  error:        { icon: '❌', color: 'log-type-error' },
  budget:       { icon: '🛡️', color: 'log-type-budget' },
  system:       { icon: '⚙️', color: 'log-type-system' },
};

/** Build a human-readable label for the event */
const makeLabel = (event) => {
  const n = event.name || '';
  if (event.type === 'tool_call')   return `Call: ${n}`;
  if (event.type === 'tool_result') return `Result: ${n}`;
  if (event.type === 'thinking') {
    if (n === 'llm_call') return event.status === 'running' ? `LLM — iter ${event.metadata?.iteration ?? '?'}` : `LLM done`;
    if (n === 'llm_stream_finished') return `Stream finished (${event.metadata?.finishReason ?? '?'})`;
    return n;
  }
  if (event.type === 'planning') {
    if (n === 'max_steps_reached') return 'Max steps reached';
    if (n === 'continuation_detected') return `Continuation: ${event.metadata?.action ?? ''}`;
    return n.replace(/_/g, ' ');
  }
  if (event.type === 'verification') return n.replace(/_/g, ' ');
  if (event.type === 'error') return `Error: ${n.replace(/_/g, ' ')}`;
  if (event.type === 'budget') return `Firewall: ${event.metadata?.toolName ?? n}`;
  return n || event.type;
};

/**
 * Push an event emitted by the Lemura tracer into the log store.
 * Call this inside the onTrace callback in agent.js.
 */
export const logEvent = (event) => {
  const meta = TYPE_META[event.type] ?? { icon: '📌', color: 'log-type-misc' };

  /** @type {LogEntry} */
  const entry = {
    id:     nextId(),
    ts:     Date.now(),
    type:   event.type,
    name:   event.name,
    status: event.status,
    input:  event.input   != null ? (typeof event.input  === 'string' ? event.input  : JSON.stringify(event.input,  null, 2)) : undefined,
    output: event.output  != null ? (typeof event.output === 'string' ? event.output : JSON.stringify(event.output, null, 2)) : undefined,
    meta:   event.metadata ?? null,
    label:  makeLabel(event),
    icon:   meta.icon,
    color:  meta.color,
  };

  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);

  onUpdateCb?.(entry);
};

/** Log a custom system message (session start, clear, etc.) */
export const logSystem = (message) => {
  logEvent({ type: 'system', name: 'system', status: 'info', output: message });
};

/** Subscribe to new log entries (called each time a new entry is added) */
export const onLogUpdate = (cb) => { onUpdateCb = cb; };

/** Return a copy of all entries, optionally filtered by type */
export const getEntries = (typeFilter = null) =>
  typeFilter ? entries.filter(e => e.type === typeFilter) : [...entries];

/** Clear all log entries */
export const clearLogs = () => {
  entries.length = 0;
  _seq = 0;
  onUpdateCb?.(null); // signal a full clear
};

/** Return a list of unique event types currently in the log */
export const getTypes = () => [...new Set(entries.map(e => e.type))];
