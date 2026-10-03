import { describe, expect, it } from '@jest/globals';
import type { LanguageModelRequest, LanguageModelResponse } from '@orot/model-runtime';
import { AppleFoundationModelsProvider, type AppleFoundationModelsNativeBridge } from '../src';

const request: LanguageModelRequest = { messages: [{ role: 'user', content: 'Generate.' }] };
const response: LanguageModelResponse = { text: 'done', toolCalls: [], finishReason: 'complete' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

class PendingBridge implements AppleFoundationModelsNativeBridge {
  readonly requestIds: string[] = [];
  readonly cancelled: string[] = [];
  private readonly requests = new Map<string, ReturnType<typeof deferred<LanguageModelResponse>>>();
  private readonly started = deferred<void>();

  get bothStarted() { return this.started.promise; }

  async getAvailability() { return { status: 'available' as const }; }

  generate(_request: LanguageModelRequest, requestId: string) {
    this.requestIds.push(requestId);
    const pending = deferred<LanguageModelResponse>();
    this.requests.set(requestId, pending);
    if (this.requestIds.length === 2) this.started.resolve();
    return pending.promise;
  }

  async *stream(_request: LanguageModelRequest, _requestId: string) {}

  cancel(requestId: string) { this.cancelled.push(requestId); }

  resolve(requestId: string, result: LanguageModelResponse) {
    this.requests.get(requestId)?.resolve(result);
  }
}

describe('Apple provider cancellation isolation', () => {
  it('gives concurrent provider instances distinct native ids and cancels only the selected request', async () => {
    const native = new PendingBridge();
    const first = new AppleFoundationModelsProvider(native);
    const second = new AppleFoundationModelsProvider(native);
    const firstCall = first.generate(request);
    const secondController = new AbortController();
    const secondCall = second.generate(request, { signal: secondController.signal });
    await native.bothStarted;

    expect(new Set(native.requestIds).size).toBe(2);
    secondController.abort();

    await expect(secondCall).rejects.toHaveProperty('name', 'AbortError');
    expect(native.cancelled).toEqual([native.requestIds[1]]);
    native.resolve(native.requestIds[0], response);
    await expect(firstCall).resolves.toEqual({ ok: true, value: response });
  });
});
