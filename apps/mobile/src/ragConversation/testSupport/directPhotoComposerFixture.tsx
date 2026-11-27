import {
  createChatGPTPlanProvider,
  type ChatGPTPlanNativeBridge,
  type ChatGPTPlanNativeEvent,
} from '@orot/provider-openai';
import { useSyncExternalStore } from 'react';
import { runMigrations } from '@orot/storage';
import { createOrdinaryConversationMemoryEnrollmentStore } from '../../storage/ordinaryConversationMemoryEnrollment';
import { saveOrdinaryConversationMemoryNote } from '../../storage/ordinaryConversationMemoryNote';
import { t } from '../../i18n';
import { syntheticDirectJPEG } from '../../aiFeatures/integration/testSupport/directPhotoSendFixture';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { ConversationSteeringComposer } from '../ConversationSteeringComposer';
import { createConversationSessions } from '../conversationSessions';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { Transcript } from './savedHistoryDisplayFixture';
import { conversationDirectPhotoPorts as ports } from '../conversationDirectPhotoPorts';
import { DirectPhotoPresentationScope } from '../DirectPhotoPresentationScope';

export const onSendText = jest.fn();
export const onPickOCR = jest.fn();
const date = '2026-10-05T00:00:00.000Z';

export async function directPhotoComposerFixture({
  supported = true,
  hold = false,
  granted = true,
  holdGrant = false,
  beforeWrite,
  isEntryCurrent = () => true,
  ownsDraftRoute,
  enableOrdinaryMemory = false,
}: {
  supported?: boolean;
  hold?: boolean;
  granted?: boolean;
  holdGrant?: boolean;
  beforeWrite?: () => Promise<void>;
  isEntryCurrent?: () => boolean;
  ownsDraftRoute?: () => boolean;
  enableOrdinaryMemory?: boolean;
} = {}) {
  const f = openSqliteTestDatabase(':memory:');
  await runMigrations(f.database);
  const storage = createConversationArtifactStorage(f.database);
  await storage.createSession('selected', await storage.currentGeneration());
  const enrollment = createOrdinaryConversationMemoryEnrollmentStore(
    f.database,
  );
  const deviceEpoch = 'a'.repeat(64);
  const permission = enableOrdinaryMemory
    ? await enrollment.replace(await enrollment.read(), deviceEpoch, () => true)
    : undefined;
  const memoryCapture = jest.fn(async () =>
    permission?.enabled
      ? {
          database: f.database,
          deviceEpoch,
          generation: permission.generation,
          isCurrent: () => true,
        }
      : undefined,
  );
  const memorySave = jest.fn(saveOrdinaryConversationMemoryNote);
  const strict = jest.fn();
  // Each store has its own local IDs; never share a retention registry between owners.
  const createOptions = (): NonNullable<
    Parameters<typeof createConversationSessions>[0]
  > => ({
    ordinaryMemory: permission?.enabled
      ? {
          capture: memoryCapture,
          save: (receipt, source, current) =>
            memorySave(receipt, source, true, current),
        }
      : undefined,
    readSavedHistoryDisplay: conversationSavedHistoryDisplayOption(
      async () => storage,
    ),
    restoreSession: strict,
    restoreSessionPage: strict,
    async writeDirectPhotoReply(...args) {
      await beforeWrite?.();
      await storage.writeDirectPhotoReply(...args);
    },
    retention: createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => 'unexpected',
      now: () => date,
    }),
  });
  const store = createConversationSessions(createOptions());
  await store.attachExisting('selected', 0, date);

  let listener: ((event: ChatGPTPlanNativeEvent) => void) | undefined;
  let invalidate: (() => void) | undefined;
  let invalidateGrant: (() => void) | undefined;
  let releaseGrant: () => void = () => {};
  let current = true;
  type Start = NonNullable<ChatGPTPlanNativeBridge['startPhotoResponse']>;
  const start = jest.fn<ReturnType<Start>, Parameters<Start>>(
    async requestId => {
      if (!hold) {
        listener?.({
          requestId,
          type: 'response_started',
          responseId: 'synthetic-response',
        });
        listener?.({ requestId, type: 'text_delta', text: '합성 이미지 설명' });
        listener?.({ requestId, type: 'completed', text: '합성 이미지 설명' });
      }
    },
  );
  const ordinary = jest.fn(async () => {});
  const cancel = jest.fn();
  const bridge: ChatGPTPlanNativeBridge = {
    startResponse: ordinary,
    startPhotoResponse: start,
    listModels: async () => [],
    subscribe(next) {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    cancelResponse: cancel,
  };
  const modelId = 'gpt-6.2-sol';
  const provider = createChatGPTPlanProvider({
    issuedClientID: 'synthetic-owner',
    bridge,
    model: {
      slug: modelId,
      displayName: 'Synthetic image model',
      supportsDirectPhoto: supported,
    },
    requestIDFactory: () => 'image-request',
  });
  jest.mocked(ports.pick).mockResolvedValue(syntheticDirectJPEG);
  jest.mocked(ports.authorization).mockResolvedValue({
    selected: {
      status: 'ready',
      provider,
      modelId,
      recipient: t('nextVisit.recipient.chatgpt'),
      remoteProcessing: true,
      option: {
        provider,
        modelId,
        displayName: 'Synthetic image model',
        privacyBoundary: 'selected-context-remote',
        availability: { status: 'available' },
      },
      selection: { providerId: provider.id, modelId },
    },
    current: () => current,
    subscribe(callback) {
      invalidate = callback;
      return () => {
        invalidate = undefined;
      };
    },
  });
  jest.mocked(ports.grant).mockImplementation(async () => {
    if (holdGrant)
      await new Promise<void>(resolve => {
        releaseGrant = resolve;
      });
    return granted && current
      ? {
          current: () => current,
          subscribe(callback) {
            invalidateGrant = callback;
            return () => {
              invalidateGrant = undefined;
            };
          },
        }
      : null;
  });
  const session = () => {
    const snapshot = store.getSnapshot();
    return snapshot.sessions.find(item => item.id === snapshot.activeId)!;
  };
  function CurrentView() {
    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const active = snapshot.sessions.find(
      item => item.id === snapshot.activeId,
    )!;
    return (
      <DirectPhotoPresentationScope sessionId={active.id} available>
        <Transcript store={store} />
        <ConversationSteeringComposer
          store={store}
          session={active}
          isEntryCurrent={Object.assign(() => isEntryCurrent(), {
            routeOwnsDraft: ownsDraftRoute,
          })}
          photo={{ status: 'empty', onSelect: onPickOCR, onRemove: jest.fn() }}
          onSend={onSendText}
          onCancel={jest.fn()}
          onChangeText={text => store.setDraft(session().id, text)}
        />
      </DirectPhotoPresentationScope>
    );
  }
  const view = <CurrentView />;
  return {
    store,
    createOptions,
    storage,
    optedIn: permission?.enabled === true,
    memoryCapture,
    memorySave,
    close: f.close,
    session,
    view,
    start,
    ordinary,
    cancel,
    release: () => releaseGrant(),
    retire() {
      current = false;
      invalidate?.();
      invalidateGrant?.();
      releaseGrant();
    },
  };
}
