import { createRecordRepository, runMigrations } from '@orot/storage';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { reference } from '../../diseaseHypotheses/taskTestSupport';
import { createConversationTurnRetention } from '../../ragConversation/conversationTurnRetention';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

/** Synthetic bridge-call profile, not a device latency claim. Only count/time/query-shape leave the test. */
test.each([100, 1000])(
  'profiles saving a conversation with %i retained source members',
  async count => {
    const f = createHealthEvidenceTestDatabase();
    try {
      await runMigrations(f.database);
      const repository = createRecordRepository(f.database);
      const members = [];
      for (let index = 0; index < count; index++) {
        const record = healthObservation(
          `sample-${index}`,
          'heart_rate',
          '2026-10-01T01:00:00Z',
        );
        await repository.put('health_observation', record);
        members.push({
          kind: 'health_observation' as const,
          id: record.id,
          revision: fingerprint(record),
        });
      }
      let active = false;
      const profile = new Map<string, { count: number; ms: number }>();
      const wrap = (executor: SqlExecutor): SqlExecutor => ({
        execute: async (sql, parameters) => {
          const start = performance.now();
          try {
            return await executor.execute(sql, parameters);
          } finally {
            if (active) {
              const key = sql.replace(/\s+/g, ' ').slice(0, 100);
              const previous = profile.get(key) ?? { count: 0, ms: 0 };
              previous.count++;
              previous.ms += performance.now() - start;
              profile.set(key, previous);
            }
          }
        },
      });
      const database: SqlDatabase = {
        ...wrap(f.database),
        transaction: operation =>
          f.database.transaction(tx => operation({ ...tx, ...wrap(tx) })),
      };
      const storage = createConversationArtifactStorage(database);
      await storage.createSession(
        'synthetic-save',
        await storage.currentGeneration(),
      );
      const turn = createConversationTurnRetention({
        storage,
        sessionId: 'synthetic-save',
        turnId: 'synthetic-turn',
        createdAt: '2026-10-05T00:00:00.000Z',
      });
      const signal = new AbortController().signal;
      await turn.startRequest('synthetic question', signal);
      active = true;
      const start = performance.now();
      await turn.save(
        {
          providerId: 'synthetic',
          modelId: 'synthetic',
          question: 'synthetic question',
          answer: 'synthetic answer',
          citations: [],
          sources: [
            {
              reference: {
                ...reference,
                sourceId: 'sample-0',
                evidenceId: 'sample-0',
              },
              records: members,
            },
          ],
        },
        signal,
      );
      const elapsedMs = performance.now() - start;
      active = false;
      const calls = (prefix: string) =>
        [...profile]
          .filter(([sql]) => sql.startsWith(prefix))
          .reduce((sum, [, item]) => sum + item.count, 0);
      expect(calls('INSERT OR IGNORE INTO conversation_artifact_sources')).toBe(
        1,
      );
      expect(calls('SELECT m.source_id FROM json_each')).toBe(2);

      expect(turn.hasPending()).toBe(false);
      const saved = await storage.read('synthetic-turn');
      expect(saved?.id).toBe('synthetic-turn');
      expect(saved?.sources).toHaveLength(1);
      console.info(
        JSON.stringify({
          benchmark: 'conversation_save',
          members: count,
          elapsedMs,
          sqlCount: [...profile.values()].reduce(
            (sum, value) => sum + value.count,
            0,
          ),
          queries: [...profile].sort((a, b) => b[1].count - a[1].count),
        }),
      );
    } finally {
      f.close();
    }
  },
  120000,
);
