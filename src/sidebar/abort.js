// Cooperative cancellation for an agent run.
//
// lemura's SessionManager exposes no abort API: neither the provider adapter's
// complete()/stream() nor the ToolContext receive an AbortSignal. So cancellation
// has to be cooperative on our side. An AbortHandle is created per run and shared
// by the adapter wrapper, every tool's execute(), the trace callback, and the
// confirmation modal. The moment the user hits Stop:
//   - in-flight fetch() is aborted via the AbortSignal,
//   - any awaited LLM/tool promise loses its race to a rejecting abort promise,
//   - an open confirmation modal resolves (cancelled) instead of hanging forever.

export class AbortError extends Error {
  constructor(message = 'Agent execution cancelled by user') {
    super(message);
    this.name = 'AbortError';
    this.aborted = true;
  }
}

export const isAbortError = (err) =>
  err instanceof AbortError ||
  err?.aborted === true ||
  err?.name === 'AbortError' ||
  err?.message === 'Agent execution cancelled by user';

export class AbortHandle {
  constructor() {
    this._aborted = false;
    this._controller = new AbortController();
    this._listeners = new Set();
  }

  /** Native AbortSignal to hand to fetch(). */
  get signal() { return this._controller.signal; }

  get aborted() { return this._aborted; }

  /** Trip the handle. Idempotent. Notifies all listeners and aborts the signal. */
  abort() {
    if (this._aborted) return;
    this._aborted = true;
    try { this._controller.abort(); } catch { /* ignore */ }
    for (const fn of this._listeners) {
      try { fn(); } catch { /* a listener must not break the others */ }
    }
    this._listeners.clear();
  }

  /** Throw immediately if already aborted. Call at cooperative checkpoints. */
  throwIfAborted() {
    if (this._aborted) throw new AbortError();
  }

  /**
   * Subscribe to abort. Fires immediately if already aborted.
   * Returns an unsubscribe function.
   */
  onAbort(fn) {
    if (this._aborted) { try { fn(); } catch { /* ignore */ } return () => {}; }
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** A promise that rejects with AbortError the moment the handle is tripped. */
  asRejectingPromise() {
    return new Promise((_, reject) => this.onAbort(() => reject(new AbortError())));
  }

  /**
   * Race a promise against abort. If Stop is pressed while `promise` is still
   * pending, the returned promise rejects right away (the original keeps running
   * in the background but the agent loop no longer waits on it).
   */
  race(promise) {
    if (this._aborted) return Promise.reject(new AbortError());
    return Promise.race([promise, this.asRejectingPromise()]);
  }
}
