import { expect, it, jest } from '@jest/globals';
import type {
  LanguageModelProvider,
  LanguageModelStreamEvent,
  ProviderResult,
} from '@orot/model-runtime';
import { NativeStreamingChatModel } from '../src/langchain/streaming';
import { OROT_TELEMETRY_EVENT_NAME } from '../src/langchain/telemetryCallbacks';

it('reports cancellation when abort arrives during provider iterator cleanup', async () => {
  const controller = new AbortController();
  let cleanupStarted!: () => void;
  const cleanupStartedPromise = new Promise<void>((resolve) => {
    cleanupStarted = resolve;
  });
  const providerStream = jest.fn(() =>
    (async function* () {
      try {
        yield {
          ok: true,
          value: {
            type: 'completed',
            response: { text: 'SENTINEL_FINAL', toolCalls: [], finishReason: 'complete' },
          },
        } satisfies ProviderResult<LanguageModelStreamEvent>;
      } finally {
        cleanupStarted();
        await new Promise<void>((resolve) => {
          if (controller.signal.aborted) resolve();
          else controller.signal.addEventListener('abort', resolve, { once: true });
        });
      }
    })(),
  );
  const provider: LanguageModelProvider = {
    id: 'synthetic-provider',
    kind: 'language-model',
    displayName: 'Synthetic provider',
    capabilities: {
      inputTypes: ['text'],
      streaming: true,
      structuredOutput: false,
      toolCalling: false,
    },
    generate: jest.fn(),
    stream: providerStream,
  };
  const events: unknown[] = [];
  const iterable = await new NativeStreamingChatModel(provider, 'buffered').stream('Question', {
    signal: controller.signal,
    externalTelemetryEnabled: true,
    callbacks: [{ handleCustomEvent: (name, data, runId) => events.push({ name, data, runId }) }],
  });
  const pending = iterable[Symbol.asyncIterator]().next();
  await cleanupStartedPromise;
  controller.abort();

  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ name: OROT_TELEMETRY_EVENT_NAME });
  expect((events[0] as { data: Record<string, unknown> }).data).toMatchObject({
    operation: 'language-model.stream',
    outcome: 'cancelled',
  });
  expect(JSON.stringify(events)).not.toContain('SENTINEL_FINAL');
  expect(providerStream).toHaveBeenCalledTimes(1);
});
