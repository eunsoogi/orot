import { createRecordRepository, runMigrations } from '@orot/storage';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createHealthEvidenceTestDatabase } from '../../localEvidenceTestSupport';
import { readHealthQuantityContext } from '../quantityQuery';
import { healthContextDays } from '../window';

test('keeps exact exclusive and inclusive boundaries when source times have sub-millisecond precision', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    for (const [id, at, amount] of [
      ['before', '2026-10-01T00:00:00.0001Z', 1],
      ['start', '2026-10-01T00:00:00.0005Z', 2],
      ['last', '2026-10-02T00:00:00.0001Z', 4],
      ['end', '2026-10-02T00:00:00.0005Z', 8],
    ] as const) {
      await records.put('health_observation', {
        ...healthObservation(id, 'heart_rate', at),
        ingestedAt: '2026-10-20T00:00:00Z',
        value: { kind: 'quantity', amount, unit: 'count/min' },
      });
    }
    const result = await readHealthQuantityContext(
      database,
      healthContextDays({
        fromInclusive: '2026-10-01T00:00:00.0005Z',
        toExclusive: '2026-10-02T00:00:00.0005Z',
        timeZone: 'UTC',
      }),
    );
    expect(
      result.series[0]?.days.map(day => ({
        date: day.date,
        samples: day.samples,
        sum: day.sum,
      })),
    ).toEqual([
      { date: '2026-10-01', samples: 1, sum: 2 },
      { date: '2026-10-02', samples: 1, sum: 4 },
    ]);
  } finally {
    close();
  }
});

test('summarizes every sample in the requested period rather than the latest two raw records', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    for (const day of [1, 3, 4]) {
      for (const [index, amount] of [
        110 + day,
        130 + day,
        150 + day,
      ].entries()) {
        const at = `2026-10-0${day}T0${index}:00:00Z`;
        await records.put('health_observation', {
          ...healthObservation(
            `pressure-${day}-${index}`,
            'blood pressure systolic',
            at,
          ),
          ingestedAt: '2026-10-20T00:00:00Z',
          value: { kind: 'quantity', amount, unit: 'mmHg' },
        });
      }
    }
    const days = healthContextDays({
      fromInclusive: '2026-10-01T00:00:00Z',
      toExclusive: '2026-10-05T00:00:00Z',
      timeZone: 'UTC',
    });
    const result = await readHealthQuantityContext(database, days);
    expect(result.truncated).toBe(false);
    expect(result.series).toHaveLength(1);
    expect(result.series[0]?.days).toHaveLength(3);
    expect(result.series[0]?.days.map(day => day.samples)).toEqual([3, 3, 3]);
    expect(result.series[0]?.days[0]).toMatchObject({
      date: '2026-10-01',
      minimum: 111,
      maximum: 151,
      mean: 131,
      latest: 151,
    });
    // A missing calendar day stays missing; it is not a zero measurement or a missed dose.
    expect(result.series[0]?.days.some(day => day.date === '2026-10-02')).toBe(
      false,
    );
  } finally {
    close();
  }
});

test('keeps overlapping phone/watch step contributions in separate sensor series', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    for (const sensor of ['phone', 'watch']) {
      for (const [index, amount] of [200, 300].entries()) {
        const record = healthObservation(
          `${sensor}-${index}`,
          'step_count',
          `2026-10-01T0${index}:00:00Z`,
        );
        await records.put('health_observation', {
          ...record,
          provenance: {
            ...record.provenance,
            source: {
              system: 'healthkit',
              sourceIdentifier: `com.example.${sensor}`,
            },
          },
          value: { kind: 'quantity', amount, unit: 'count' },
        });
      }
    }
    const result = await readHealthQuantityContext(
      database,
      healthContextDays({
        fromInclusive: '2026-10-01T00:00:00Z',
        toExclusive: '2026-10-02T00:00:00Z',
        timeZone: 'UTC',
      }),
    );
    expect(result.series).toHaveLength(2);
    expect(result.series.map(series => series.days[0]?.sum)).toEqual([
      500, 500,
    ]);
    expect(new Set(result.series.map(series => series.source)).size).toBe(2);
  } finally {
    close();
  }
});
