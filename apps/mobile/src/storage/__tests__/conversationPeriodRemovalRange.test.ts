import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { isPeriodSummarySource } from '../../diseaseHypotheses/savedSummaries';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { assertPeriodNotRemoved } from '../conversationPeriodRemoval';

/** Exercise the emitted production SQL and real schema, not a hand-written substitute query. */
test('period removal keeps indexed bounds for generic measurements and workout overlaps', async () => {
  const f = await healthContextFixture();
  const planDb = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(planDb.database);
    await createConversationArtifactStorage(
      planDb.database,
    ).currentGeneration();
    const source = f.saved.sources.find(isPeriodSummarySource)!;
    const plans: string[] = [];
    const previousPlans: string[] = [];
    await assertPeriodNotRemoved(
      {
        execute: async (sql, bindings) => {
          if (sql.includes('health_observations h')) {
            const plan = await planDb.database.execute(
              `EXPLAIN QUERY PLAN ${sql}`,
              bindings,
            );
            plans.push(...plan.rows.map(row => String(row.detail)));
            const old = sql.replace(
              /FROM (\(SELECT \? AS topic, \? AS from_key, \? AS to_key\) p) CROSS JOIN (\w+ h) WHERE/,
              'FROM $2 CROSS JOIN $1 WHERE',
            );
            const previous = await planDb.database.execute(
              `EXPLAIN QUERY PLAN ${old}`,
              bindings,
            );
            previousPlans.push(...previous.rows.map(row => String(row.detail)));
          }
          return planDb.database.execute(sql, bindings);
        },
      },
      source,
    );
    expect(
      plans.some(plan =>
        /health_context_observation_time.*<expr>>\?.*<expr><\?/.test(plan),
      ),
    ).toBe(true);
    expect(
      plans.some(plan =>
        /health_context_quantity_time.*<expr>=\?.*<expr><\?/.test(plan),
      ),
    ).toBe(true);
    expect(
      previousPlans.some(plan =>
        /health_context_observation_time.*<expr>>\?.*<expr><\?/.test(plan),
      ),
    ).toBe(false);
  } finally {
    planDb.close();
    f.close();
  }
});

const cases = [
  ['measurements', 'blood_glucose', '2026-10-01T01:00:00Z', null, true],
  ['measurements', 'body_temperature', '2026-09-30T23:59:59Z', null, false],
  [
    'measurements',
    'workout_duration',
    '2026-09-30T23:00:00Z',
    '2026-10-01T01:00:00Z',
    true,
  ],
  [
    'measurements',
    'workout_duration',
    '2026-09-30T23:00:00Z',
    '2026-10-01T00:00:00Z',
    false,
  ],
  [
    'activity',
    'workout_duration',
    '2026-10-01T01:00:00Z',
    '2026-10-01T02:00:00Z',
    true,
  ],
  [
    'sleep',
    'HKCategoryTypeIdentifierSleepAnalysis',
    '2026-09-30T23:00:00Z',
    '2026-10-01T01:00:00Z',
    true,
  ],
  ['measurements', 'heart_rate', '2026-10-01T01:00:00Z', null, true],
  ['measurements', 'heart_rate', '2026-09-30T23:59:59Z', null, false],
  ['activity', 'step_count', '2026-10-04T23:59:59Z', null, true],
  ['activity', 'step_count', '2026-10-05T00:00:00Z', null, false],
  ['sleep', 'sleep', '2026-09-30T23:00:00Z', '2026-10-01T01:00:00Z', true],
  ['sleep', 'sleep', '2026-09-30T23:00:00Z', '2026-10-01T00:00:00Z', false],
  ['sleep', 'sleep', '2026-10-01T01:00:00Z', null, false],
  ['measurements', 'heart_rate', '2026-10-01T09:00:00+09:00', null, true],
] as const;

test.each(cases)(
  'keeps %s contributor semantics at %s/%s/%s',
  async (topic, concept, at, end, removed) => {
    const f = await healthContextFixture();
    try {
      await createConversationArtifactStorage(f.database).currentGeneration();
      const base = f.saved.sources.find(isPeriodSummarySource)!;
      await f.database.execute(
        "UPDATE health_observations SET effective_at = ?, payload_json = json_set(payload_json, '$.concept', ?, '$.endedAt', ?) WHERE id = ?",
        [at, concept, end, f.inside.id],
      );
      const source = { ...base, scope: { ...base.scope, topic } };
      for (const marker of [
        'source_deletion_tombstones',
        'agent_memory_removed_sources',
      ]) {
        await f.database.execute(
          `INSERT INTO ${marker}(source_id) VALUES (?)`,
          [f.inside.id],
        );
        const observed: boolean[] = [];
        const check = assertPeriodNotRemoved(
          {
            execute: async (sql, bindings) => {
              // Only swap the CROSS JOIN inputs back to the previous production ordering.
              const old = sql.replace(
                /FROM (\(SELECT \? AS topic, \? AS from_key, \? AS to_key\) p) CROSS JOIN (\w+ h) WHERE/,
                'FROM $2 CROSS JOIN $1 WHERE',
              );
              const result = await f.database.execute(sql, bindings);
              const previous = await f.database.execute(old, bindings);
              expect(Boolean(result.rows.length)).toBe(
                Boolean(previous.rows.length),
              );
              observed.push(Boolean(result.rows.length));
              return result;
            },
          },
          source,
        );
        if (removed)
          await expect(check).rejects.toThrow('period source was removed');
        else await expect(check).resolves.toBeUndefined();
        expect(observed.length).toBeGreaterThan(0);
        await f.database.execute(`DELETE FROM ${marker} WHERE source_id = ?`, [
          f.inside.id,
        ]);
      }
    } finally {
      f.close();
    }
  },
);
