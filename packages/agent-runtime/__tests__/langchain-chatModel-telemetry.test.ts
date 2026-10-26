import type { Callbacks } from '@langchain/core/callbacks/manager';
import { HumanMessage } from '@langchain/core/messages';
import type { LanguageModelProvider } from '@orot/model-runtime';
import { NativeChatModel } from '../src/langchain/chatModel';
import { OROT_TELEMETRY_EVENT_NAME } from '../src/langchain/telemetryCallbacks';

function fixture() {
  const generate = jest.fn().mockResolvedValue({
    ok: true,
    value: { text: 'SENTINEL_RESPONSE', toolCalls: [], finishReason: 'complete' },
  });
  const provider: LanguageModelProvider = {
    id: 'synthetic-provider',
    kind: 'language-model',
    displayName: 'Synthetic provider',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: false,
    },
    generate,
  };
  return { model: new NativeChatModel(provider), generate };
}

function eventCollector(events: unknown[]) {
  return {
    handleCustomEvent: (name: string, data: unknown, runId: string) => {
      events.push({ name, data, runId });
    },
    handleChatModelStart: jest.fn(),
    handleLLMEnd: jest.fn(),
    handleLLMError: jest.fn(),
  };
}

function telemetryPayload(events: unknown[]) {
  return (events[0] as { data: Record<string, unknown> }).data;
}

describe('native chat telemetry callbacks', () => {
  it('keeps standard callbacks private by default', async () => {
    const { model, generate } = fixture();
    const events: unknown[] = [];
    const callback = eventCollector(events);

    await model.invoke('SENTINEL_PROMPT', { callbacks: [callback] });

    expect(events).toEqual([]);
    expect(callback.handleChatModelStart).not.toHaveBeenCalled();
    expect(callback.handleLLMEnd).not.toHaveBeenCalled();
    expect(callback.handleLLMError).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]![0]).toEqual({
      messages: [{ role: 'user', content: 'SENTINEL_PROMPT' }],
    });
  });

  it('emits only allowlisted event data after explicit opt-in', async () => {
    const { model, generate } = fixture();
    const events: unknown[] = [];
    const callback = eventCollector(events);
    const callbacks: Callbacks = [callback];

    const result = await model.generate(
      [[new HumanMessage('SENTINEL_PROMPT')]],
      {
        externalTelemetryEnabled: true,
        tags: ['SENTINEL_TAG'],
        metadata: { evidence: 'SENTINEL_METADATA' },
      },
      callbacks,
    );

    expect(result.generations[0]?.[0]?.text).toBe('SENTINEL_RESPONSE');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: OROT_TELEMETRY_EVENT_NAME });
    expect(telemetryPayload(events)).toMatchObject({
      operation: 'language-model.generate',
      outcome: 'success',
    });
    expect(Object.keys(telemetryPayload(events)).sort()).toEqual([
      'durationMs',
      'operation',
      'outcome',
    ]);
    expect(telemetryPayload(events).durationMs).toEqual(expect.any(Number));
    const forwarded = JSON.stringify(events);
    for (const sentinel of [
      'SENTINEL_PROMPT',
      'SENTINEL_RESPONSE',
      'SENTINEL_TAG',
      'SENTINEL_METADATA',
    ])
      expect(forwarded).not.toContain(sentinel);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]![0]).toEqual({
      messages: [{ role: 'user', content: 'SENTINEL_PROMPT' }],
    });
  });

  it('reports a closed error code without forwarding the provider diagnostic', async () => {
    const { model, generate } = fixture();
    generate.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'provider_unavailable',
        message: 'SENTINEL_RAW_DIAGNOSTIC',
        retryable: true,
      },
    });
    const events: unknown[] = [];

    await expect(
      model.invoke('SENTINEL_PROMPT', {
        externalTelemetryEnabled: true,
        callbacks: [eventCollector(events)],
      }),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });

    expect(events).toHaveLength(1);
    expect(telemetryPayload(events)).toMatchObject({
      operation: 'language-model.generate',
      outcome: 'error',
      errorCode: 'provider_unavailable',
    });
    expect(JSON.stringify(events)).not.toContain('SENTINEL_RAW_DIAGNOSTIC');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('preserves native abort behavior and reports cancellation once', async () => {
    const { model, generate } = fixture();
    const controller = new AbortController();
    const events: unknown[] = [];
    generate.mockImplementationOnce(async () => {
      controller.abort();
      return {
        ok: true,
        value: { text: 'SENTINEL_LATE_RESPONSE', toolCalls: [], finishReason: 'complete' },
      };
    });

    await expect(
      model.invoke('SENTINEL_PROMPT', {
        externalTelemetryEnabled: true,
        callbacks: [eventCollector(events)],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(events).toHaveLength(1);
    expect(telemetryPayload(events)).toMatchObject({
      operation: 'language-model.generate',
      outcome: 'cancelled',
    });
    expect(JSON.stringify(events)).not.toContain('SENTINEL_LATE_RESPONSE');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('keeps a throwing telemetry callback from changing the model result', async () => {
    const { model, generate } = fixture();
    const callback = {
      handleCustomEvent: () => {
        throw new Error('SENTINEL_CALLBACK_ERROR');
      },
    };

    await expect(
      model.invoke('Question', {
        externalTelemetryEnabled: true,
        callbacks: [callback],
      }),
    ).resolves.toMatchObject({ content: 'SENTINEL_RESPONSE' });

    expect(generate).toHaveBeenCalledTimes(1);
  });
});
