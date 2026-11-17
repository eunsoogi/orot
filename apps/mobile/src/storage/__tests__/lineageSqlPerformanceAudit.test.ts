import { runMigrations, type SqlExecutor } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { assertPeriodNotRemoved } from '../conversationPeriodRemoval';
import { readRetainedRecordRows } from '../retainedRecordRows';
import { readHealthSleepContext } from '../../healthEvidence/healthContext/sleepQuery';
import { readHealthMedicationContext } from '../../healthEvidence/healthContext/medicationQuery';
import { healthContextDays } from '../../healthEvidence/healthContext/window';
import type { SavedPeriodSummarySource } from '../../diseaseHypotheses/savedSummaries';
import { reference } from '../../diseaseHypotheses/taskTestSupport';

/** Synthetic query plans/counts/timing only. No device or actual health data. */
test('audit retained ID lookup, period membership, and calendar readers at scale', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    await createConversationArtifactStorage(f.database).currentGeneration();
    const window = {
      fromInclusive: '2022-01-01T00:00:00.000Z',
      toExclusive: '2026-01-01T00:00:00.000Z',
      timeZone: 'UTC',
    };
    const source: SavedPeriodSummarySource = {
      kind: 'health_context_period',
      scope: {
        kind: 'health_context_period',
        version: 1,
        topic: 'measurements',
        window,
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
    const captured: { label: string; ms: number; plan: string[] }[] = [];
    let label = '';
    const observed: SqlExecutor = {
      execute: async (sql, bindings) => {
        const plan = await f.database.execute(
          `EXPLAIN QUERY PLAN ${sql}`,
          bindings,
        );
        const start = performance.now();
        const result = await f.database.execute(sql, bindings);
        captured.push({
          label,
          ms: performance.now() - start,
          plan: plan.rows.map(row => String(row.detail)),
        });
        return result;
      },
    };
    await f.database.execute(
      `INSERT INTO health_observations(id,effective_at,recorded_at,ingested_at,payload_json)
      WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<10000)
      SELECT 'sensor-'||i, ?, ?, ?, json_set(?, '$.id', 'sensor-'||i) FROM n`,
      [
        base.effectiveAt,
        base.recordedAt!,
        base.ingestedAt,
        JSON.stringify(base),
      ],
    );
    label = 'retained-10000';
    expect(
      (
        await readRetainedRecordRows(
          observed,
          Array.from({ length: 10000 }, (_, i) => ({
            kind: 'health_observation' as const,
            id: `sensor-${i + 1}`,
            revision: 'synthetic',
          })),
        )
      ).rows.size,
    ).toBe(10000);
    for (const count of [0, 20, 100]) {
      await f.database.execute('DELETE FROM source_deletion_tombstones');
      if (count)
        await f.database.execute(
          `INSERT INTO source_deletion_tombstones(source_id) WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<?) SELECT 'unrelated-'||i FROM n`,
          [count],
        );
      label = `membership-10000-markers-${count}`;
      await assertPeriodNotRemoved(observed, source);
    }
    const sleep = {
      ...base,
      concept: 'sleep',
      value: { kind: 'text', text: '3' },
      endedAt: '2023-01-01T08:00:00.000Z',
    };
    await f.database.execute(
      `INSERT INTO health_observations(id,effective_at,recorded_at,ingested_at,payload_json)
      WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<3000)
      SELECT 'sleep-'||i, ?, ?, ?, json_set(?, '$.id', 'sleep-'||i) FROM n`,
      [
        base.effectiveAt,
        base.recordedAt!,
        base.ingestedAt,
        JSON.stringify(sleep),
      ],
    );
    for (const days of [30, 1461]) {
      const range = {
        ...window,
        fromInclusive: '2023-01-01T00:00:00.000Z',
        toExclusive: new Date(
          Date.parse('2023-01-01T00:00:00.000Z') + days * 86400000,
        ).toISOString(),
      };
      label = `sleep-3000-days-${days}`;
      await readHealthSleepContext(observed, healthContextDays(range));
      label = `medication-empty-days-${days}`;
      await readHealthMedicationContext(observed, range);
    }
    console.info(
      JSON.stringify(captured.map(row => ({ ...row, ms: Math.round(row.ms) }))),
    );
  } finally {
    f.close();
  }
}, 120000);
