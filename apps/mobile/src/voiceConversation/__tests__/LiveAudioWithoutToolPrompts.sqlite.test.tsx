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
import { liveVoiceModelId } from '../../agent/execution/liveVoiceSettingsIdentity';
import { openLiveAudioSettingsFixture } from '../testSupport/liveAudioSettingsFixture';
import { LiveConversationVoiceEntry } from '../LiveConversationVoiceEntry';
import type { ConversationVoiceProps } from '../conversationVoiceDependencies';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
const mockManagedSettings = jest.fn();
const mockCredentials = jest.fn();
jest.mock('../../voiceSettings/liveVoicePreferencesKeychain', () => ({
  loadLiveCallSettings: () => mockCredentials(),
}));
jest.mock('../../voiceSettings/liveResponsesSettings', () => ({
  loadLiveResponsesSettings: () => mockManagedSettings(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: () => ({
    bridgeAvailable: true,
    protectedDataAvailable: async () => true,
    subscribe: () => () => {},
  }),
}));
jest.mock('../../voiceSettings/voiceSettingsStore', () => ({
  voiceSettingsStore: { subscribe: () => () => {} },
}));
jest.mock('../../aiFeatures/integration/localData', () => {
  throw new Error(
    'Opening protected health data is forbidden in audio-only tests.',
  );
});

test.each([
  'exact audio with old aggregate',
  'exact audio with old companion',
  'exact audio with v2',
  'missing',
  'wrong recipient',
  'revoked',
] as const)(
  'real Live entry opens only independently authorized audio and creates no tool popup: %s',
  async mode => {
    const { repo, identity, managed, epoch, close, seed } =
      openLiveAudioSettingsFixture();
    const prior = {
      phase: AppState.currentState,
      os: Object.getOwnPropertyDescriptor(Platform, 'OS')!,
      native: NativeModules.VoiceRealtimeModule,
    };
    AppState.currentState = 'active';
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    jest.clearAllMocks();
    let consentCurrent = mode !== 'revoked';
    const readGrant = jest.fn(repo.read);
    const native = {
      openLiveCall: jest.fn(
        async (
          _id: string,
          _model: string,
          _key: string,
          _options: unknown,
        ) => {},
      ),
      closeLiveCall: jest.fn(async () => ({})),
      stopRealtimeCall: jest.fn(async () => {}),
      interruptRealtimeOutput: jest.fn(),
      pauseRealtimeCall: jest.fn(),
      resumeRealtimeCall: jest.fn(),
      supportsCanonicalHealthContextV2: true,
      supportsLiveAggregateHeadlessV2: true,
      addListener: jest.fn(),
      removeListeners: jest.fn(),
      claimLiveResponsesResult: jest.fn(),
      retireLiveResponsesResult: jest.fn(),
      settleLiveResponsesToolCall: jest.fn(),
      revokeLiveResponsesGrant: jest.fn(async () => {}),
      reviewCanonicalLiveCall: jest.fn(async () => true),
      retireCanonicalLiveReview: jest.fn(async () => {}),
    };
    NativeModules.VoiceRealtimeModule = native;
    mockCredentials.mockResolvedValue({
      model: liveVoiceModelId,
      apiKey: 'synthetic-no-network-key',
      credentialEpoch: epoch,
      preferences: { schema: 1, language: 'auto', voice: 'default' },
    });
    const ready = mode.startsWith('exact audio');
    const headless = mode === 'exact audio with v2';
    const v2 = { ...managed, scope: 'selected-live-heart-rate-aggregate-v2' };
    const store = {
      getSnapshot: () => ({ activeId: 1, sessions: [{ id: 1 }] }),
      photoDrafts: { get: () => ({ status: 'empty' }) },
    } as unknown as ConversationVoiceProps['store'];
    try {
      await seed({
        audio: mode !== 'missing',
        tool: ready,
        headless,
        wrongRecipient: mode === 'wrong recipient',
      });
      mockManagedSettings.mockImplementation(async () =>
        (await repo.read('voice-responses'))
          ? {
              kind: 'active',
              credentialEpoch: epoch,
              nativeGrant: headless ? v2 : managed,
              aggregatePolicy: headless ? 'headless-v2' : undefined,
              current: () => true,
              subscribe: () => () => {},
            }
          : { kind: 'off' },
      );
      const view = await render(
        <SettingsConsentReadServicesContext.Provider
          value={{
            resolveOwner: async () => ({
              slot: 'voice',
              domain: 'model',
              identity,
              isCurrent: () => consentCurrent,
            }),
            readGrant,
          }}
        >
          <LiveConversationVoiceEntry
            sessionId={1}
            selectionRevision={0}
            busy={false}
            photoPending={false}
            store={store}
            resolveSelectedAi={jest.fn()}
            onSend={jest.fn()}
          />
        </SettingsConsentReadServicesContext.Provider>,
      );
      await fireEvent.press(screen.getByTestId('conversation-voice-control'));
      await waitFor(() =>
        expect(readGrant).toHaveBeenCalledWith('voice', 'model'),
      );
      if (ready)
        await waitFor(() =>
          expect(native.openLiveCall).toHaveBeenCalledTimes(1),
        );
      expect(native.reviewCanonicalLiveCall).not.toHaveBeenCalled();
      if (ready) {
        const [id] = native.openLiveCall.mock.calls[0]!;
        expect(native.openLiveCall).toHaveBeenCalledWith(
          id,
          liveVoiceModelId,
          'synthetic-no-network-key',
          {
            language: 'auto',
            voice: 'default',
          },
        );
        await act(async () => {
          DeviceEventEmitter.emit('VoiceRealtimeState', {
            callId: id,
            phase: 'listening',
          });
          if (!headless)
            DeviceEventEmitter.emit('VoiceRealtimeManagedToolCall', {
              callId: id,
              sessionId: '1',
              challengeId: 'challenge',
              toolCallId: 'tool',
              responseId: 'response',
              delegationId: 'delegation',
              name: 'orot_health_context',
              args: '{"topic":"measurements","days":7}',
            });
        });
        expect(
          screen.getByText('듣고 있어요. 잠시 멈추면 답변을 준비해요.'),
        ).toBeTruthy();
        expect(screen.getByTestId('voice-call-end')).toBeTruthy();
        await fireEvent.press(screen.getByTestId('voice-call-end'));
      } else {
        expect(mockCredentials).not.toHaveBeenCalled();
        expect(native.openLiveCall).not.toHaveBeenCalled();
      }
      expect(screen.queryByTestId('live-tool-confirmation-inline')).toBeNull();
      expect(
        screen.queryByText('이번 통화에서 건강 기록 도구를 사용할까요?'),
      ).toBeNull();
      expect(native.claimLiveResponsesResult).not.toHaveBeenCalled();
      expect(native.settleLiveResponsesToolCall).not.toHaveBeenCalled();
      await view.unmount();
    } finally {
      consentCurrent = false;
      AppState.currentState = prior.phase;
      Object.defineProperty(Platform, 'OS', prior.os);
      NativeModules.VoiceRealtimeModule = prior.native;
      close();
    }
  },
);
