import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import {
  AppState,
  type AppStateStatus,
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
  emitFakeLiveCommonBatch,
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

test.each(['stop', 'background', 'navigate', 'callkit-background'] as const)(
  'held shared Live settlement cannot outlive its route: %s',
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
    const listeners = new Set<(phase: AppStateStatus) => void>();
    const subscription = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, listener) => {
        listeners.add(listener);
        return {
          remove: () => {
            listeners.delete(listener);
          },
        };
      });
    function transition(phase: AppStateStatus) {
      AppState.currentState = phase;
      for (const listener of [...listeners]) listener(phase);
    }
    mockOpenData.mockReset().mockResolvedValue(await storage.openData());
    mockAuthorize.mockReset().mockResolvedValue('authorized');
    mockSettings.mockResolvedValue({
      kind: 'active',
      credentialEpoch: witness.credentialEpoch,
      nativeGrant: witness,
      commonToolsPolicy: 'common-tools-v3',
      current: () => true,
      subscribe: () => () => {},
    });
    let finish: ((value: boolean) => void) | undefined;
    let activeChallenge = 'prior';
    const native = fakeLiveCommonNative(() =>
      activeChallenge === 'prior'
        ? new Promise<boolean>(resolve => {
            finish = resolve;
          })
        : Promise.resolve(true),
    );
    native.isLiveCommonConversationToolCurrent.mockImplementation(
      (_first, _second, _third, _fourth, challenge) =>
        challenge === activeChallenge,
    );
    NativeModules.VoiceRealtimeModule = native;
    let selected = 1;
    const store = {
      getSnapshot: () => ({
        activeId: selected,
        sessions: [{ id: 1 }, { id: 2 }],
      }),
      photoDrafts: { get: () => ({ status: 'empty' }) },
    } as unknown as ConversationVoiceProps['store'];
    const onSend = jest.fn();
    const view = (sessionId: number) => (
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
          sessionId={sessionId}
          selectionRevision={1}
          busy={false}
          photoPending={false}
          store={store}
          resolveSelectedAi={jest.fn()}
          onSend={onSend}
        />
      </SettingsConsentReadServicesContext.Provider>
    );
    try {
      await audio.seed({ audio: true, tool: false, wrongRecipient: false });
      const result = await render(view(1));
      try {
        await fireEvent.press(screen.getByTestId('conversation-voice-control'));
        await waitFor(() =>
          expect(native.openLiveCall).toHaveBeenCalledTimes(1),
        );
        const [callId, , , { commonToolsRegistration: registration }] =
          native.openLiveCall.mock.calls[0]!;
        if (!registration)
          throw new Error('Expected ordinary V3 startup registration');
        const emitOld = (challenge: string) => {
          DeviceEventEmitter.emit('VoiceRealtimeState', {
            callId,
            phase: 'listening',
          });
          DeviceEventEmitter.emit('VoiceRealtimeCommonToolsReady', {
            callId,
            sessionId: 'native-session',
            registration,
          });
          emitFakeLiveCommonBatch(callId, registration, challenge);
        };
        await act(() => {
          if (mode === 'callkit-background')
            DeviceEventEmitter.emit('VoiceRealtimeSystemCall', {
              callId,
              active: true,
            });
          emitOld('prior');
        });
        await waitFor(() =>
          expect(
            native.settleLiveCommonConversationResult,
          ).toHaveBeenCalledTimes(1),
        );
        expect(
          native.retireLiveCommonConversationResult,
        ).not.toHaveBeenCalled();
        if (mode === 'stop')
          await fireEvent.press(screen.getByTestId('voice-call-end'));
        else if (mode === 'navigate') {
          selected = 2;
          await result.rerender(view(2));
        } else await act(() => transition('background'));
        expect(native.retireLiveCommonConversationResult).toHaveBeenCalledWith(
          callId,
          'prior',
        );
        if (mode === 'callkit-background')
          expect(native.closeLiveCall).not.toHaveBeenCalled();
        if (mode === 'navigate') {
          selected = 1;
          await result.rerender(view(1));
        } else if (mode !== 'stop') await act(() => transition('active'));
        await act(() => {
          finish?.(true); // The late native result cannot reattach the old owner.
          emitOld('prior');
        });
        expect(native.claimLiveCommonConversationResult).toHaveBeenCalledTimes(
          1,
        );
        expect(native.settleLiveCommonConversationResult).toHaveBeenCalledTimes(
          1,
        );
        expect(mockOpenData).toHaveBeenCalledTimes(1);
        if (mode === 'callkit-background') {
          await act(() => {
            activeChallenge = 'fresh-after-return';
            emitOld(activeChallenge);
          });
          await waitFor(() =>
            expect(
              native.settleLiveCommonConversationResult,
            ).toHaveBeenCalledTimes(2),
          );
          expect(
            native.claimLiveCommonConversationResult.mock.calls[1]?.[1],
          ).toBe('fresh-after-return');
          expect(native.closeLiveCall).not.toHaveBeenCalled();
          expect(native.openLiveCall).toHaveBeenCalledTimes(1);
        }
        expect(onSend).not.toHaveBeenCalled();
      } finally {
        await result.unmount();
      }
    } finally {
      subscription.mockRestore();
      Object.defineProperty(Platform, 'OS', os);
      AppState.currentState = previous[0];
      NativeModules.VoiceRealtimeModule = previous[1];
      audio.close();
      storage.close();
    }
  },
);
