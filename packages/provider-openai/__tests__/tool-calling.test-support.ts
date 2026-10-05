import type { LanguageModelRequest, ToolCall } from '@orot/model-runtime';
import { createChatGPTPlanProvider } from '../src';
import type { ChatGPTPlanNativeBridge, ChatGPTPlanNativeEvent, ChatGPTPlanRequest } from '../src';

export const tool = {
  name: 'lookup_source',
  description: 'Look up one synthetic source.',
  inputSchema: {
    type: 'object',
    properties: { sourceId: { type: 'string' } },
    required: ['sourceId'],
    additionalProperties: false,
  },
} as const;

export const toolCall: ToolCall = {
  id: 'call_synthetic_1',
  name: 'lookup_source',
  arguments: { sourceId: 'source-42' },
};

export const requestWithTools: LanguageModelRequest = {
  messages: [{ role: 'user', content: 'Look up source-42.' }],
  tools: [tool],
};

export function createProvider(bridge: FakeBridge) {
  return createChatGPTPlanProvider({
    bridge,
    issuedClientID: 'issued-client',
    model: { slug: 'gpt-test', displayName: 'Test model' },
    requestIDFactory: (() => {
      let next = 0;
      return () => `request-${++next}`;
    })(),
  });
}

export class FakeBridge implements ChatGPTPlanNativeBridge {
  readonly started: { requestID: string; request: ChatGPTPlanRequest }[] = [];
  readonly cancelled: string[] = [];
  private readonly listeners = new Set<(event: ChatGPTPlanNativeEvent) => void>();

  constructor(
    private readonly onStart: (
      requestID: string,
      bridge: FakeBridge,
      requestNumber: number,
    ) => Promise<void> = async () => {},
  ) {}

  async listModels() {
    return [{ slug: 'gpt-test', displayName: 'Test model' }];
  }

  subscribe(listener: (event: ChatGPTPlanNativeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async startResponse(
    requestID: string,
    _issuedClientID: string,
    request: ChatGPTPlanRequest,
  ): Promise<void> {
    const requestNumber = this.started.length;
    this.started.push({ requestID, request });
    await this.onStart(requestID, this, requestNumber);
  }

  cancelResponse(requestID: string): void {
    this.cancelled.push(requestID);
  }

  emit(event: ChatGPTPlanNativeEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
