import { createRecordRepository, runMigrations } from '../src';
import { healthObservation } from './localQueryTestSupport';
import { openSqliteTestDatabase } from './sqliteTestDatabase';

const local = (day: number, hour: number, minute = 0, second = 0) =>
  new Date(2035, 0, day, hour, minute, second).toISOString();
const window = { fromInclusive: local(1, 0), toInclusive: local(31, 18) };
type Concept = 'resting_heart_rate' | 'walking_heart_rate_average';
const measured = (
  id: string,
  from: string,
  to: string,
  amount: number,
  options: {
    source?: string | null;
    stats?: [count: number, min: number, max: number];
    concept?: Concept;
  } = {},
) => {
  const { source = 'watch', stats, concept = 'resting_heart_rate' } = options;
  const prefix = concept === 'resting_heart_rate' ? 'restingHeartRate' : 'walkingHeartRateAverage';
  return {
    ...healthObservation(
      'healthkit:' + prefix + ':' + id,
      concept,
      from,
      'healthkit',
      'imported',
      to,
    ),
    ingestedAt: local(31, 21),
    value: { kind: 'quantity' as const, amount, unit: 'count/min' },
    provenance: {
      origin: 'imported' as const,
      sourceRecordIds: [id],
      source: { system: 'healthkit', sourceIdentifier: source ?? undefined },
    },
    ...(stats
      ? {
          heartRateSampleSummary: {
            count: stats[0],
            minimum: stats[1],
            maximum: stats[2],
            mean: amount,
          },
        }
      : {}),
  };
};

test('a dense month weights only disjoint exact derived readings of the same unit and source on their measured day', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    const repo = createRecordRepository(f.database);
    await repo.transaction(async (writer) => {
      for (let i = 0; i < 601; i++)
        await writer.put(
          'health_observation',
          measured('latest-' + i, local(31, 12, 0, i), local(31, 12, 0, i), 67),
        );
      for (const record of [
        measured('first', local(5, 9), local(5, 10), 60, { stats: [4, 50, 80] }),
        measured('second', local(5, 11), local(5, 12), 80, { stats: [2, 70, 90] }),
        measured('scalar', local(5, 13), local(5, 13, 10), 90),
        measured('other', local(5, 11), local(5, 12), 91, { source: 'other', stats: [3, 81, 100] }),
        measured('unspecified-source', local(5, 11), local(5, 12), 71, {
          source: null,
          stats: [2, 31, 95],
        }),
        measured('touch-left', local(6, 9), local(6, 10), 64, { stats: [7, 40, 99] }),
        measured('touch-right', local(6, 10), local(6, 11), 84, { stats: [4, 42, 97] }),
        measured('overlap-left', local(7, 9), local(7, 10), 63, { stats: [7, 40, 99] }),
        measured('overlap-right', local(7, 9, 59), local(7, 11), 83),
        measured('midnight', local(8, 23), local(9, 0), 58, { stats: [4, 40, 88] }),
        measured('after-window', local(31, 17), local(31, 19), 77, { stats: [3, 20, 110] }),
        measured('walking', local(5, 10), local(5, 11), 74, {
          concept: 'walking_heart_rate_average',
          stats: [3, 64, 93],
        }),
      ])
        await writer.put('health_observation', record);
    });
    const raw = await repo.listHealthObservationPage(null, 50, {
      category: 'resting_heart_rate',
      ...window,
    });
    expect(raw.nextCursor).not.toBeNull();
    expect(raw.records.every((record) => record.effectiveAt >= local(31, 0))).toBe(true);
    const result = await repo.listHealthObservationMonthChart('resting_heart_rate', window);
    expect(result.kind).toBe('quantity');
    if (result.kind !== 'quantity') throw Error('Expected measured quantity');
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          effectiveAt: local(5, 0),
          sampleCount: 7,
          min: 50,
          max: 90,
          mean: 70,
          sum: 490,
        }),
        expect.objectContaining({
          effectiveAt: local(5, 0),
          sampleCount: 3,
          min: 81,
          max: 100,
          mean: 91,
        }),
        expect.objectContaining({
          effectiveAt: local(5, 0),
          sampleCount: 1,
          min: 71,
          max: 71,
          mean: 71,
        }),
        expect.objectContaining({
          effectiveAt: local(6, 0),
          sampleCount: 2,
          min: 64,
          max: 84,
          mean: 74,
        }),
        expect.objectContaining({
          effectiveAt: local(7, 0),
          sampleCount: 2,
          min: 63,
          max: 83,
          mean: 73,
        }),
        expect.objectContaining({
          effectiveAt: local(8, 0),
          sampleCount: 1,
          min: 58,
          max: 58,
          mean: 58,
        }),
        expect.objectContaining({ effectiveAt: local(31, 0), sampleCount: 602, min: 67, max: 77 }),
      ]),
    );
    expect(result.rows).toHaveLength(7);
    const walking = await repo.listHealthObservationMonthChart(
      'walking_heart_rate_average',
      window,
    );
    expect(walking.rows).toEqual([
      expect.objectContaining({ sampleCount: 3, min: 64, max: 93, mean: 74 }),
    ]);
  } finally {
    f.close();
  }
});
