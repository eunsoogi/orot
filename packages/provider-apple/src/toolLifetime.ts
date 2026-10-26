import type { LanguageModelRequest, LanguageModelResponse } from '@orot/model-runtime';
import type { AppleCancellationSignal } from './types';

interface Lease {
  signal?: AppleCancellationSignal;
  release(cancel: boolean): void;
}

/** Keeps the SDK callback cancellable between provider replies and validated tool results. */
export class AppleToolLifetime {
  private readonly calls = new Map<string, Lease>();
  constructor(private readonly cancel: (requestId: string) => void) {}

  begin(request: LanguageModelRequest, signal?: AppleCancellationSignal) {
    const previous = new Set<Lease>();
    for (const message of request.messages) {
      if (message.role !== 'tool') continue;
      const lease = this.calls.get(message.toolCallId);
      if (!lease) continue;
      if (lease.signal !== signal) throw new Error('Tool result belongs to another Apple run.');
      previous.add(lease);
    }
    let finished = false;
    return (response?: LanguageModelResponse, requestId?: string) => {
      if (finished) return;
      finished = true;
      for (const lease of previous) lease.release(response === undefined);
      if (response?.toolCalls.length && requestId) this.retain(response, requestId, signal);
    };
  }

  private retain(
    response: LanguageModelResponse,
    requestId: string,
    signal?: AppleCancellationSignal,
  ) {
    let released = false;
    const ids = response.toolCalls.map((call) => call.id);
    const abort = () => lease.release(true);
    // The graph's deadline is authoritative. This finite backstop also releases calls made
    // without a caller signal or abandoned before a matching tool result is submitted.
    const timer = setTimeout(abort, 90_000);
    // Node consumers may exit while idle; React Native returns a numeric timer instead.
    const hostTimer: unknown = timer;
    if (
      typeof hostTimer === 'object' &&
      hostTimer !== null &&
      'unref' in hostTimer &&
      typeof hostTimer.unref === 'function'
    )
      hostTimer.unref();
    const lease: Lease = {
      signal,
      release: (cancel) => {
        if (released) return;
        released = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        for (const id of ids) if (this.calls.get(id) === lease) this.calls.delete(id);
        if (cancel) this.cancel(requestId);
      },
    };
    for (const id of ids) {
      this.calls.get(id)?.release(true);
      this.calls.set(id, lease);
    }
    signal?.addEventListener('abort', abort);
    if (signal?.aborted) abort();
  }
}
