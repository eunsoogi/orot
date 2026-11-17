const { writeFileSync } = require('node:fs') as {
  writeFileSync(path: string, value: string): void;
};
import { runMigrations, type SqlExecutor } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { assertPeriodNotRemoved } from '../conversationPeriodRemoval';
import type { SavedPeriodSummarySource } from '../../diseaseHypotheses/savedSummaries';
import { readAvailableHealthContextWindow } from '../../healthEvidence/healthContext/availableWindow';
import { reference } from '../../diseaseHypotheses/taskTestSupport';

/** Synthetic diagnostic only: report SQL work without timing assertions or real records. */
test('profile membership empty gates, marker cardinality and absent topic tables', async () => {
  const f = openSqliteTestDatabase(':memory:');
  const reports: unknown[] = [];
  try {
    await runMigrations(f.database);
    await createConversationArtifactStorage(f.database).currentGeneration();
    const source: SavedPeriodSummarySource = {
      kind: 'health_context_period',
      scope: {
        kind: 'health_context_period',
        version: 1,
        topic: 'measurements',
        window: {
          fromInclusive: '2022-01-01T00:00:00.000Z',
          toExclusive: '2026-01-01T00:00:00.000Z',
          timeZone: 'UTC',
        },
      },
      reference,
      revision: 'synthetic',
      deletionGeneration: 0,
    };
    const base = healthObservation(
      'seed',
      'heart_rate',
      '2023-01-01T00:00:00.000Z',
    );
    for (const size of [1000, 10000, 100000]) {
      await f.database.execute(
        `INSERT INTO health_observations(id,effective_at,recorded_at,ingested_at,payload_json)
        WITH RECURSIVE n(i) AS (VALUES(?) UNION ALL SELECT i+1 FROM n WHERE i<?)
        SELECT 'sensor-'||i, ?, ?, ?, json_set(?, '$.id', 'sensor-'||i) FROM n`,
        [
          size === 1000 ? 1 : size / 10 + 1,
          size,
          base.effectiveAt,
          base.recordedAt!,
          base.ingestedAt,
          JSON.stringify(base),
        ],
      );
      for (const markers of [0, 1, 100]) {
        await f.database.execute('DELETE FROM source_deletion_tombstones');
        if (markers)
          await f.database.execute(
            `INSERT INTO source_deletion_tombstones(source_id)
          WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<?)
          SELECT 'unrelated-'||i FROM n`,
            [markers],
          );
        const calls: {
          ms: number;
          sql: string;
          plan: unknown[];
          opcodes?: unknown[];
        }[] = [];
        const observed: SqlExecutor = {
          execute: async (sql, bindings) => {
            const plan = await f.database.execute(
              `EXPLAIN QUERY PLAN ${sql}`,
              bindings,
            );
            const opcodes =
              size === 1000 && markers === 0 && calls.length === 0
                ? (await f.database.execute(`EXPLAIN ${sql}`, bindings)).rows
                : undefined;
            const start = performance.now();
            const result = await f.database.execute(sql, bindings);
            calls.push({
              ms: performance.now() - start,
              sql,
              plan: plan.rows.map(row => row.detail),
              opcodes,
            });
            return result;
          },
        };
        await assertPeriodNotRemoved(observed, source);
        reports.push({ size, markers, calls });
        console.info(
          JSON.stringify({
            size,
            markers,
            calls: calls.length,
            totalMs: calls.reduce((n, c) => n + c.ms, 0),
            firstMs: calls[0]!.ms,
          }),
        );
      }
      for (const topic of [
        'medications',
        'symptoms',
        'sleep',
        'activity',
      ] as const) {
        let calls = 0;
        const observed: SqlExecutor = {
          execute: async (sql, bindings) => {
            calls++;
            return f.database.execute(sql, bindings);
          },
        };
        const start = performance.now();
        await assertPeriodNotRemoved(observed, {
          ...source,
          scope: { ...source.scope, topic },
        });
        console.info(
          JSON.stringify({
            size,
            topic,
            calls,
            totalMs: performance.now() - start,
          }),
        );
      }
    }
    // Repeated membership remains mandatory even when aggregate revision memoization hits.
    let repeatedCalls = 0;
    const repeatedStart = performance.now();
    const repeated: SqlExecutor = {
      execute: async (sql, bindings) => {
        repeatedCalls++;
        return f.database.execute(sql, bindings);
      },
    };
    for (let i = 0; i < 6; i++) await assertPeriodNotRemoved(repeated, source);
    expect(repeatedCalls).toBe(24);
    console.info(
      JSON.stringify({
        repeatedMeasurements: 6,
        repeatedCalls,
        totalMs: performance.now() - repeatedStart,
      }),
    );
    let availabilityPlan: unknown[] = [];
    const availability: SqlExecutor = {
      execute: async (sql, bindings) => {
        availabilityPlan = (
          await f.database.execute(`EXPLAIN QUERY PLAN ${sql}`, bindings)
        ).rows;
        return f.database.execute(sql, bindings);
      },
    };
    const availableStart = performance.now();
    expect(
      await readAvailableHealthContextWindow(
        availability,
        undefined,
        '2027-01-01T00:00:00.000Z',
        'UTC',
      ),
    ).not.toBeNull();
    console.info(
      JSON.stringify({
        availabilityMs: performance.now() - availableStart,
        availabilityPlan,
      }),
    );
    // Reopening a pre-index backup builds derived indexes without rewriting rows.
    await f.database.execute('DROP INDEX health_observations_period_singleton');
    await f.database.execute('DROP INDEX health_observations_period_fallback');
    const migrationStart = performance.now();
    await createConversationArtifactStorage(f.database).currentGeneration();
    console.info(
      JSON.stringify({
        indexBuild100000Ms: performance.now() - migrationStart,
      }),
    );
    expect(
      (
        await f.database.execute(
          'SELECT count(*) AS n FROM health_observations',
        )
      ).rows[0]?.n,
    ).toBe(100000);
    await assertPeriodNotRemoved(f.database, source);
    writeFileSync(
      '/tmp/period-membership-profile.json',
      JSON.stringify(reports),
    );
    expect(reports).toHaveLength(9);
  } finally {
    f.close();
  }
}, 120000);
