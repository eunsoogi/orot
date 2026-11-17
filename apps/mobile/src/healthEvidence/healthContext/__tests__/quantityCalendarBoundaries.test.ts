import { createRecordRepository, runMigrations } from '@orot/storage';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createHealthEvidenceTestDatabase } from '../../localEvidenceTestSupport';
import { readHealthQuantityContext } from '../quantityQuery';
import { healthContextDays } from '../window';

// Calendar boundaries come from the caller's zone, never from fixed 24-hour bins.
test('calendar sweep retains DST, offset, exact partial boundaries, freshness and sensor separation', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    for (const [id, at, amount] of [
      ['before', '2026-03-08T00:00:00.0001-05:00', 100],
      ['start', '2026-03-08T00:00:00.0005-05:00', 2],
      ['before-dst', '2026-03-08T01:59:59-05:00', 4],
      ['after-dst', '2026-03-08T03:00:00-04:00', 6],
      ['next-day', '2026-03-09T00:00:00-04:00', 8],
      ['last', '2026-03-10T00:00:00.0001-04:00', 10],
      ['end', '2026-03-10T00:00:00.0005-04:00', 100],
      ['late', '2026-03-09T00:00:00-04:00', 100],
      ['stale', '2026-03-09T00:00:00-04:00', 100],
      ['other-sensor', '2026-03-09T00:00:00-04:00', 50],
    ] as const) {
      const record = healthObservation(id, 'heart_rate', at);
      await repository.put('health_observation', {
        ...record,
        ingestedAt:
          id === 'late' ? '2026-04-02T00:00:00Z' : '2026-04-01T00:00:00Z',
        value: { kind: 'quantity', amount, unit: 'count/min' },
        ...(id === 'other-sensor'
          ? {
              provenance: {
                ...record.provenance,
                source: {
                  system: 'healthkit',
                  sourceIdentifier: 'second-sensor',
                },
              },
            }
          : {}),
      });
    }
    await database.execute(
      'INSERT INTO transcript_artifact_staleness (transcript_id, artifact_kind, artifact_id, superseded_segment_id, current_segment_id, invalidated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        'transcript',
        'health_observation',
        'stale',
        'old',
        'current',
        '2026-04-01T00:00:00Z',
      ],
    );
    const days = healthContextDays({
      fromInclusive: '2026-03-08T00:00:00.0005-05:00',
      toExclusive: '2026-03-10T00:00:00.0005-04:00',
      timeZone: 'America/New_York',
    });
    const result = await readHealthQuantityContext(
      database,
      days,
      undefined,
      'measurements',
      '2026-04-01T00:00:00Z',
    );
    // Differential reference: execute the previous per-sample calendar lookup
    // against exactly the same current, stale, late and offset-bearing records.
    const legacy = await readHealthQuantityContext(
      {
        execute: (sql, parameters) =>
          database.execute(
            sql.replace(
              /, calendar_events AS \([\s\S]*?\), ranked AS \(/u,
              `, dated AS MATERIALIZED (
          SELECT o.*, (SELECT d.date FROM days d
            WHERE o.at_key >= d.from_key AND o.at_key < d.to_key LIMIT 1) AS date
          FROM observations o
        ), ranked AS (`,
            ),
            parameters,
          ),
      },
      days,
      undefined,
      'measurements',
      '2026-04-01T00:00:00Z',
    );
    expect(result).toEqual(legacy);
    expect(result.truncated).toBe(false);
    expect(result.series).toHaveLength(2);
    expect(result.series[0]?.days).toEqual([
      {
        date: '2026-03-08',
        samples: 3,
        minimum: 2,
        maximum: 6,
        mean: 4,
        sum: 12,
        latest: 6,
        firstAt: '2026-03-08T00:00:00.0005-05:00',
        lastAt: '2026-03-08T03:00:00-04:00',
      },
      {
        date: '2026-03-09',
        samples: 1,
        minimum: 8,
        maximum: 8,
        mean: 8,
        sum: 8,
        latest: 8,
        firstAt: '2026-03-09T00:00:00-04:00',
        lastAt: '2026-03-09T00:00:00-04:00',
      },
      {
        date: '2026-03-10',
        samples: 1,
        minimum: 10,
        maximum: 10,
        mean: 10,
        sum: 10,
        latest: 10,
        firstAt: '2026-03-10T00:00:00.0001-04:00',
        lastAt: '2026-03-10T00:00:00.0001-04:00',
      },
    ]);
    expect(result.series[1]?.days[0]).toMatchObject({
      date: '2026-03-09',
      samples: 1,
      mean: 50,
    });
    expect(
      (await readHealthQuantityContext(database, days, undefined, 'activity'))
        .series,
    ).toEqual([]);
  } finally {
    close();
  }
});
