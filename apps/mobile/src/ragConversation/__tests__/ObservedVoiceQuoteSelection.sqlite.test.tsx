import { t } from '../../i18n';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { ConversationObservedVoiceQuote } from '../ConversationObservedVoiceQuote';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { conversationHistoryRecoveryProps } from '../conversationHistoryRecoveryProps';
import { createConversationSessions } from '../conversationSessions';

const stamp = '2030-01-01T00:00:00.000Z';
const callId = 'live-12345-42';
const text = 'Synthetic observed voice fragment';
const packet = {
  callId,
  status: 'observed_incomplete',
  lines: [{ order: 1, role: 'user', text }],
};
const waitGate = () => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => {
    release = resolve;
  });
  return { release, ready };
};

test.each(['stay', 'session-round-trip'] as const)(
  'restored voice-card tap does not revive dismissed read authority: %s',
  async scenario => {
    const f = openSqliteTestDatabase(':memory:');
    const prior = AppState.currentState;
    AppState.currentState = 'active';
    const reached = waitGate();
    const continueRead = waitGate();
    try {
      await runMigrations(f.database);
      const storage = createConversationArtifactStorage(f.database);
      const read = async (
        ...args: Parameters<typeof storage.readExplicitObservedVoiceQuote>
      ) => {
        reached.release();
        await continueRead.ready;
        return storage.readExplicitObservedVoiceQuote(...args);
      };
      let next = 0;
      const create = (reopening = false) => {
        const owned = createConversationSessionRetention({
          openStorage: async () =>
            reopening
              ? { ...storage, readExplicitObservedVoiceQuote: read }
              : storage,
          createId: () => 'synthetic-voice-owner-' + ++next,
          now: () => stamp,
        });
        return {
          owned,
          store: createConversationSessions({
            retention: owned,
            restoreSession: async () => [],
            restoreTasks: async id =>
              storage.readTaskCards(
                id,
                (await storage.activeSessionVersion(id))!,
              ),
          }),
        };
      };
      const original = create(),
        reopened = create(true);
      try {
        const first = original.store.getSnapshot().activeId;
        await original.store.captureVoiceEnd(first, callId)!(
          { callId, durationSeconds: 18 },
          packet,
          () => true,
        );
        const lease = original.owned.activeLease(first)!;
        const id = await reopened.store.attachExisting(
          lease.id,
          lease.version,
          stamp,
          true,
        );
        const owned = reopened.store
          .getSnapshot()
          .sessions.find(item => item.id === id)!;
        const [marker] = conversationHistoryRecoveryProps(
          owned,
          reopened.store,
        ).voiceEndCards!;
        if (
          !marker ||
          !('observedQuote' in marker) ||
          typeof marker.observedQuote !== 'function'
        )
          throw new Error(
            'Exact restored marker did not expose its fragment read.',
          );
        const quote = await render(
          <ConversationObservedVoiceQuote read={marker.observedQuote} />,
        );
        try {
          await fireEvent.press(
            quote.getByRole('button', { name: '저장된 자막 보기' }),
          );
          await reached.ready;
          if (scenario === 'session-round-trip') {
            reopened.store.create();
            expect(reopened.store.getSnapshot().activeId).not.toBe(id);
            reopened.store.select(id!);
            expect(reopened.store.getSnapshot().activeId).toBe(id);
          }
          continueRead.release();
          if (scenario === 'stay') {
            await waitFor(() =>
              expect(quote.getByText(new RegExp(text))).toBeTruthy(),
            );
          } else {
            await waitFor(() =>
              expect(
                quote.getByText(
                  t('ragConversation.voice.unavailableObservedCaptions'),
                ),
              ).toBeTruthy(),
            );
            expect(quote.queryByText(new RegExp(text))).toBeNull();
          }
          expect(
            await storage.readObservedVoiceCaptions(
              lease.id,
              lease.version,
              'voice-end:' + callId,
            ),
          ).toEqual(packet);
        } finally {
          await quote.unmount();
        }
      } finally {
        original.store.dispose();
        reopened.store.dispose();
      }
    } finally {
      continueRead.release();
      AppState.currentState = prior;
      f.close();
    }
  },
  20_000,
);
