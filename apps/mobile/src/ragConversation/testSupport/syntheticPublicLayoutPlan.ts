import {
  createChatGPTPlanProvider,
  type ChatGPTPlanNativeBridge,
  type ChatGPTPlanNativeEvent,
  type ChatGPTPlanRequest,
} from '@orot/provider-openai';
export function syntheticPublicLayoutPlan(text: string) {
  const listeners = new Set<(event: ChatGPTPlanNativeEvent) => void>();
  const requests: ChatGPTPlanRequest[] = [];
  const model = { slug: 'gpt-test', displayName: 'Synthetic Plan' };
  const emit = (event: ChatGPTPlanNativeEvent) =>
    listeners.forEach(listener => listener(event));
  const bridge: ChatGPTPlanNativeBridge = {
    async listModels() {
      return [model];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async startResponse(requestId, _client, request) {
      requests.push(request);
      emit({
        type: 'response_started',
        requestId,
        responseId: 'synthetic-public-reply',
      });
      emit({ type: 'text_delta', requestId, text });
      emit({ type: 'completed', requestId, text });
    },
    cancelResponse: jest.fn(),
  };
  return {
    requests,
    provider: createChatGPTPlanProvider({
      bridge,
      issuedClientID: 'synthetic-public-plan-account',
      model,
    }),
  };
}
