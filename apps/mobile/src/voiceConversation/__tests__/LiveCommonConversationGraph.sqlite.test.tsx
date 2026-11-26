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
import { bindHealthContextTool } from '../../aiFeatures/integration/bindHealthContextTool';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { ragConversationTask } from '../../ragConversation/task';
import { fixture as conversationFixture } from '../../ragConversation/testSupport/conversationEnvelopeFixtures';
import { fixture as protectedFixture } from '../testSupport/liveResponsesProtectedFixture';
import { openLiveAudioSettingsFixture } from '../testSupport/liveAudioSettingsFixture';
import type { LiveCommonConversationPort } from '../liveCommonConversationRun';
import { LiveConversationVoiceEntry } from '../LiveConversationVoiceEntry';
import type { ConversationVoiceProps } from '../conversationVoiceDependencies';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../voiceSettings/voiceSettingsStore', () => ({
  voiceSettingsStore: { subscribe: () => () => {} },
}));
jest.mock('../../voiceSettings/liveVoicePreferencesKeychain', () => ({
  loadLiveCallSettings: async () => ({
    model: mockLiveVoiceModelId,
    apiKey: 'synthetic-no-network-key',
    credentialEpoch: 'test-epoch',
    preferences: { schema: 1, language: 'auto', voice: 'default' },
  }),
}));

test.each(['granted', 'grant-denied', 'source-denied', 'stop'] as const)(
  'actual Live entry uses guarded ordinary local tool graph only with current verified authority: %s',
  async mode => {
    const settings = openLiveAudioSettingsFixture();
    const protectedDb = await protectedFixture();
    const previous = {
      phase: AppState.currentState,
      os: Object.getOwnPropertyDescriptor(Platform, 'OS')!,
      native: NativeModules.VoiceRealtimeModule,
    };
    AppState.currentState = 'active';
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    const native = {
      openLiveCall: jest.fn(async (_id: string) => {}),
      closeLiveCall: jest.fn(async () => ({})),
      stopRealtimeCall: jest.fn(async () => {}),
      interruptRealtimeOutput: jest.fn(),
      pauseRealtimeCall: jest.fn(),
      resumeRealtimeCall: jest.fn(),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    NativeModules.VoiceRealtimeModule = native;
    const health = bindHealthContextTool(
      { readHealthContext: protectedDb.read },
      new LocalEvidenceReferenceRegistry(),
      'rag',
    )!;
    const ordinary = conversationFixture();
    let acceptNative:
      Parameters<LiveCommonConversationPort['subscribe']>[1] | undefined;
    let released: (() => void) | undefined;
    const prepared = jest.fn<
      ReturnType<LiveCommonConversationPort['prepareSettlement']>,
      Parameters<LiveCommonConversationPort['prepareSettlement']>
    >();
    const settle = jest.fn(async (current: () => boolean) => {
      expect(current()).toBe(true);
    });
    prepared.mockImplementation(async () => ({
      remoteCurrent: () => mode !== 'source-denied',
      settle,
    }));
    const common: LiveCommonConversationPort = {
      commonToolsPolicy: 'common-tools-v3',
      current: () => mode !== 'grant-denied',
      protectedDataAvailable: async () => true,
      subscribe(_callId, accept) {
        acceptNative = accept;
        return () => {
          acceptNative = undefined;
        };
      },
      prepareSettlement: prepared,
    };
    const store = {
      getSnapshot: () => ({ activeId: 1, sessions: [{ id: 1 }] }),
      photoDrafts: { get: () => ({ status: 'empty' }) },
    } as unknown as ConversationVoiceProps['store'];
    const onSend = jest.fn();
    try {
      await settings.seed({ audio: true, tool: false, wrongRecipient: false });
      const view = await render(
        <SettingsConsentReadServicesContext.Provider
          value={{
            resolveOwner: async () => ({
              slot: 'voice',
              domain: 'model',
              identity: settings.identity,
              isCurrent: () => true,
            }),
            readGrant: settings.repo.read,
          }}
        >
          <LiveConversationVoiceEntry
            sessionId={1}
            selectionRevision={0}
            busy={false}
            photoPending={false}
            store={store}
            resolveSelectedAi={jest.fn()}
            onSend={onSend}
            liveCommonTools={common}
          />
        </SettingsConsentReadServicesContext.Provider>,
      );
      try {
        await fireEvent.press(screen.getByTestId('conversation-voice-control'));
        await waitFor(() =>
          expect(native.openLiveCall).toHaveBeenCalledTimes(1),
        );
        const callId = native.openLiveCall.mock.calls[0]![0];
        const owner = {
          callId,
          sessionId: 'native-session',
          delegationId: 'delegation',
          responseId: 'response',
        };
        const call = {
          ...owner,
          challengeId: 'challenge',
          toolCallId: 'tool-id',
          name: health.id,
          args: JSON.stringify({ topics: ['measurements'], days: 7 }),
        };
        const select = jest.fn(async declarations => {
          expect(
            declarations.map((tool: { name: string }) => tool.name),
          ).toEqual([health.id]);
          if (mode === 'stop')
            await new Promise<void>(resolve => {
              released = resolve;
            });
          return { owner, calls: [call] };
        });
        await act(() => {
          DeviceEventEmitter.emit('VoiceRealtimeState', {
            callId,
            phase: 'listening',
          });
          acceptNative?.({
            owner,
            utterance: { kind: 'context-free', current: () => true },
            workflow: {
              ...ordinary.options.workflow,
              execution: {
                ...ordinary.options.workflow.execution,
                allowedScope: { sourceKinds: ['personal_record'] },
              },
              provider: {
                ...ordinary.options.workflow.provider,
                capabilities: {
                  ...ordinary.options.workflow.provider.capabilities,
                  toolCalling: true,
                },
              },
              request: 'Synthetic app-owned voice turn',
              task: ragConversationTask,
              initialEvidence: { items: [], coverage: [], conflicts: [] },
              tools: [health],
            },
            select,
            nativeChallengeCurrent: candidate =>
              candidate.toolCallId === call.toolCallId,
          });
        });
        if (mode === 'granted' || mode === 'source-denied') {
          await waitFor(() => expect(prepared).toHaveBeenCalledTimes(1));
          expect(protectedDb.read).toHaveBeenCalled();
          expect(prepared.mock.calls[0]![0].call).not.toHaveProperty('args');
          expect(prepared.mock.calls[0]![0]).toMatchObject({
            status: 'evidence_references',
            call: {
              ...owner,
              challengeId: call.challengeId,
              toolCallId: call.toolCallId,
            },
            result: { contentLocation: 'current_task_messages' },
          });
          expect(JSON.stringify(prepared.mock.calls[0]![0])).not.toContain(
            'synthetic-health-id',
          );
        } else if (mode === 'stop') {
          await waitFor(() => expect(select).toHaveBeenCalledTimes(1));
          await fireEvent.press(screen.getByTestId('voice-call-end'));
          await act(() => released?.());
        } else {
          expect(acceptNative).toBeUndefined();
          expect(select).not.toHaveBeenCalled();
        }
        expect(settle).toHaveBeenCalledTimes(mode === 'granted' ? 1 : 0);
        if (mode === 'grant-denied' || mode === 'stop') {
          expect(protectedDb.read).not.toHaveBeenCalled();
          expect(prepared).not.toHaveBeenCalled();
        }
        expect(ordinary.generate).not.toHaveBeenCalled();
        expect(onSend).not.toHaveBeenCalled();
        expect(
          screen.queryByTestId('live-tool-confirmation-inline'),
        ).toBeNull();
      } finally {
        await view.unmount();
      }
    } finally {
      AppState.currentState = previous.phase;
      Object.defineProperty(Platform, 'OS', previous.os);
      NativeModules.VoiceRealtimeModule = previous.native;
      settings.close();
      protectedDb.close();
    }
  },
);
