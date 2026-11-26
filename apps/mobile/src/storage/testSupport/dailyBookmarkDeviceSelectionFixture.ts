import { NativeModules } from 'react-native';
import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { continuousSessionOption } from '../../aiFeatures/integration/continuousSessionOption';
import { apple } from '../../aiFeatures/integration/featureServiceFixtures';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import type { createConversationArtifactStorage } from '../conversationArtifactStorage';

type Storage = ReturnType<typeof createConversationArtifactStorage>;
const model = { providerId: APPLE_PROVIDER_ID, modelId: apple.modelId };

export async function prepareOwnedDailyBookmarkFixtureSession(
  storage: Storage,
  device: boolean,
) {
  if (device) {
    await storage.continuousSession(
      model,
      'follow-up-session',
      '2035-01-01T12:00:00.000Z',
      new AbortController().signal,
    );
  } else {
    await storage.createSession(
      'follow-up-session',
      await storage.currentGeneration(),
    );
  }
}

/** Keep exact persisted owner matching and the real binder; stub only native
 * selection observation and provider resolution (never inference). */
export function dailyBookmarkDeviceSelectionFixture(storage: Storage) {
  const old = NativeModules.ConversationExecutionModule;
  NativeModules.ConversationExecutionModule = {
    begin: async () => true,
    end() {},
    isActive: async () => true,
    protectedDataAvailable: async () => true,
    addListener() {},
    removeListeners() {},
  };
  return {
    options: {
      ...continuousSessionOption(
        async () => ({
          status: 'ready',
          selection: model,
          option: apple,
          provider: apple.provider,
          modelId: model.modelId,
          recipient: 'Synthetic local device',
          remoteProcessing: false,
        }),
        async () => storage,
        () => () => () => true,
      ),
      execution: conversationExecutionNative() ?? undefined,
    },
    restore() {
      NativeModules.ConversationExecutionModule = old;
    },
  };
}
