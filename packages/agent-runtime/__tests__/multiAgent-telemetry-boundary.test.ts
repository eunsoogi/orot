import {
  createExternalTelemetrySink,
  providerSuccess,
  type LanguageModelProvider,
  type LanguageModelRequest,
  type TelemetryEvent,
} from '@orot/model-runtime';
import type { MultiAgentExecutionIdentity } from '../src/multiAgent/contracts';
import { DEFAULT_MULTI_AGENT_BUDGET } from '../src/multiAgent/contracts';
import { callModel } from '../src/multiAgent/modelCall';

const sentinels = [
  'SENTINEL_HEALTH_VALUE',
  'SENTINEL_TRANSCRIPT',
  'SENTINEL_MEMORY_CONTENT',
  'SENTINEL_OAUTH_SECRET',
  'SENTINEL_USER_ID',
  'SENTINEL_SOURCE_ID',
  'SENTINEL_MODEL_OUTPUT',
];

function request(): LanguageModelRequest {
  return {
    messages: [
      {
        role: 'user',
        content: `${sentinels[0]} ${sentinels[1]} ${sentinels[2]}`,
      },
    ],
  };
}

function execution(): MultiAgentExecutionIdentity {
  return {
    operationRunId: sentinels[4]!,
    providerId: sentinels[5]!,
    modelId: 'synthetic-model',
    recipient: 'synthetic-recipient',
    remoteProcessing: true,
    allowedScope: { sourceKinds: ['personal_record'], sourceIds: [sentinels[5]!] },
    budget: DEFAULT_MULTI_AGENT_BUDGET,
  };
}

function provider(): LanguageModelProvider {
  return {
    kind: 'language-model',
    id: 'synthetic-provider',
    displayName: 'Synthetic provider',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: false,
    },
    generate: jest.fn(async () =>
      providerSuccess({
        text: sentinels[6]!,
        toolCalls: [],
        finishReason: 'complete',
      }),
    ),
  };
}

describe('model-call telemetry boundary', () => {
  it('records only safe operation metadata after the exact request is authorized and sent', async () => {
    const model = provider();
    const consent = { authorize: jest.fn(async () => 'authorized' as const) };
    const events: TelemetryEvent[] = [];
    const telemetry = createExternalTelemetrySink({
      enabled: true,
      sink: {
        record: (event) => {
          events.push(event);
        },
      },
    });
    const payload = request();

    const result = await callModel(
      model,
      payload,
      execution(),
      consent,
      new AbortController().signal,
      telemetry,
    );
    await Promise.resolve();

    expect(result.status).toBe('response');
    expect(consent.authorize).toHaveBeenCalledWith(expect.objectContaining({ payload }));
    expect(model.generate).toHaveBeenCalledWith(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      operation: 'language-model.generate',
      outcome: 'success',
    });
    expect(Object.keys(events[0]!).sort()).toEqual(['durationMs', 'operation', 'outcome']);
    const captured = JSON.stringify(events);
    for (const sentinel of sentinels) expect(captured).not.toContain(sentinel);
  });

  it('sends neither the request nor telemetry when exact-payload consent is denied', async () => {
    const model = provider();
    const consent = {
      authorize: jest.fn(async () => 'renewal_required' as const),
    };
    const events: TelemetryEvent[] = [];
    const telemetry = createExternalTelemetrySink({
      enabled: true,
      sink: {
        record: (event) => {
          events.push(event);
        },
      },
    });

    const result = await callModel(
      model,
      request(),
      execution(),
      consent,
      new AbortController().signal,
      telemetry,
    );
    await Promise.resolve();

    expect(result.status).toBe('consent_required');
    expect(model.generate).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});
