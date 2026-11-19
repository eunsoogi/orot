const { performance } = require('node:perf_hooks') as {
  performance: { now(): number };
};
import { runMigrations, type SqlDatabase, type SqlValue } from '@orot/storage';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { assertPeriodNotRemoved } from '../conversationPeriodRemoval';
import { reference } from '../../diseaseHypotheses/taskTestSupport';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import type { SavedPeriodSummarySource } from '../../diseaseHypotheses/savedSummaries';

type Statement = {
  all(...bindings: SqlValue[]): Record<string, SqlValue>[];
  run(...bindings: SqlValue[]): { changes: number | bigint };
};
type Handle = {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  close(): void;
};
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => Handle;
};

/** Pure synthetic Node SQLite decomposition, not SQLCipher/bridge timing or a
 * proposed native statement cache. Identical emitted SQL is prepared/stepped. */
test('separate period membership SQLite preparation from VM execution', async () => {
  const handle = new DatabaseSync(':memory:');
  const database: SqlDatabase = {
    execute: async (sql, bindings = []) => {
      const statement = handle.prepare(sql);
      if (/^\s*(SELECT|PRAGMA|EXPLAIN)\b/i.test(sql))
        return { rows: statement.all(...bindings) };
      return {
        rows: [],
        rowsAffected: Number(statement.run(...bindings).changes),
      };
    },
    transaction: async work => {
      handle.exec('BEGIN');
      let active = true;
      const finish = (sql: string) => {
        if (active) handle.exec(sql);
        active = false;
        return { rows: [] };
      };
      try {
        await work({
          execute: database.execute,
          commit: () => finish('COMMIT'),
          rollback: () => finish('ROLLBACK'),
        });
        finish('COMMIT');
      } catch (e) {
        finish('ROLLBACK');
        throw e;
      }
    },
  };
  const source: SavedPeriodSummarySource = {
    kind: 'health_context_period',
    reference,
    revision: 'synthetic',
    deletionGeneration: 0,
    scope: {
      kind: 'health_context_period',
      version: 1,
      topic: 'measurements',
      window: {
        fromInclusive: '2026-10-01T00:00:00Z',
        toExclusive: '2026-10-05T00:00:00Z',
        timeZone: 'UTC',
      },
    },
  };
  try {
    await runMigrations(database);
    await createConversationArtifactStorage(database).currentGeneration();
    const queries: { sql: string; bindings: SqlValue[] }[] = [];
    await assertPeriodNotRemoved(
      {
        execute: async (sql, bindings = []) => {
          queries.push({ sql, bindings });
          return { rows: [] };
        },
      },
      source,
    );
    expect(queries).toHaveLength(4);
    const base = healthObservation(
      'synthetic',
      'heart_rate',
      '2026-10-02T00:00:00Z',
    );
    for (const rows of [0, 10000]) {
      if (rows)
        await database.execute(
          `INSERT INTO health_observations(id,effective_at,recorded_at,ingested_at,payload_json)
     WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<10000)
     SELECT 'synthetic-'||i,?,?,?,json_set(?,'$.id','synthetic-'||i) FROM n`,
          [
            base.effectiveAt,
            base.recordedAt!,
            base.ingestedAt,
            JSON.stringify(base),
          ],
        );
      for (const markers of [0, 1, 100]) {
        await database.execute('DELETE FROM source_deletion_tombstones');
        await database.execute('DELETE FROM agent_memory_removed_sources');
        for (let m = 0; m < markers; m++)
          await database.execute(
            'INSERT INTO source_deletion_tombstones(source_id) VALUES (?)',
            [`unrelated-${m}`],
          );
        for (const [branch, { sql, bindings }] of queries.entries()) {
          let prepareMs = 0,
            stepMs = 0;
          const repeats = 20;
          for (let i = 0; i < repeats; i++) {
            let at = performance.now();
            const statement = handle.prepare(sql);
            prepareMs += performance.now() - at;
            at = performance.now();
            const result = statement.all(...bindings);
            stepMs += performance.now() - at;
            expect(result).toEqual([]);
          }
          const reused = handle.prepare(sql);
          let reusedStepMs = 0;
          for (let i = 0; i < repeats; i++) {
            const at = performance.now();
            const result = reused.all(...bindings);
            reusedStepMs += performance.now() - at;
            expect(result).toEqual([]);
          }
          const plan = handle
            .prepare(`EXPLAIN QUERY PLAN ${sql}`)
            .all(...bindings)
            .map(row => row.detail);
          const vm = handle.prepare(`EXPLAIN ${sql}`).all(...bindings);
          const opcodes: Record<string, number> = {};
          for (const row of vm) {
            const op = String(row.opcode);
            opcodes[op] = (opcodes[op] ?? 0) + 1;
          }
          console.info(
            'SYNTHETIC_MEMBERSHIP_PREPARE',
            JSON.stringify({
              rows,
              markers,
              branch,
              repeats,
              sqlBytes: sql.length,
              prepareMs,
              stepMs,
              reusedStepMs,
              plan,
              opcodes,
            }),
          );
        }
      }
    }
    // Reuse bytecode only: each completed .all() releases its read snapshot.
    // Full conversation schema marker triggers also advance generation; keep
    // those protections enabled while checking fresh compiled execution.
    for (const [branch, { sql, bindings }] of queries.entries()) {
      if (branch < 2) continue;
      await database.execute('DELETE FROM source_deletion_tombstones');
      await database.execute('DELETE FROM agent_memory_removed_sources');
      const marker =
        branch < 2
          ? 'source_deletion_tombstones'
          : 'agent_memory_removed_sources';
      await database.execute(
        "UPDATE health_observations SET effective_at='2026-10-02T00:00:00Z', payload_json=json_set(payload_json,'$.concept','workout_duration','$.endedAt','2026-10-03T00:00:00Z') WHERE id='synthetic-1'",
      );
      const statement = handle.prepare(sql);
      expect(statement.all(...bindings)).toEqual([]);
      const before = await database.execute(
        'SELECT mutations,deletions FROM health_context_generation',
      );
      await database.execute(
        `INSERT INTO ${marker}(source_id) VALUES ('synthetic-1')`,
      );
      const after = await database.execute(
        'SELECT mutations,deletions FROM health_context_generation',
      );
      expect(after.rows[0]?.mutations).toBe(
        Number(before.rows[0]?.mutations) + 1,
      );
      expect(after.rows[0]?.deletions).toBe(
        Number(before.rows[0]?.deletions) + 1,
      );
      expect(statement.all(...bindings).length).toBe(1);
      await database.execute(
        "UPDATE health_observations SET effective_at='2029-10-02T00:00:00Z',payload_json=json_set(payload_json,'$.endedAt','2029-10-03T00:00:00Z') WHERE id='synthetic-1'",
      );
      expect(statement.all(...bindings)).toEqual([]);
      await database.execute(
        "UPDATE health_observations SET effective_at='2026-10-02T00:00:00Z',payload_json=json_set(payload_json,'$.endedAt','2026-10-03T00:00:00Z') WHERE id='synthetic-1'",
      );
      expect(statement.all(...bindings).length).toBe(1);
      await database.execute(`DELETE FROM ${marker}`);
      expect(statement.all(...bindings)).toEqual([]);
    }
  } finally {
    handle.close();
  }
});
