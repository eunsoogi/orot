import { CallbackManager } from '@langchain/core/callbacks/manager';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { TelemetryEvent } from '@orot/model-runtime';
import {
  OROT_TELEMETRY_EVENT_NAME,
  createCallbackTelemetrySink,
} from '../src/langchain/telemetryCallbacks';

const event: TelemetryEvent = {
  operation: 'language-model.generate',
  outcome: 'success',
  durationMs: 12,
};

afterEach(() => jest.restoreAllMocks());

describe('LangChain telemetry callback adapter', () => {
  it('keeps callback telemetry disabled unless the call opts in', () => {
    const handleCustomEvent = jest.fn();
    const callbacks = CallbackManager.fromHandlers({ handleCustomEvent });
    const sink = createCallbackTelemetrySink({ callbacks });

    sink.record(event);

    expect(handleCustomEvent).not.toHaveBeenCalled();
  });

  it('forwards one sanitized custom event without callback tags or metadata', () => {
    const received: unknown[][] = [];
    const handleCustomEvent = (...args: unknown[]) => received.push(args);
    const callbacks = CallbackManager.fromHandlers({ handleCustomEvent });
    callbacks.addTags(['SENTINEL_TAG'], true);
    callbacks.addMetadata({ sourceText: 'SENTINEL_METADATA' }, true);
    const sink = createCallbackTelemetrySink({ enabled: true, callbacks });

    sink.record(event);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual([OROT_TELEMETRY_EVENT_NAME, event, expect.any(String)]);
    expect(JSON.stringify(received)).not.toContain('SENTINEL_TAG');
    expect(JSON.stringify(received)).not.toContain('SENTINEL_METADATA');
  });

  it('rejects enriched events before any handler receives them', () => {
    const handleCustomEvent = jest.fn();
    const sink = createCallbackTelemetrySink({
      enabled: true,
      callbacks: [{ handleCustomEvent }],
    });

    sink.record(event);
    expect(handleCustomEvent).toHaveBeenCalledTimes(1);
    expect(handleCustomEvent).toHaveBeenCalledWith(
      OROT_TELEMETRY_EVENT_NAME,
      event,
      expect.any(String),
    );

    sink.record({ ...event, prompt: 'SENTINEL_PROMPT' } as TelemetryEvent);

    expect(handleCustomEvent).toHaveBeenCalledTimes(1);
  });

  it('isolates each handler from mutations to another handler copy', () => {
    const received: unknown[] = [];
    const mutatingHandler = {
      handleCustomEvent: (_name: string, data: unknown) => {
        (data as Record<string, unknown>).prompt = 'SENTINEL_INJECTED_PROMPT';
      },
    };
    const observingHandler = {
      handleCustomEvent: (_name: string, data: unknown) => received.push(data),
    };
    const sink = createCallbackTelemetrySink({
      enabled: true,
      callbacks: [mutatingHandler, observingHandler],
    });

    sink.record(event);

    expect(received).toEqual([event]);
    expect(JSON.stringify(received)).not.toContain('SENTINEL_INJECTED_PROMPT');
  });

  it('continues after callback failures without logging their diagnostics', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const rejected = jest.fn(() => Promise.reject(new Error('SENTINEL_CALLBACK_FAILURE')));
    const received = jest.fn();
    const sink = createCallbackTelemetrySink({
      enabled: true,
      callbacks: [
        {
          handleCustomEvent: () => {
            throw new Error('SENTINEL_CALLBACK_THROW');
          },
        },
        { handleCustomEvent: rejected },
        { handleCustomEvent: received },
      ],
    });

    expect(() => sink.record(event)).not.toThrow();
    await Promise.resolve();

    expect(rejected).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });
});
