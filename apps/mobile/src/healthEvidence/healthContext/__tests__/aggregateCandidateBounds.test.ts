import { runMigrations, type SqlExecutor } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { ensureHealthContextGeneration } from '../generation';
import { readAvailableHealthContextWindow } from '../availableWindow';
import { readHealthQuantityContext } from '../quantityQuery';
import { healthContextDays } from '../window';

/** Compare to the former all-candidate UNION on the same real SQLite snapshot. */
test.each([
  ['health_observations', 'health_observation'],
  ['symptom_entries', 'symptom_entry'],
  ['dose_events', 'dose_event'],
  ['medication_assertions', 'medication_assertion'],
  ['medication_definitions', 'medication_definition'],
])(
  'availability preserves exact filtered minima for %s',
  async (table, kind) => {
    const f = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(f.database);
      await ensureHealthContextGeneration(f.database);
      const at = '2023-01-01T09:00:00.0001+09:00';
      for (const [id, time, ingested] of [
        ['stale', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z'],
        ['late', '2021-01-01T00:00:00Z', '2027-01-01T00:00:00Z'],
        ['current', at, '2023-01-01T00:00:00.0001Z'],
        ['later', '2023-01-01T00:00:00.0002Z', '2023-01-01T00:00:00.0002Z'],
      ]) {
        await f.database.execute(
          `INSERT INTO ${table}(id,effective_at,recorded_at,ingested_at,payload_json) VALUES (?,?,?,?,?)`,
          [
            id!,
            time!,
            time!,
            ingested!,
            JSON.stringify({
              ...healthObservation(id!, 'heart_rate', time!),
              ingestedAt: ingested,
            }),
          ],
        );
      }
      await f.database.execute(
        `INSERT INTO transcript_artifact_staleness(transcript_id,artifact_kind,artifact_id,superseded_segment_id,current_segment_id,invalidated_at) VALUES ('t',?,'stale','a','b','2026-01-01T00:00:00Z')`,
        [kind!],
      );
      const observed: SqlExecutor = {
        execute: async (sql, bindings) => {
          const old = sql.replace(
            /SELECT \* FROM \((SELECT .*?) ORDER BY time_key LIMIT 1\)/gs,
            '$1',
          );
          const expected = await f.database.execute(old, bindings);
          const result = await f.database.execute(sql, bindings);
          expect(result.rows).toEqual(expected.rows);
          const plan = await f.database.execute(
            `EXPLAIN QUERY PLAN ${sql}`,
            bindings,
          );
          expect(
            plan.rows.filter(row =>
              /SEARCH r USING INDEX/.test(String(row.detail)),
            ),
          ).toHaveLength(5);
          return result;
        },
      };
      expect(
        await readAvailableHealthContextWindow(
          observed,
          undefined,
          '2026-01-01T00:00:00Z',
          'America/New_York',
        ),
      ).toMatchObject({ fromInclusive: at, timeZone: 'America/New_York' });
      // Reopening an imported pre-index schema rebuilds only derived indexes.
      const before = await f.database.execute(
        `SELECT * FROM ${table} ORDER BY id`,
      );
      await f.database.execute('DROP INDEX health_context_assertion_time');
      await f.database.execute('DROP INDEX health_context_registration_time');
      await ensureHealthContextGeneration(f.database);
      expect(
        (await f.database.execute(`SELECT * FROM ${table} ORDER BY id`)).rows,
      ).toEqual(before.rows);
      expect(
        await readAvailableHealthContextWindow(
          observed,
          undefined,
          '2026-01-01T00:00:00Z',
          'UTC',
        ),
      ).toMatchObject({ fromInclusive: at });
      // Exact fractional cutoff excludes a same-instant occurrence, not its successor.
      const cutoff = '2023-01-01T00:00:00.0001Z';
      const boundary = await readAvailableHealthContextWindow(
        observed,
        undefined,
        cutoff,
        'UTC',
      );
      if (kind === 'medication_definition') expect(boundary).not.toBeNull();
      else expect(boundary).toBeNull();
      await f.database.execute(`DELETE FROM ${table} WHERE id='current'`);
      expect(
        await readAvailableHealthContextWindow(
          observed,
          undefined,
          '2026-01-01T00:00:00Z',
          'UTC',
        ),
      ).toMatchObject({ fromInclusive: '2023-01-01T00:00:00.0002Z' });
      if (table === 'symptom_entries') {
        await f.database.execute(
          "INSERT INTO legacy_symptom_deleted(id) VALUES ('later')",
        );
        expect(
          await readAvailableHealthContextWindow(
            observed,
            undefined,
            '2026-01-01T00:00:00Z',
            'UTC',
          ),
        ).toBeNull();
      }
    } finally {
      f.close();
    }
  },
);

test('case-normalized activity uses candidate index without changing statistics or source filters', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    await ensureHealthContextGeneration(f.database);
    for (const [id, concept, kind] of [
      ['steps', 'STEP_COUNT', 'measurement'],
      ['workout', 'WORKOUT_DURATION', 'measurement'],
      ['clinical', 'step_count', 'diagnosis'],
      ['heart', 'heart_rate', 'measurement'],
    ]) {
      const record = {
        ...healthObservation(id!, concept!, '2023-01-01T00:00:00Z'),
        observationKind: kind,
      };
      await f.database.execute(
        'INSERT INTO health_observations(id,effective_at,recorded_at,ingested_at,payload_json) VALUES (?,?,?,?,?)',
        [
          record.id,
          record.effectiveAt,
          record.recordedAt!,
          record.ingestedAt,
          JSON.stringify(record),
        ],
      );
    }
    const days = healthContextDays({
      fromInclusive: '2023-01-01T00:00:00Z',
      toExclusive: '2023-01-02T00:00:00Z',
      timeZone: 'UTC',
    });
    const plans: string[] = [];
    const executor: SqlExecutor = {
      execute: async (sql, bindings) => {
        plans.push(
          ...(
            await f.database.execute(`EXPLAIN QUERY PLAN ${sql}`, bindings)
          ).rows.map(row => String(row.detail)),
        );
        return f.database.execute(sql, bindings);
      },
    };
    const indexed = await readHealthQuantityContext(
      executor,
      days,
      undefined,
      'activity',
    );
    expect(indexed.series.map(s => s.concept).sort()).toEqual([
      'step_count',
      'workout_duration',
    ]);
    expect(
      plans.some(p =>
        /health_context_activity_time.*<expr>=\?.*<expr>>\?.*<expr><\?/.test(p),
      ),
    ).toBe(true);
    await f.database.execute('DROP INDEX health_context_activity_time');
    expect(
      await readHealthQuantityContext(f.database, days, undefined, 'activity'),
    ).toEqual(indexed);
    await ensureHealthContextGeneration(f.database);
    expect(
      await readHealthQuantityContext(f.database, days, undefined, 'activity'),
    ).toEqual(indexed);
  } finally {
    f.close();
  }
});
