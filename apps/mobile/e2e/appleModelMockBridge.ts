import { NativeModules } from 'react-native';
import type { LanguageModelRequest } from '@orot/model-runtime';
import type { AppleFoundationModelsNativeBridge } from '@orot/provider-apple';
import { appleFoundationModelsNativeBridge } from '../src/providers/apple/nativeBridge';
import { serializeAppleRequest } from '../src/providers/apple/serializeRequest';

export interface MockAppleReply {
  readonly text?: string;
  readonly snapshots?: readonly string[];
  readonly delayMs?: number;
  readonly error?: string;
}
export type MockAppleStep = (request: LanguageModelRequest) => MockAppleReply;

interface MockObservation {
  readonly modelExecution: 'mock';
  readonly remainingReplies: number;
  readonly requests: readonly unknown[];
}
interface MockControl {
  configure(value: { status: string }): Promise<void>;
  enqueue(
    value: MockAppleReply & {
      prompt: string;
      mode: string;
      streaming: boolean;
    },
  ): Promise<void>;
  observation(): Promise<MockObservation>;
}

let steps: readonly MockAppleStep[] | undefined;
let dispatched = 0;
function control(): MockControl {
  const value = NativeModules.OrotAppleModelMock as MockControl | undefined;
  if (!value)
    throw new Error(
      'The Foundation Models mock requires a Simulator OROT_TESTS product',
    );
  return value;
}

/** Seed raw SDK responses, then call the shipping serializer and RN bridge. No normalized provider or workflow result is replaced. */
async function enqueue(request: LanguageModelRequest, streaming: boolean) {
  if (!steps) return;
  const step = steps[dispatched++];
  if (!step)
    throw new Error(
      'Unexpected Foundation Models call beyond the finite mock script',
    );
  const reply = step(request);
  const serialized = serializeAppleRequest(request);
  await control().enqueue({
    ...reply,
    prompt: serialized.prompt,
    mode: serialized.mode,
    streaming,
  });
}

export const appleFoundationModelsProbeBridge: AppleFoundationModelsNativeBridge =
  {
    ...appleFoundationModelsNativeBridge,
    async generate(request, requestId) {
      await enqueue(request, false);
      return appleFoundationModelsNativeBridge.generate(request, requestId);
    },
    async *stream(request, requestId) {
      await enqueue(request, true);
      yield* appleFoundationModelsNativeBridge.stream(request, requestId);
    },
  };

/** Per-operation scripts cannot leak responses across cases; every queued response must reach the native call boundary. */
export async function withMockAppleModel<T>(
  script: readonly MockAppleStep[],
  run: () => Promise<T>,
  status = 'available',
): Promise<
  T & {
    modelExecution: 'mock';
    actualModel: 'not-run';
    mockObservation: MockObservation;
  }
> {
  if (steps)
    throw new Error('Overlapping model mock operations are not supported');
  await control().configure({ status });
  steps = script;
  dispatched = 0;
  try {
    const result = await run();
    const observation = await control().observation();
    if (
      dispatched !== script.length ||
      observation.requests.length !== script.length ||
      observation.remainingReplies !== 0
    )
      throw new Error(
        'The model mock script was not consumed exactly once at the native boundary',
      );
    return {
      ...result,
      modelExecution: 'mock',
      actualModel: 'not-run',
      mockObservation: observation,
    };
  } finally {
    steps = undefined;
    await control().configure({ status: 'unsupportedDevice' });
  }
}
