import { runMigrations } from '@orot/storage';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

// Synthetic full terminal-event writes must retain every dependency with constant SQL call count.
// Timing is diagnostic only; assertions do not depend on host speed.
test('profiles terminal tool writes with all retained record dependencies', async () => {
  for (const count of [1000, 4000]) {
    const { database, close } = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(database);
      const records: {
        kind: 'health_observation';
        id: string;
        revision: string;
      }[] = [];
      await database.transaction(async tx => {
        for (let i = 0; i < count; i++) {
          const record = healthObservation(
            `sample-${i}`,
            'heart_rate',
            '2026-10-01T00:00:00Z',
          );
          records.push({
            kind: 'health_observation',
            id: record.id,
            revision: fingerprint(record),
          });
          await tx.execute(
            'INSERT INTO health_observations(id,effective_at,recorded_at,ingested_at,payload_json) VALUES(?,?,?,?,?)',
            [
              record.id,
              record.effectiveAt,
              record.recordedAt!,
              record.ingestedAt,
              JSON.stringify(record),
            ],
          );
        }
      });
      let active = false;
      const profile = new Map<
        string,
        { calls: number; rows: number; ms: number }
      >();
      const wrap = (tx: SqlExecutor): SqlExecutor => ({
        execute: async (query, parameters) => {
          const started = performance.now();
          const result = await tx.execute(query, parameters);
          if (active) {
            const key = query.includes('source_deletion_tombstones')
              ? 'tombstone-fence'
              : query.includes('agent_memory_removed_sources')
                ? 'memory-fence'
                : query.includes('sqlite_master')
                  ? 'quarantine-table-check'
                  : query.includes('SELECT id FROM legacy_symptom_deleted')
                    ? 'quarantine-all-ids'
                    : query.includes('AS source_json')
                      ? 'record-read'
                      : query.includes('transcript_artifact_staleness')
                        ? 'stale-check'
                        : query.includes(
                              'INSERT OR IGNORE INTO conversation_tool_dependencies',
                            )
                          ? 'dependency-index'
                          : 'other';
            const p = profile.get(key) ?? { calls: 0, rows: 0, ms: 0 };
            p.calls++;
            p.rows += result.rows.length;
            p.ms += performance.now() - started;
            profile.set(key, p);
          }
          return result;
        },
      });
      const observed: SqlDatabase = {
        execute: wrap(database).execute,
        transaction: operation =>
          database.transaction(tx =>
            operation({ ...tx, execute: wrap(tx).execute }),
          ),
      };
      const storage = createConversationArtifactStorage(observed);
      await storage.createSession('session', await storage.currentGeneration());
      const event = {
        version: 1 as const,
        operationRunId: 'run',
        callId: 'call',
        toolName: 'local_search',
        order: 1,
        status: 'started' as const,
        inputSummary: { sourceKind: 'personal_record' as const },
        sources: [],
      };
      const identity = {
        sessionId: 'session',
        messageId: 'message',
        createdAt: '2026-11-06T00:00:00.000Z',
        sessionVersion: 0,
      };
      await storage.appendToolEvent({ ...identity, event });
      const reference = {
        sourceKind: 'personal_record' as const,
        sourceId: 'group',
        sourceRevision: '1',
        evidenceId: 'group-evidence',
        evidenceRevision: '1',
        effectiveTime: null,
        reviewState: 'unknown' as const,
        locator: null,
      };
      active = true;
      const start = performance.now();
      await storage.appendToolEvent({
        ...identity,
        event: {
          ...event,
          status: 'completed',
          resultSummary: { referenceCount: 1 },
          sources: [reference],
        },
        dependencies: [{ reference, records }],
      });
      active = false;
      console.info(
        'TERMINAL_WRITE_PROFILE',
        JSON.stringify({
          count,
          totalMs: performance.now() - start,
          profile: Object.fromEntries(profile),
        }),
      );
      expect(profile.get('record-read')?.calls).toBe(1);
      expect(profile.get('dependency-index')?.calls).toBe(1);
      expect([...profile.values()].reduce((n, p) => n + p.calls, 0)).toBe(8);
      const indexed = await database.execute(
        'SELECT count(*) AS count FROM conversation_tool_dependencies',
      );
      expect(indexed.rows[0]?.count).toBe(count + 2);
    } finally {
      close();
    }
  }
}, 120000);
