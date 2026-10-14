import type { AppleNativeStreamPacket } from '@orot/provider-apple';
import type { LanguageModelRequest } from '@orot/model-runtime';
import { appleFoundationModelsNativeBridge as native } from '../src/providers/apple/nativeBridge';
import {
  appleFoundationModelsProbeBridge as bridge,
  withMockAppleModel,
} from './appleModelMockBridge';

const request: LanguageModelRequest = {
  messages: [{ role: 'user', content: 'Synthetic native bridge test.' }],
};
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function errorCode(pending: Promise<unknown>) {
  try {
    await pending;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  throw new Error('Expected the native bridge to reject');
}
async function packets(cancel = false) {
  const result: AppleNativeStreamPacket[] = [];
  for await (const packet of bridge.stream(request, 'mock-stream')) {
    result.push(packet);
    if (cancel && packet.type === 'snapshot') bridge.cancel('mock-stream');
  }
  return result;
}

/** Exercises real native promises/events and request cancellation with controlled SDK output, including unsafe snapshots and failures. */
export async function runAppleModelMockBridgeProbe() {
  const streamed = await withMockAppleModel(
    [() => ({ snapshots: ['첫', '첫 응답'] })],
    async () => ({ packets: await packets() }),
  );
  const [first, second, completed] = streamed.packets;
  check(
    streamed.packets.length === 3 &&
      first?.type === 'snapshot' &&
      first.text === '첫' &&
      second?.type === 'snapshot' &&
      second.text === '첫 응답' &&
      completed?.type === 'completed' &&
      completed.response.text === '첫 응답' &&
      completed.response.finishReason === 'complete' &&
      completed.response.toolCalls.length === 0,
    'Native snapshots or completed response did not preserve the mock output',
  );

  const cancelled = await withMockAppleModel(
    [() => ({ snapshots: ['첫', '첫 응답'], delayMs: 250 })],
    async () => ({ packets: await packets(true) }),
  );
  check(
    cancelled.packets.length === 2 &&
      cancelled.packets[0]?.type === 'snapshot' &&
      cancelled.packets[1]?.type === 'cancelled',
    'Stream cancellation must end exactly once after the first observed snapshot',
  );

  const rewritten = await withMockAppleModel(
    [() => ({ snapshots: ['원래', '변경'] })],
    async () => ({ packets: await packets() }),
  );
  const rewriteError = rewritten.packets[1];
  check(
    rewritten.packets.length === 2 &&
      rewriteError?.type === 'error' &&
      rewriteError.code === 'STREAM_REWRITE',
    'Rewritten snapshots must fail without a completed event',
  );

  const failed = await withMockAppleModel(
    [() => ({ error: 'Synthetic SDK failure' })],
    async () => ({
      code: await errorCode(bridge.generate(request, 'mock-error')),
    }),
  );
  check(
    failed.code === 'GENERATION_FAILED',
    'SDK generation errors must reject through the native bridge',
  );

  const invalid = await withMockAppleModel(
    [() => ({ text: '{invalid JSON' })],
    async () => ({
      code: await errorCode(
        bridge.generate(
          {
            ...request,
            responseFormat: {
              name: 'response-codec',
              schema: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
                additionalProperties: false,
              },
            },
          },
          'mock-invalid-json',
        ),
      ),
    }),
  );
  check(
    invalid.code === 'GENERATION_FAILED',
    'Malformed generated JSON must fail the production codec',
  );

  const unavailable: string[] = [];
  for (const status of [
    'disabled',
    'modelNotReady',
    'unsupportedDevice',
    'unsupportedLanguage',
  ]) {
    await withMockAppleModel(
      [],
      async () => {
        check(
          (await native.getAvailability()).status === status,
          'Mock availability was not observed through the bridge',
        );
        check(
          (await errorCode(native.generate(request, 'mock-unavailable'))) ===
            'APPLE_MODEL_UNAVAILABLE',
          'Unavailable generation must fail before model dispatch',
        );
        const stream = [];
        for await (const packet of native.stream(
          request,
          'mock-unavailable-stream',
        ))
          stream.push(packet);
        check(
          stream.length === 1 &&
            stream[0]?.type === 'error' &&
            stream[0].code === 'APPLE_MODEL_UNAVAILABLE' &&
            stream[0].status === status,
          'Unavailable streaming must emit the original status',
        );
        unavailable.push(status);
        return {};
      },
      status,
    );
  }
  return {
    modelExecution: 'mock',
    streamed: streamed.packets,
    cancelled: cancelled.packets,
    rewritten: rewritten.packets,
    failed: failed.code,
    invalid: invalid.code,
    unavailable,
  };
}
