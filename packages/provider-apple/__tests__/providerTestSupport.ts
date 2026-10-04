import type { LanguageModelResponse } from '@orot/model-runtime';
import type {
  AppleAvailabilityStatus,
  AppleFoundationModelsNativeBridge,
  AppleNativeStreamPacket,
} from '../src';

export const response: LanguageModelResponse = {
  text: '{"sourceIds":["source-42"]}',
  structuredOutput: { sourceIds: ['source-42'] },
  toolCalls: [],
  finishReason: 'complete',
};

export class FakeNativeBridge implements AppleFoundationModelsNativeBridge {
  availability: AppleAvailabilityStatus = 'available';
  generateCount = 0;
  readonly cancelled: string[] = [];
  readonly generatedRequestIds: string[] = [];
  generated: LanguageModelResponse = response;
  generateWait?: Promise<LanguageModelResponse>;
  onGenerate?: (requestId: string) => void;
  packets: AppleNativeStreamPacket[] = [
    { type: 'snapshot', text: '안' },
    { type: 'snapshot', text: '안녕' },
    {
      type: 'completed',
      response: { text: '안녕', toolCalls: [], finishReason: 'complete' },
    },
  ];

  async getAvailability() {
    return { status: this.availability } as const;
  }

  async generate(
    _request: Parameters<AppleFoundationModelsNativeBridge['generate']>[0],
    requestId: string,
  ) {
    this.generateCount += 1;
    this.generatedRequestIds.push(requestId);
    this.onGenerate?.(requestId);
    return this.generateWait ?? this.generated;
  }

  async *stream() {
    for (const packet of this.packets) yield packet;
  }

  cancel(requestId: string) {
    this.cancelled.push(requestId);
  }
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
