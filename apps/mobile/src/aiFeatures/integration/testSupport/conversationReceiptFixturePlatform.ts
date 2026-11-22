import { NativeModules } from 'react-native';
import type { ConversationSessions } from '../../../ragConversation/conversationSessions';
import type { ConversationScreenProps } from '../../../ragConversation/ConversationScreenProps';
import { immediateConversationChoices } from '../../../ragConversation/immediateConversationChoices';
import { conversationChoiceActions } from '../../../ragConversation/selectConversationChoice';
import { entryIntentSender } from '../../../ragConversation/entryIntentSender';
import { providerSelectionStore } from '../../../providers/selection/keychainSelectionStore';
import { nativeChatGPTSelectionServices } from '../../../providers/selection/chatGPTServices';
import type { SelectedAiResolverOptions } from '../provider';

export function installReceiptFixturePlatform(mark: (name: string) => void) {
  const crypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const diagnostics = NativeModules.OrotProviderDiagnostics;
  // This fixture needs distinct local IDs, not randomness from an actual device.
  let seed = 0;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: (bytes: Uint8Array) => bytes.fill(++seed) },
  });
  NativeModules.OrotProviderDiagnostics = {
    enabled: true,
    report: (_feature: string, stage: string, outcome: string) =>
      mark(`${stage}:${outcome}`),
  };
  return () => {
    NativeModules.OrotProviderDiagnostics = diagnostics;
    if (crypto) Object.defineProperty(globalThis, 'crypto', crypto);
    else Reflect.deleteProperty(globalThis, 'crypto');
    jest.restoreAllMocks();
  };
}

/** Keep the real native epoch ownership path, replacing only fixture account/catalog reads. */
export function installFixtureNativeSelection(
  input: SelectedAiResolverOptions,
) {
  jest
    .spyOn(providerSelectionStore, 'load')
    .mockImplementation(() => input.selectionStore!.load());
  jest
    .spyOn(nativeChatGPTSelectionServices, 'listAccounts')
    .mockImplementation(() => input.chatGPTServices!.listAccounts());
  jest
    .spyOn(nativeChatGPTSelectionServices, 'listModels')
    .mockImplementation(account => input.chatGPTServices!.listModels(account));
}

/** Invoke the same saved-entry binding as the composer or an inline Possibilities tap. */
export function submitFixtureConversation(
  owned: ConversationSessions,
  id: number,
  path: 'choice' | 'composer',
  send: ConversationScreenProps['onSend'],
) {
  if (path === 'choice') {
    const choose = conversationChoiceActions(owned, () => true);
    immediateConversationChoices(
      owned,
      id,
      { possibilities: choose.onOpenDiseaseHypotheses },
      send,
      undefined,
      () => true,
    )?.possibilities?.();
    return Promise.resolve();
  }
  owned.setDraft(id, '합성 측정 요청');
  return owned.send(id, entryIntentSender(owned, id, send, 'composer'));
}

/** Simulate a second canonical writer while the older leased session stays readable. */
export async function repointFixtureConversation(storage: {
  continuousSession: ReturnType<
    typeof import('../../../storage/conversationArtifactStorage').createConversationArtifactStorage
  >['continuousSession'];
}) {
  await storage.continuousSession(
    { providerId: 'different', modelId: 'different' },
    'synthetic-rotated-pointer',
    new Date().toISOString(),
    new AbortController().signal,
  );
}
