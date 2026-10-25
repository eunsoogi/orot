import type { LanguageModelRequest } from '@orot/model-runtime';
import type { ChatGPTPlanNativeBridge, ChatGPTPlanNativeEvent, ChatGPTPlanRequest } from '../src';

export const baseRequest: LanguageModelRequest = {
  messages: [
    { role: 'system', content: 'Be concise.' },
    { role: 'user', content: [{ type: 'text', text: 'Say hello.' }] },
  ],
};

export class FakeBridge implements ChatGPTPlanNativeBridge {
  models = [{ slug: 'gpt-test', displayName: 'Test model' }];
  listFailure: unknown;
  listedAccount: string | undefined;
  readonly started: { requestID: string; request: ChatGPTPlanRequest }[] = [];
  readonly cancelled: string[] = [];
  private readonly listeners = new Set<(event: ChatGPTPlanNativeEvent) => void>();

  constructor(
    private readonly onStart: (
      requestID: string,
      bridge: FakeBridge,
    ) => Promise<void> = async () => {},
  ) {}

  async listModels(issuedClientID: string) {
    this.listedAccount = issuedClientID;
    if (this.listFailure) throw this.listFailure;
    return this.models;
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
    this.started.push({ requestID, request });
    await this.onStart(requestID, this);
  }

  cancelResponse(requestID: string): void {
    this.cancelled.push(requestID);
  }

  emit(event: ChatGPTPlanNativeEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
