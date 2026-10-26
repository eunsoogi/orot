import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import { createProductionChatModel } from '@orot/agent-runtime';
import {
  appleFoundationModelsProbeBridge,
  withMockAppleModel,
} from './appleModelMockBridge';

const sentinels = [
  'SENTINEL_CALLBACK_DEFAULT_PROMPT',
  'SENTINEL_CALLBACK_DEFAULT_REPLY',
  'SENTINEL_CALLBACK_OPT_IN_PROMPT',
  'SENTINEL_CALLBACK_OPT_IN_REPLY',
  'SENTINEL_CALLBACK_STREAM_PROMPT',
  'SENTINEL_CALLBACK_STREAM_DRAFT',
  'SENTINEL_CALLBACK_STREAM_FINAL',
];

/** Use a separate mock lifecycle to prove explicit callback opt-in across the native bridge. */
export async function runPrivacySafeCallbacksProbe() {
  const events: Array<{ readonly name: string; readonly data: unknown }> = [];
  let rawCallbackEvents = 0;
  const callback = {
    handleCustomEvent: (name: string, data: unknown) =>
      events.push({ name, data }),
    handleChatModelStart: () => {
      rawCallbackEvents += 1;
    },
    handleLLMEnd: () => {
      rawCallbackEvents += 1;
    },
    handleLLMError: () => {
      rawCallbackEvents += 1;
    },
  };
  const result = await withMockAppleModel(
    [
      () => ({ text: 'SENTINEL_CALLBACK_DEFAULT_REPLY' }),
      () => ({ text: 'SENTINEL_CALLBACK_OPT_IN_REPLY' }),
      () => ({
        snapshots: [
          'SENTINEL_CALLBACK_STREAM_DRAFT',
          'SENTINEL_CALLBACK_STREAM_FINAL',
        ],
      }),
    ],
    async () => {
      const model = createProductionChatModel(
        new AppleFoundationModelsProvider(appleFoundationModelsProbeBridge),
      );
      await model.invoke('SENTINEL_CALLBACK_DEFAULT_PROMPT', {
        callbacks: [callback],
      });
      const defaultCallbackEvents = events.length;
      await model.invoke('SENTINEL_CALLBACK_OPT_IN_PROMPT', {
        externalTelemetryEnabled: true,
        callbacks: [callback],
      });
      const buffered: string[] = [];
      for await (const part of await model.stream(
        'SENTINEL_CALLBACK_STREAM_PROMPT',
        {
          externalTelemetryEnabled: true,
          callbacks: [callback],
        },
      )) {
        if (typeof part.content !== 'string')
          throw new Error('Native stream returned non-text content');
        buffered.push(part.content);
      }
      const observed = JSON.stringify(events);
      const sentinelExcluded = sentinels.every(
        value => !observed.includes(value),
      );
      const operations = ['language-model.generate', 'language-model.stream'];
      const validEvents =
        events.length === operations.length &&
        events.every((event, index) => {
          if (
            event.name !== 'orot_telemetry' ||
            !event.data ||
            typeof event.data !== 'object'
          )
            return false;
          const data = event.data as Record<string, unknown>;
          return (
            Object.keys(data).sort().join(',') ===
              'durationMs,operation,outcome' &&
            data.operation === operations[index] &&
            data.outcome === 'success' &&
            typeof data.durationMs === 'number' &&
            Number.isFinite(data.durationMs) &&
            data.durationMs >= 0
          );
        });
      if (
        defaultCallbackEvents !== 0 ||
        !validEvents ||
        rawCallbackEvents !== 0
      )
        throw new Error('Privacy-safe callback opt-in contract changed');
      if (!sentinelExcluded)
        throw new Error('Private model content reached a custom callback');
      if (
        buffered.length !== 1 ||
        buffered[0] !== 'SENTINEL_CALLBACK_STREAM_FINAL'
      )
        throw new Error(
          'Buffered native snapshots did not settle before delivery',
        );
      return {
        defaultCallbackEvents,
        optInCallbackEvents: events.length,
        rawCallbackEvents,
        events,
        sentinelExcluded,
        bufferedFinal: buffered[0],
      };
    },
  );
  return result;
}
