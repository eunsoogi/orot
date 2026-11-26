import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import {
  AppState,
  DeviceEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';
import { SettingsConsentReadServicesContext } from '../../agent/execution/SettingsConsentReadServices';
import { liveVoiceModelId as mockLiveVoiceModelId } from '../../agent/execution/liveVoiceSettingsIdentity';
import { openLiveAudioSettingsFixture } from '../testSupport/liveAudioSettingsFixture';
import { fixture as protectedFixture } from '../testSupport/liveResponsesProtectedFixture';
import { LiveConversationVoiceEntry } from '../LiveConversationVoiceEntry';
import type { ConversationVoiceProps } from '../conversationVoiceDependencies';
import {
  fakeLiveCommonNative,
  witness,
} from '../testSupport/fakeLiveCommonNative';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
const mockSettings = jest.fn();
const mockAuthorize = jest.fn();
const mockOpenData = jest.fn();
jest.mock('../../voiceSettings/voiceSettingsStore', () => ({
  voiceSettingsStore: { subscribe: () => () => {} },
}));
jest.mock('../../voiceSettings/liveResponsesSettings', () => ({
  loadLiveResponsesSettings: (...args: unknown[]) => mockSettings(...args),
}));
jest.mock('../../voiceSettings/liveConversationToolsAuthorization', () => ({
  liveConversationToolsAuthorization: (
    _settings: unknown,
    current: () => boolean,
  ) => ({
    authorize: mockAuthorize,
    isAuthorizationCurrent: current,
  }),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: () => ({
    bridgeAvailable: true,
    protectedDataAvailable: async () => true,
    subscribe: () => () => {},
  }),
}));
jest.mock('../../voiceSettings/liveVoicePreferencesKeychain', () => ({
  loadLiveCallSettings: async () => ({
    model: mockLiveVoiceModelId,
    apiKey: 'synthetic-no-network-key',
    credentialEpoch: 'c'.repeat(64),
    preferences: { schema: 1, language: 'auto', voice: 'default' },
  }),
}));
jest.mock('../../aiFeatures/integration/localData', () => ({
  openAiFeatureLocalData: () => mockOpenData(),
}));
test.each([
  'valid',
  'wrong-ack',
  'no-common-grant',
  'source-denied',
  'stop-in-queue',
] as const)(
  'production Live start and completed native V3 batch preserve exact proof: %s',
  async mode => {
    const audio = openLiveAudioSettingsFixture();
    const storage = await protectedFixture();
    const previous = [
      AppState.currentState,
      NativeModules.VoiceRealtimeModule,
    ] as const;
    const os = Object.getOwnPropertyDescriptor(Platform, 'OS')!;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    AppState.currentState = 'active';
    mockOpenData.mockReset().mockResolvedValue(await storage.input.openData());
    mockAuthorize.mockReset().mockImplementation(async () => {
      if (mode === 'source-denied') storage.revokeDbOwner();
      return 'authorized';
    });
    mockSettings.mockResolvedValue({
      kind: 'active',
      credentialEpoch: witness.credentialEpoch,
      nativeGrant: witness,
      commonToolsPolicy:
        mode === 'no-common-grant' ? undefined : 'common-tools-v3',
      current: () => true,
      subscribe: () => () => {},
    });
    let finishNative: ((value: boolean) => void) | undefined;
    const native = fakeLiveCommonNative(
      mode === 'stop-in-queue'
        ? () =>
            new Promise<boolean>(resolve => {
              finishNative = resolve;
            })
        : undefined,
    );
    NativeModules.VoiceRealtimeModule = native;
    const store = {
      getSnapshot: () => ({ activeId: 1, sessions: [{ id: 1 }] }),
      photoDrafts: { get: () => ({ status: 'empty' }) },
    } as unknown as ConversationVoiceProps['store'];
    const onSend = jest.fn();
    try {
      await audio.seed({ audio: true, tool: false, wrongRecipient: false });
      const result = await render(
        <SettingsConsentReadServicesContext.Provider
          value={{
            resolveOwner: async () => ({
              slot: 'voice',
              domain: 'model',
              identity: audio.identity,
              isCurrent: () => true,
            }),
            readGrant: audio.repo.read,
          }}
        >
          <LiveConversationVoiceEntry
            sessionId={1}
            selectionRevision={1}
            busy={false}
            photoPending={false}
            store={store}
            resolveSelectedAi={jest.fn()}
            onSend={onSend}
          />
        </SettingsConsentReadServicesContext.Provider>,
      );
      try {
        await fireEvent.press(screen.getByTestId('conversation-voice-control'));
        await waitFor(() =>
          expect(native.openLiveCall).toHaveBeenCalledTimes(1),
        );
        const [callId, , , { commonToolsRegistration }] =
          native.openLiveCall.mock.calls[0]!;
        if (mode === 'no-common-grant') {
          expect(commonToolsRegistration).toBeUndefined();
          expect(mockOpenData).not.toHaveBeenCalled();
          return;
        }
        expect(commonToolsRegistration).toMatchObject({
          ...witness,
          policy: 'common-tools-v3',
          tools: [{ name: 'local-health-context' }],
        });
        const owner = {
          callId,
          sessionId: 'native-session',
          delegationId: 'delegation',
          responseId: 'response',
        };
        await act(() => {
          DeviceEventEmitter.emit('VoiceRealtimeState', {
            callId,
            phase: 'listening',
          });
          DeviceEventEmitter.emit('VoiceRealtimeCommonToolsReady', {
            callId,
            sessionId: owner.sessionId,
            registration:
              mode === 'wrong-ack'
                ? { ...commonToolsRegistration, manifestRevision: 'wrong' }
                : commonToolsRegistration,
          });
          DeviceEventEmitter.emit('VoiceRealtimeCommonToolBatch', {
            owner,
            manifestRevision: commonToolsRegistration!.manifestRevision,
            calls: [
              {
                ...owner,
                name: 'local-health-context',
                challengeId: 'ch',
                toolCallId: 'tool',
                args: '{"topics":["measurements"],"days":7}',
              },
            ],
          });
        });
        if (mode === 'valid' || mode === 'stop-in-queue') {
          await waitFor(() =>
            expect(
              native.settleLiveCommonConversationResult,
            ).toHaveBeenCalledTimes(1),
          );
          const [id, challenge, bytes] =
            native.settleLiveCommonConversationResult.mock.calls[0]!;
          expect(native.claimLiveCommonConversationResult).toHaveBeenCalledWith(
            id,
            challenge,
            bytes,
          );
          expect(JSON.parse(bytes)).toMatchObject({
            tool: 'local-health-context',
            items: [
              { evidenceId: expect.any(String), content: expect.any(String) },
            ],
          });
          expect(bytes).not.toMatch(
            /synthetic-health-id|delegation|topics|native-session/,
          );
          if (mode === 'stop-in-queue') {
            expect(
              native.retireLiveCommonConversationResult,
            ).not.toHaveBeenCalled();
            await fireEvent.press(screen.getByTestId('voice-call-end'));
            expect(
              native.retireLiveCommonConversationResult,
            ).toHaveBeenCalledWith(id, challenge);
            await act(() => {
              finishNative?.(false);
            });
            expect(
              native.settleLiveCommonConversationResult,
            ).toHaveBeenCalledTimes(1);
          }
        } else {
          if (mode === 'source-denied')
            await waitFor(() => expect(mockAuthorize).toHaveBeenCalled());
          else expect(mockOpenData).not.toHaveBeenCalled();
          expect(
            native.claimLiveCommonConversationResult,
          ).not.toHaveBeenCalled();
          expect(
            native.settleLiveCommonConversationResult,
          ).not.toHaveBeenCalled();
        }
        expect(onSend).not.toHaveBeenCalled();
        expect(
          screen.queryByTestId('live-tool-confirmation-inline'),
        ).toBeNull();
      } finally {
        await result.unmount();
      }
    } finally {
      Object.defineProperty(Platform, 'OS', os);
      AppState.currentState = previous[0];
      NativeModules.VoiceRealtimeModule = previous[1];
      audio.close();
      storage.close();
    }
  },
);
