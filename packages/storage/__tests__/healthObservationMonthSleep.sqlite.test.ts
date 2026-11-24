import { createRecordRepository, runMigrations } from '../src';
import { readHealthObservationMonthSleep } from '../src/healthObservationMonthSleep';
import { healthObservation } from './localQueryTestSupport';
import { openSqliteTestDatabase } from './sqliteTestDatabase';

const sample = (
  id: string,
  effectiveAt: string,
  endedAt: string,
  source = 'watch',
  text = 'asleepCore',
) => ({
  ...healthObservation(id, 'HKCategoryTypeIdentifierSleepAnalysis', effectiveAt),
  endedAt,
  recordedAt: endedAt,
  ingestedAt: '2026-11-24T00:00:00Z',
  value: { kind: 'text' as const, text },
  provenance: {
    origin: 'imported' as const,
    sourceRecordIds: [id],
    source: { system: 'healthkit', sourceIdentifier: source },
  },
});
const window = { fromInclusive: '2026-10-22T22:00:00Z', toInclusive: '2026-11-22T23:30:00Z' };

test('monthly sleep clips both boundaries and unions overlapping awake-excluded segments by source and day', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const repo = createRecordRepository(db.database);
    await repo.transaction(async (writer) => {
      for (const row of [
        sample('leading', '2026-10-22T21:00:00Z', '2026-10-23T01:30:00Z'),
        sample('overlap', '2026-10-23T00:15:00Z', '2026-10-23T03:30:00Z'),
        sample('nested', '2026-10-23T01:00:00Z', '2026-10-23T01:30:00Z'),
        sample('awake', '2026-10-23T01:00:00Z', '2026-10-23T05:30:00Z', 'watch', '2'),
        sample('phone', '2026-10-23T02:30:00Z', '2026-10-23T04:30:00Z', 'phone'),
        sample('right', '2026-11-22T23:00:00Z', '2026-11-23T03:00:00Z'),
        sample('too-far', '2026-11-22T23:35:00Z', '2026-11-23T05:00:00Z'),
      ])
        await writer.put('health_observation', row);
    });
    const measured = await readHealthObservationMonthSleep(db.database, window);
    expect(measured.map((row) => [row.effectiveAt, row.minutes])).toEqual([
      ['2026-10-22T22:00:00.000Z', 120],
      ['2026-10-23T00:00:00.000Z', 120],
      ['2026-10-23T00:00:00.000Z', 210],
      ['2026-11-22T00:00:00.000Z', 30],
    ]);
    expect(measured[1]?.source).not.toBe(measured[2]?.source);
  } finally {
    db.close();
  }
});
