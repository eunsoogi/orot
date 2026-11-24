import { createRecordRepository, runMigrations } from '../src';
import { readHealthObservationMonthQuantity } from '../src/healthObservationMonthQuantity';
import { healthObservation } from './localQueryTestSupport';
import { openSqliteTestDatabase } from './sqliteTestDatabase';

const window = {
  fromInclusive: '2026-10-22T15:15:00.123456Z',
  toInclusive: '2026-11-22T15:15:00.123456Z',
};
const imported = (
  id: string,
  at: string,
  amount: number,
  source = 'watch',
  unit = 'count/min',
) => ({
  ...healthObservation(id, 'heart_rate', at),
  ingestedAt: '2026-11-24T00:00:00Z',
  value: { kind: 'quantity' as const, amount, unit },
  provenance: {
    origin: 'imported' as const,
    sourceRecordIds: [id],
    source: { system: 'healthkit', sourceIdentifier: source },
  },
});

test('dense recent page does not hide prior measured days or merge incompatible sources and units', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const repo = createRecordRepository(database);
    await repo.transaction(async (writer) => {
      for (let i = 0; i < 801; i++)
        await writer.put(
          'health_observation',
          imported('recent-' + i, '2026-11-22T13:00:00Z', 60 + (i % 3)),
        );
      for (const point of [
        imported('lower-edge', window.fromInclusive, 50),
        imported('below-edge', '2026-10-22T15:15:00.123455Z', 999),
        imported('upper-edge', window.toInclusive, 65),
        imported('above-edge', '2026-11-22T15:15:00.123457Z', 999),
        imported('first-old', '2026-11-01T06:00:00Z', 70),
        imported('second-old', '2026-11-01T08:00:00Z', 86),
        imported('other-source', '2026-11-01T08:00:00Z', 91, 'manual'),
        imported('other-unit', '2026-11-01T08:00:00Z', 100, 'watch', 'bpm'),
      ])
        await writer.put('health_observation', point);
    });
    const page = await repo.listHealthObservationPage(null, 50, {
      category: 'heart_rate',
      ...window,
    });
    expect(page.nextCursor).not.toBeNull();
    expect(page.records.every((r) => r.effectiveAt.startsWith('2026-11-22'))).toBe(true);
    for (const [id, amount] of [
      ['unknown-sensor-a', 73],
      ['unknown-sensor-b', 75],
    ] as const) {
      const observed = imported(id, '2026-11-02T08:00:00Z', amount);
      await repo.put('health_observation', {
        ...observed,
        provenance: {
          ...observed.provenance,
          source: { system: 'healthkit', sourceName: 'Same display name' },
        },
      });
    }
    const captured: string[] = [];
    const rows = await readHealthObservationMonthQuantity(
      {
        async execute(q, params) {
          const plan = await database.execute('EXPLAIN QUERY PLAN ' + q, params);
          captured.push(...plan.rows.map((r) => String(r.detail)));
          return database.execute(q, params);
        },
      },
      'heart_rate',
      window,
    );
    expect(captured.join('\n')).toMatch(
      /SEARCH health_observations USING INDEX health_observations_library_workouts_idx/,
    );
    expect(rows).toHaveLength(7);
    expect(rows.find((r) => r.mean === 73)?.source).not.toBe(
      rows.find((r) => r.mean === 75)?.source,
    );
    expect(rows.find((r) => r.mean === 78)).toMatchObject({
      min: 70,
      max: 86,
      sampleCount: 2,
      sum: 156,
    });
    expect(rows.find((r) => r.sampleCount === 802)).toMatchObject({ min: 60, max: 65, sum: 48926 });
    expect(rows.find((r) => r.mean === 50)).toMatchObject({
      effectiveAt: '2026-10-22T15:15:00.123Z',
      min: 50,
      max: 50,
    });
    expect(rows.find((r) => r.mean === 91)?.source).not.toBe(
      rows.find((r) => r.mean === 78)?.source,
    );
    expect(rows.find((r) => r.mean === 100)?.unit).toBe('bpm');
    expect(rows.every((r) => r.max < 999)).toBe(true);
    expect(await readHealthObservationMonthQuantity(database, 'body_mass', window)).toEqual([]);
  } finally {
    close();
  }
});
