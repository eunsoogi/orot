import * as keychain from 'react-native-keychain';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { ReadSavedHistoryDisplay } from '../conversationSavedHistoryDisplay';
import { providerSelectionStore } from '../../providers/selection/keychainSelectionStore';
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
            expect(_account).toBe('synthetic-client');
            const [_, user] = request.messages;
            if (!user || !('role' in user) || user.role !== 'user')
              throw new Error('Expected one authored input.');
            if (planCalls === 0) expect(user.content).toBe(prompt);
            else {
              expect(JSON.parse(user.content)).toEqual({
                request: prompt,
                candidate: text,
              });
              if (revokeDuringReview) current = false;
            }
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
    },
    prompt,
    {
      ...observer,
      inputOrigin: origin,
      expectedConversationModel: {
        providerId: provider.id,
        modelId: option.modelId,
        isCurrent: () => current,
      },
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

/** A real stock selection write retires the previous generation. Archive
 * restoration must not read or call that selection. Keychain is inert in Jest. */
export async function replaceContextualOpeningTestSelection(wasPlan: boolean) {
  const apple = {
    providerId: 'apple-foundation-models',
    modelId: 'apple-foundation-models-system-default',
  };
  const plan = {
    providerId: 'chatgpt-plan:replacement:synthetic',
    modelId: 'synthetic',
  };
  let saved = '';
  const write = jest
    .spyOn(keychain, 'setGenericPassword')
    .mockImplementation(async (_user, value) => {
      saved = value;
      return { service: 'fixture', storage: keychain.STORAGE_TYPE.AES_GCM };
    });
  const read = jest
    .spyOn(keychain, 'getGenericPassword')
    .mockImplementation(async () => ({
      service: 'fixture',
      username: 'provider-selection',
      password: saved,
      storage: keychain.STORAGE_TYPE.AES_GCM,
    }));
  try {
    await providerSelectionStore.save(wasPlan ? plan : apple);
    expect(await providerSelectionStore.load()).toEqual(wasPlan ? plan : apple);
    const before = providerSelectionStore.liveWitness();
    expect(before?.()).toBe(true);
    await providerSelectionStore.save(wasPlan ? apple : plan);
    expect(before?.()).toBe(false);
    expect(await providerSelectionStore.load()).toEqual(wasPlan ? apple : plan);
  } finally {
    read.mockRestore();
    write.mockRestore();
  }
}

export async function checkOpeningsRetireWithArchiveOwner(
  storage: ReturnType<typeof createConversationArtifactStorage>,
  reader: ReadSavedHistoryDisplay,
) {
  await expect(
    storage.readSessionPresentationMany('foreign-owner', 0, ['synthetic-turn']),
  ).rejects.toThrow();
  await storage.deleteSession('synthetic-session');
  await expect(
    reader('synthetic-session', 0, new AbortController().signal),
  ).rejects.toThrow();
}
