import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { readHealthQuantityContext } from '../quantityQuery';
import { healthContextDays } from '../window';
import { ensureHealthContextGeneration } from '../generation';
import { calendarSweepQuery } from '../testSupport/calendarSweepQuery';
// Compare exact day admission and tie ordering against the former calendar sweep.
test('indexed day ranges preserve precision, cutoff, stale exclusions and calendar boundaries', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    await ensureHealthContextGeneration(f.database);
    const dates = [
      '2024-03-10T06:59:59.9999Z',
      '2024-03-10T07:00:00Z',
      '2024-03-10T03:00:00-04:00',
      '2024-03-11T03:59:59.9999Z',
      '2024-03-11T04:00:00Z',
      '2011-12-29T10:00:00Z',
      '2011-12-30T10:00:00Z',
      '2024-11-03T05:30:00Z',
      '2024-11-03T06:30:00Z',
    ];
    for (let i = 0; i < dates.length * 3; i++) {
      const at = dates[i % dates.length];
      const base = healthObservation(
        `tie-${String(i).padStart(3, '0')}`,
        i % 3 === 0 ? 'step_count' : 'heart_rate',
        at,
      );
      const record = {
        ...base,
        ingestedAt:
          i % 4 === 0 ? '2026-01-02T00:00:00Z' : '2026-01-01T00:00:00Z',
        value: {
          kind: 'quantity',
          amount: i % 2 ? 0.1 : 100.00000001,
          unit: 'count',
        },
      };
      await f.database.execute(
        'INSERT INTO health_observations (id,effective_at,recorded_at,ingested_at,payload_json) VALUES (?,?,?,?,?)',
        [record.id, at, at, record.ingestedAt, JSON.stringify(record)],
      );
    }
    await f.database.execute(
      "INSERT INTO transcript_artifact_staleness (transcript_id,artifact_kind,artifact_id,superseded_segment_id,current_segment_id,invalidated_at) VALUES ('synthetic','health_observation','tie-001','old','new','2026-01-01T00:00:00Z')",
    );
    for (const [fromInclusive, toExclusive, timeZone] of [
      [
        '2024-03-10T06:59:59.99995Z',
        '2024-03-11T04:00:00.0001Z',
        'America/New_York',
      ],
      ['2024-11-03T05:00:00Z', '2024-11-04T05:00:00Z', 'America/New_York'],
      ['2011-12-29T00:00:00Z', '2012-01-01T00:00:00Z', 'Pacific/Apia'],
      ['2010-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'UTC'],
    ])
      for (const family of ['all', 'measurements', 'activity'] as const)
        for (const cutoff of [undefined, '2026-01-01T12:00:00Z']) {
          const days = healthContextDays({
            fromInclusive,
            toExclusive,
            timeZone,
          });
          const actual = await readHealthQuantityContext(
            f.database,
            days,
            undefined,
            family,
            cutoff,
          );
          const legacy = await readHealthQuantityContext(
            { execute: (q, p) => f.database.execute(calendarSweepQuery(q), p) },
            days,
            undefined,
            family,
            cutoff,
          );
          expect(actual).toEqual(legacy);
        }
  } finally {
    f.close();
  }
});
