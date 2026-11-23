import { AppState } from 'react-native';
import { createDailyReportIdentity } from '@orot/domain';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { publishDailyReportMemoryTap } from '../../storage/dailyReportMemoryTap';
import { dailyReportMemoryTapFor } from '../conversationDailyReportMemoryJobs';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';
import { startConversationReportTurn } from '../startConversationReportTurn';

test.each(['stay', 'switch', 'round-trip'] as const)(
  'committed answer appears before optional write: %s',
  async navigation => {
    const before = AppState.currentState;
    AppState.currentState = 'active';
    const context = openSqliteTestDatabase(':memory:');
    await runMigrations(context.database);
    const db = createConversationArtifactStorage(context.database);
    let release!: () => void;
    let started!: () => void;
    let settled!: () => void;
    const hold = new Promise<void>(resolve => {
      release = resolve;
    });
    const entered = new Promise<void>(resolve => {
      started = resolve;
    });
    const done = new Promise<void>(resolve => {
      settled = resolve;
    });
    const acceptedWrite = jest.fn();
    const bookmark = jest.fn(
      async (input: Parameters<typeof db.bookmarkCompletedDailyReport>[0]) => {
        started();
        await hold;
        const accepted = input.current();
        if (accepted) acceptedWrite(input.artifactId);
        settled();
        return accepted;
      },
    );
    let ids = 0;
    const store = createConversationSessions({
      retention: createConversationSessionRetention({
        openStorage: async () => ({
          ...db,
          bookmarkCompletedDailyReport: bookmark,
        }),
        createId: () => 'synthetic-' + ++ids,
        now: () => '2035-01-01T12:00:00.000Z',
      }),
    });
    try {
      publishDailyReportMemoryTap({
        database: context.database,
        sqlGeneration: 1,
        deviceGeneration: 'synthetic',
        current: () => true,
      });
      const send: Parameters<typeof startConversationReportTurn>[2] = async (
        question,
        _history,
        signal,
        observer,
      ) => {
        const tap = dailyReportMemoryTapFor(observer);
        const stage = tap && observer?.admitDailyReportMemory?.(tap);
        if (!stage || !signal || !observer?.onRetentionCandidate)
          throw new Error('Exact live test request missing local owner');
        await observer.onRetentionCandidate(
          {
            question,
            answer: 'Synthetic persisted answer',
            providerId: 'synthetic',
            modelId: 'synthetic',
            citations: [],
            sources: [],
          },
          signal,
        );
        stage({
          identity: createDailyReportIdentity('2035-01-01', 'UTC'),
          runId: 'synthetic-run',
          revision: 1,
        });
        return {
          status: 'answer',
          answer: 'Synthetic persisted answer',
          citations: [],
        };
      };
      await startConversationReportTurn(
        store,
        () => true,
        send,
        undefined,
        'direct-user-tap',
      );
      expect(store.getSnapshot().sessions[0]?.messages.at(-1)?.content).toBe(
        'Synthetic persisted answer',
      );
      await entered;
      expect(bookmark).toHaveBeenCalledTimes(1);
      expect(bookmark.mock.calls[0]?.[0].current()).toBe(true);
      expect(store.getSnapshot().sessions[0]?.busy).toBe(false);
      const original = store.getSnapshot().activeId;
      if (navigation !== 'stay') {
        store.create();
        const next = store.getSnapshot().activeId;
        expect(next).not.toBe(original);
        expect(
          store
            .getSnapshot()
            .sessions.find(row => row.id === original)
            ?.messages.at(-1)?.content,
        ).toBe('Synthetic persisted answer');
        expect(
          store.getSnapshot().sessions.find(row => row.id === next)?.messages,
        ).toEqual([]);
        expect(bookmark.mock.calls[0]?.[0].current()).toBe(false);
        if (navigation === 'round-trip') {
          store.select(original);
          expect(store.getSnapshot().activeId).toBe(original);
          expect(bookmark.mock.calls[0]?.[0].current()).toBe(false);
        }
      }
      release();
      await done;
      expect(acceptedWrite).toHaveBeenCalledTimes(
        navigation === 'stay' ? 1 : 0,
      );
    } finally {
      release();
      publishDailyReportMemoryTap();
      store.dispose();
      AppState.currentState = before;
      context.close();
    }
  },
);
