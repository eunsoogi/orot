import { runMigrations, type SqlExecutor } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { addHeartRateActivityContext } from '../heartRateActivity';
import { healthContextDays } from '../window';
import { ensureHealthContextGeneration } from '../generation';
import { ensureHealthContextCoveringIndexes } from '../healthContextCoveringIndexes';

/** Real SQLite compares the unchanged SQL with its old non-covering access path.
 * Index construction and later writes must preserve rows and generation fences.
 * The plan is evidence of table-read elimination, not a device latency claim. */
test('heart covering indexes preserve upgrade, stale, cutoff, mutation and rollback behavior', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    await ensureHealthContextGeneration(f.database);
    await f.database.execute('DROP INDEX health_context_observation_covering');
    await f.database.execute('DROP INDEX health_context_heart_covering');
    const records = Array.from({ length: 2000 }, (_, i) => {
      const at = new Date(Date.UTC(2024, 2, 10, 6) + i * 60000).toISOString();
      return {
        ...healthObservation(
          `point-${i}`,
          'heart_rate',
          at,
          'healthkit',
          'imported',
          at,
        ),
        ingestedAt: i % 7 ? '2026-01-01T00:00:00Z' : '2026-01-03T00:00:00Z',
        padding: 'x'.repeat(1024),
      };
    });
    records.push({
      ...healthObservation(
        'workout',
        'workout_duration',
        '2024-03-10T06:30:00Z',
        'healthkit',
        'imported',
        '2024-03-10T08:30:00Z',
      ),
      ingestedAt: '2026-01-01T00:00:00Z',
      padding: '',
    });
    await f.database.execute(
      `INSERT INTO health_observations(id,effective_at,recorded_at,ingested_at,payload_json)
       SELECT json_extract(value,'$.id'),json_extract(value,'$.effectiveAt'),json_extract(value,'$.effectiveAt'),json_extract(value,'$.ingestedAt'),value FROM json_each(?)`,
      [JSON.stringify(records)],
    );
    await f.database.execute(
      "INSERT INTO transcript_artifact_staleness(transcript_id,artifact_kind,artifact_id,superseded_segment_id,current_segment_id,invalidated_at) VALUES ('synthetic','health_observation','point-1','old','new','2026-01-01')",
    );
    let query = '';
    let parameters: Parameters<SqlExecutor['execute']>[1];
    const days = healthContextDays({
      fromInclusive: '2024-03-10T06:00:00.0000001Z',
      toExclusive: '2024-03-12T04:00:00Z',
      timeZone: 'America/New_York',
    });
    await addHeartRateActivityContext(
      {
        execute: (sql, values) => {
          query = sql;
          parameters = values;
          return f.database.execute(sql, values);
        },
      },
      days,
      [
        {
          concept: 'heart_rate',
          unit: 'count/min',
          source: 'synthetic:',
          days: [],
        },
      ],
      undefined,
      '2026-01-02T00:00:00Z',
    );
    const before = await f.database.execute(query, parameters);
    const generation = await f.database.execute(
      'SELECT * FROM health_context_generation',
    );
    const sources = await f.database.execute(
      'SELECT id,payload_json FROM health_observations ORDER BY id',
    );
    await ensureHealthContextCoveringIndexes(f.database);
    await ensureHealthContextCoveringIndexes(f.database);
    expect(
      await f.database.execute('SELECT * FROM health_context_generation'),
    ).toEqual(generation);
    expect(
      await f.database.execute(
        'SELECT id,payload_json FROM health_observations ORDER BY id',
      ),
    ).toEqual(sources);
    expect(await f.database.execute(query, parameters)).toEqual(before);
    const old = query.replaceAll(
      'health_observations r',
      'health_observations r INDEXED BY health_context_quantity_time',
    );
    const compare = async () => {
      expect(await f.database.execute(query, parameters)).toEqual(
        await f.database.execute(old, parameters),
      );
      const plan = await f.database.execute(
        'EXPLAIN QUERY PLAN ' + query,
        parameters,
      );
      expect(
        plan.rows.filter(r =>
          String(r.detail).includes(
            'USING COVERING INDEX health_context_heart_covering',
          ),
        ),
      ).toHaveLength(2);
    };
    await compare();
    await f.database.execute(
      "UPDATE health_observations SET payload_json = json_set(payload_json, '$.value.amount', 180, '$.endedAt', '2024-03-10T07:20:00Z') WHERE id = 'point-2'",
    );
    await compare();
    await f.database.execute(
      "DELETE FROM health_observations WHERE id IN ('point-3','workout')",
    );
    await compare();
    const saved = await f.database.execute(query, parameters);
    await expect(
      f.database.transaction(async tx => {
        await tx.execute(
          "UPDATE health_observations SET payload_json=json_set(payload_json,'$.value.amount',999) WHERE id='point-4'",
        );
        throw new Error('synthetic rollback');
      }),
    ).rejects.toThrow('synthetic rollback');
    expect(await f.database.execute(query, parameters)).toEqual(saved);
    await compare();
  } finally {
    f.close();
  }
});

// Production setup supplies a transaction. An interrupted derived-index upgrade
// must not leave one index committed or change any source/generation state.
test('a failed covering upgrade rolls back both indexes and retries intact', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    await ensureHealthContextGeneration(f.database);
    await f.database.execute('DROP INDEX health_context_observation_covering');
    await f.database.execute('DROP INDEX health_context_heart_covering');
    const record = healthObservation(
      'retained',
      'heart_rate',
      '2024-01-01T00:00:00Z',
    );
    await f.database.execute(
      'INSERT INTO health_observations(id,effective_at,ingested_at,payload_json) VALUES (?,?,?,?)',
      [
        record.id,
        record.effectiveAt!,
        record.ingestedAt,
        JSON.stringify(record),
      ],
    );
    const sources = await f.database.execute(
      'SELECT * FROM health_observations',
    );
    const generation = await f.database.execute(
      'SELECT * FROM health_context_generation',
    );
    const failure = new Error('synthetic second index failure');
    await expect(
      f.database.transaction(tx =>
        ensureHealthContextCoveringIndexes({
          execute: (sql, values) => {
            if (sql.includes('health_context_heart_covering')) throw failure;
            return tx.execute(sql, values);
          },
        }),
      ),
    ).rejects.toBe(failure);
    const indexes = () =>
      f.database.execute(
        "SELECT name FROM sqlite_schema WHERE type='index' AND name IN ('health_context_observation_covering','health_context_heart_covering') ORDER BY name",
      );
    expect((await indexes()).rows).toEqual([]);
    expect(
      await f.database.execute('SELECT * FROM health_observations'),
    ).toEqual(sources);
    expect(
      await f.database.execute('SELECT * FROM health_context_generation'),
    ).toEqual(generation);
    await f.database.transaction(ensureHealthContextCoveringIndexes);
    expect((await indexes()).rows.map(row => row.name)).toEqual([
      'health_context_heart_covering',
      'health_context_observation_covering',
    ]);
    expect(
      await f.database.execute('SELECT * FROM health_observations'),
    ).toEqual(sources);
    expect(
      await f.database.execute('SELECT * FROM health_context_generation'),
    ).toEqual(generation);
  } finally {
    f.close();
  }
});
