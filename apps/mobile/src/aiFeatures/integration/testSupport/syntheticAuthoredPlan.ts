import {
  createChatGPTPlanProvider,
  type ChatGPTPlanNativeEvent,
  type ChatGPTPlanRequest,
} from '@orot/provider-openai';

export const authoredPlanClient = 'synthetic-authored-client';
export const authoredPlanModel = 'synthetic-model';

/** Exercise the actual Plan request mapper and stream decoder, without a native
 * module, account, or network. Both streamed and final proposals must agree. */
export function syntheticAuthoredPlan(toolId: string, statement: string) {
  const requests: ChatGPTPlanRequest[] = [];
  const listeners = new Set<(event: ChatGPTPlanNativeEvent) => void>();
  const toolCall = {
    id: 'call_synthetic_authored',
    name: toolId,
    arguments: JSON.stringify({ statement }),
  };
  const provider = createChatGPTPlanProvider({
    issuedClientID: authoredPlanClient,
    model: { slug: authoredPlanModel, displayName: 'Synthetic text Plan' },
    requestIDFactory: () => 'synthetic-transport-request',
    bridge: {
      async listModels() {
        return [];
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      async startResponse(requestId, client, request) {
        expect(client).toBe(authoredPlanClient);
        requests.push(request);
        expect(requests).toHaveLength(1);
        for (const listener of listeners) {
          listener({ requestId, type: 'tool_call', toolCall });
          listener({
            requestId,
            type: 'completed',
            text: '',
            toolCalls: [toolCall],
          });
        }
      },
      cancelResponse() {},
    },
  });
  return { provider, requests };
}
