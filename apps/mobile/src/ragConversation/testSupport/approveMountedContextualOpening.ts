import {
  AppleFoundationModelsProvider,
  type AppleFoundationModelsNativeBridge,
} from '@orot/provider-apple';
import {
  createChatGPTPlanProvider,
  type ChatGPTPlanNativeEvent,
} from '@orot/provider-openai';
import { startPreparedRagOpening } from '../../aiFeatures/integration/preparedOpeningConsent';
import { createAppleSelectionOption } from '../../providers/selection/options';

import type { RagConversationObserver } from '../conversationObserver';

/** The inert native transport still exercises the actual selected Apple adapter and opening review. */
export async function approveMountedContextualOpening(
  prompt: string,
  text: string,
  observer: RagConversationObserver | undefined,
  signal: AbortSignal,
  origin: 'composer' | 'shortcut',
  revokeDuringReview: boolean,
  plan: boolean,
) {
  let current = true;
  const generate = jest.fn<
    ReturnType<AppleFoundationModelsNativeBridge['generate']>,
    Parameters<AppleFoundationModelsNativeBridge['generate']>
  >(async request => {
    expect(request.messages.map(item => item.role)).toEqual(['system', 'user']);
    expect(request.tools).toBeUndefined();
    const user = request.messages[1];
    if (user?.role !== 'user') throw new Error('Expected a user-only request.');
    if (user.content !== prompt) {
      expect(JSON.parse(String(user.content))).toEqual({
        request: prompt,
        candidate: text,
      });
      if (revokeDuringReview) current = false;
    }
    return {
      text:
        user.content === prompt
          ? JSON.stringify({ text: text, layout: 'plain' })
          : 'ALLOW',
      toolCalls: [],
      finishReason: 'complete',
    };
  });
  const modelId = 'synthetic-plan';
  let receive: ((e: ChatGPTPlanNativeEvent) => void) | undefined;
  let planCalls = 0;
  const provider = plan
    ? createChatGPTPlanProvider({
        issuedClientID: 'synthetic-client',
        model: { slug: modelId, displayName: 'Synthetic Plan' },
        bridge: {
          listModels: async () => [],
          subscribe(listener) {
            receive = listener;
            return () => {
              receive = undefined;
            };
          },
          async startResponse(requestId, _account, request) {
            expect(
              request.messages.map(message =>
                'role' in message ? message.role : undefined,
              ),
            ).toEqual(['system', 'user']);
            expect(request.tools).toBeUndefined();
            const response =
              ++planCalls === 1
                ? JSON.stringify({ text, layout: 'plain' })
                : 'ALLOW';
            receive?.({ requestId, type: 'text_delta', text: response });
            receive?.({
              requestId,
              type: 'completed',
              text: response,
              toolCalls: [],
            });
          },
          cancelResponse() {},
        },
      })
    : new AppleFoundationModelsProvider({
        getAvailability: async () => ({ status: 'available' }),
        generate,
        async *stream(request, requestID) {
          yield {
            type: 'completed',
            response: await generate(request, requestID),
          };
        },
        cancel() {},
      });
  const option = {
    ...createAppleSelectionOption('available'),
    ...(plan
      ? { modelId, privacyBoundary: 'selected-context-remote' as const }
      : {}),
    provider,
  };
  const preview = startPreparedRagOpening(
    {
      status: 'ready',
      provider,
      option,
      modelId: option.modelId,
      selection: {
        providerId: provider.id,
        modelId: option.modelId,
      },
      recipient: plan ? 'Inert Plan bridge' : 'on-device',
      remoteProcessing: plan,
      onDeviceSelectionWitness: {
        isCurrent: () => current,
        subscribe: () => () => {},
      },
    },
    prompt,
    {
      ...observer,
      inputOrigin: origin,
    },
    { authorize: async () => 'authorized' },
    signal,
    {
      entryContext: { intent: 'conversation', entryKey: 'stock-ordinary-root' },
    },
  );
  preview.ready();
  try {
    await preview.done;
  } finally {
    preview.dispose();
  }
  if (plan) expect(planCalls).toBe(2);
  else expect(generate).toHaveBeenCalledTimes(2);
}
