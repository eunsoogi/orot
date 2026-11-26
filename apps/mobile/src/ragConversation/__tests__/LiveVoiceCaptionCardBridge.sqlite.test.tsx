import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState, NativeModules, Platform } from 'react-native';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { nativeLiveVoice } from '../../voiceConversation/nativeRealtimeVoice';
import {
  beginConsentReset,
  finishConsentReset,
} from '../../agent/execution/consentRevision';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { conversationHistoryRecoveryProps } from '../conversationHistoryRecoveryProps';
import { createConversationSessions } from '../conversationSessions';
import { ConversationVoiceEndMarker } from '../ConversationVoiceEndMarker';

const stamp = '2030-01-01T00:00:00.000Z';
const fragment = '합성 자막 문장';

/** Only the native promise is faked: the exact RN close adapter, consent epoch,
 * artifact sidecar, active/cold owner lookup, and production card all run. */
test.each([
  'authorized',
  'revoked',
  'revoked-in-sidecar',
  'duration-only',
] as const)(
  'live and cold duration cards admit only an owned authorized caption packet: %s',
  async scenario => {
    const f = openSqliteTestDatabase(':memory:');
    const beforeState = AppState.currentState;
    const prior = NativeModules.VoiceRealtimeModule;
    const priorDiagnostics = NativeModules.OrotProviderDiagnostics;
    const report = jest.fn(() => {
      // Even failure of the optional sink must preserve close and the DB result.
      throw new Error('Synthetic diagnostic sink failure');
    });
    NativeModules.OrotProviderDiagnostics = { report };
    AppState.currentState = 'active';
    const originalOS = Object.getOwnPropertyDescriptor(Platform, 'OS');
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    const callId = 'live-100-42';
    const duration = { callId, durationSeconds: 22 };
    const captions = {
      callId,
      status: 'observed_incomplete',
      lines: [{ order: 1, role: 'user', text: fragment }],
    };
    NativeModules.VoiceRealtimeModule = {
      openLiveCall: jest.fn(async () => {}),
      closeLiveCall: jest.fn(async () =>
        scenario === 'duration-only'
          ? duration
          : { kind: 'live_observed_close', duration, captions },
      ),
      stopRealtimeCall: jest.fn(async () => duration),
      interruptRealtimeOutput: jest.fn(),
      pauseRealtimeCall: jest.fn(),
      resumeRealtimeCall: jest.fn(),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    let stores: ReturnType<typeof createConversationSessions>[] = [];
    let revoked = false;
    try {
      await runMigrations(f.database);
      const database = f.database;
      const storage = createConversationArtifactStorage(
        scenario !== 'revoked-in-sidecar'
          ? database
          : {
              ...database,
              transaction: operation =>
                database.transaction(tx =>
                  operation({
                    ...tx,
                    async execute(sql, params) {
                      const result = await tx.execute(sql, params);
                      if (
                        sql.startsWith(
                          'INSERT INTO conversation_voice_observed_captions',
                        )
                      ) {
                        beginConsentReset();
                        revoked = true;
                      }
                      return result;
                    },
                  }),
                ),
            },
      );
      let next = 0;
      const create = () => {
        const retention = createConversationSessionRetention({
          openStorage: async () => storage,
          createId: () => 'synthetic-owned-voice-' + ++next,
          now: () => stamp,
        });
        const store = createConversationSessions({
          retention,
          restoreSession: async () => [],
          restoreTasks: async id =>
            storage.readTaskCards(
              id,
              (await storage.activeSessionVersion(id))!,
            ),
        });
        stores.push(store);
        return { store, retention };
      };
      const { store, retention } = create();
      const live = store.getSnapshot().activeId;
      const adapter = nativeLiveVoice(id => store.captureVoiceEnd(live, id))!;
      await adapter.open(
        callId,
        'gpt-live-1.1',
        'synthetic-key',
        '',
        false,
        {
          schema: 1,
          language: 'ko',
          voice: 'noeul',
        },
        () => true,
      );
      const stopping = adapter.stop(callId, true);
      if (scenario === 'revoked') {
        beginConsentReset();
        revoked = true;
      }
      await stopping;
      await waitFor(() =>
        expect(
          store.getSnapshot().sessions.find(s => s.id === live)?.taskCards,
        ).toHaveLength(1),
      );
      const lease = retention.activeLease(live)!;
      const nextOwner = create();
      const cold = await nextOwner.store.attachExisting(
        lease.id,
        lease.version,
        stamp,
        true,
      );
      expect(cold).not.toBeNull();
      for (const [selectedStore, id] of [
        [store, live],
        [nextOwner.store, cold!],
      ] as const) {
        const session = selectedStore
          .getSnapshot()
          .sessions.find(s => s.id === id)!;
        const [marker] = conversationHistoryRecoveryProps(
          session,
          selectedStore,
        ).voiceEndCards!;
        if (!marker || marker.task.kind !== 'voice_end')
          throw new Error('Missing exact duration marker');
        const ui = await render(
          <ConversationVoiceEndMarker
            task={marker.task}
            readObserved={
              'observedQuote' in marker ? marker.observedQuote : undefined
            }
          />,
        );
        try {
          expect(ui.getByText('음성 대화 종료')).toBeVisible();
          expect(ui.queryByText(new RegExp(fragment))).toBeNull();
          if (scenario === 'authorized') {
            await fireEvent.press(
              ui.getByRole('button', { name: '저장된 자막 보기' }),
            );
            expect(await ui.findByText(new RegExp(fragment))).toBeVisible();
          } else
            expect(
              ui.queryByRole('button', { name: '저장된 자막 보기' }),
            ).toBeNull();
        } finally {
          await ui.unmount();
        }
      }
      expect(report.mock.calls).toEqual(
        scenario === 'authorized'
          ? [
              ['voice_caption', 'bridge_packet', 'authorized'],
              ['voice_caption', 'sidecar', 'committed'],
            ]
          : scenario === 'revoked-in-sidecar'
            ? [
                ['voice_caption', 'bridge_packet', 'authorized'],
                ['voice_caption', 'sidecar', 'authority_lost'],
              ]
            : [
                [
                  'voice_caption',
                  'bridge_packet',
                  scenario === 'revoked' ? 'authority_lost' : 'unavailable',
                ],
              ],
      );
      const saved = await storage.readObservedVoiceCaptions(
        lease.id,
        lease.version,
        'voice-end:' + callId,
      );
      expect(saved).toEqual(scenario === 'authorized' ? captions : undefined);
    } finally {
      stores.forEach(store => store.dispose());
      if (revoked) finishConsentReset();
      AppState.currentState = beforeState;
      if (originalOS) Object.defineProperty(Platform, 'OS', originalOS);
      if (priorDiagnostics)
        NativeModules.OrotProviderDiagnostics = priorDiagnostics;
      else delete NativeModules.OrotProviderDiagnostics;
      if (prior) NativeModules.VoiceRealtimeModule = prior;
      else delete NativeModules.VoiceRealtimeModule;
      f.close();
    }
  },
);
