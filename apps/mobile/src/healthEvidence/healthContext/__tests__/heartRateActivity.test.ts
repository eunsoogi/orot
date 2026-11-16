import { createRecordRepository, runMigrations } from '@orot/storage';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createHealthEvidenceTestDatabase } from '../../localEvidenceTestSupport';
import { createHealthContextReader } from '../reader';
import { projectHealthContext } from '../projection';
import { healthContextRevision } from '../scope';
import { presentHealthContext } from '../../../aiFeatures/integration/healthContextPresentation';
import { healthContextContent } from '../../../aiFeatures/integration/healthContextEvidence';

const window = {
  fromInclusive: '2026-10-01T00:00:00Z',
  toExclusive: '2026-10-02T00:00:00Z',
  timeZone: 'UTC',
};
const scope = {
  kind: 'health_context_period' as const,
  version: 1 as const,
  topic: 'measurements' as const,
  window,
};
async function fixture() {
  const db = createHealthEvidenceTestDatabase();
  await runMigrations(db.database);
  const records = createRecordRepository(db.database);
  const read = createHealthContextReader(db.database);
  const put = async (
    id: string,
    start: string,
    end: string | undefined,
    amount: number,
    workout = false,
    ingest = '2026-10-02T00:00:00Z',
  ) => {
    await records.put('health_observation', {
      ...healthObservation(
        id,
        workout ? 'workout_duration' : 'heart_rate',
        start,
        'healthkit',
        'imported',
        end,
      ),
      ingestedAt: ingest,
      value: { kind: 'quantity', amount, unit: workout ? 'min' : 'count/min' },
    });
  };
  return { ...db, records, read, put };
}

test('preserves the whole range and groups overlapping, unmatched and unknown intervals without duplicating samples', async () => {
  const f = await fixture();
  try {
    await f.put(
      'workout',
      '2026-10-01T10:00:00Z',
      '2026-10-01T11:00:00Z',
      40,
      true,
    );
    await f.put(
      'duplicate',
      '2026-10-01T10:00:00Z',
      '2026-10-01T11:00:00Z',
      40,
      true,
    );
    for (const [id, start, end, amount] of [
      ['inside', '10:20:00Z', '10:21:00Z', 150],
      ['partial', '09:59:00Z', '10:01:00Z', 120],
      ['end-point', '11:00:00Z', '11:00:00Z', 100],
      ['start-point', '10:00:00Z', '10:00:00Z', 130],
      ['before', '09:59:00Z', '10:00:00Z', 70],
      ['missing-end', '12:00:00Z', undefined, 80],
    ] as const)
      await f.put(
        id,
        `2026-10-01T${start}`,
        end && `2026-10-01T${end}`,
        amount,
      );
    const report = await f.read(window, ['measurements']);
    const projected = projectHealthContext(report).quantities[0]!;
    expect(projected).toMatchObject({
      minimumSample: 70,
      maximumSample: 150,
      sampleCount: 6,
    });
    expect(projected.activityContext).toEqual([
      {
        context: 'no_recorded_workout_overlap',
        samples: 2,
        minimum: 70,
        maximum: 100,
      },
      { context: 'unknown', samples: 1, minimum: 80, maximum: 80 },
      { context: 'workout_overlap', samples: 3, minimum: 120, maximum: 150 },
    ]);
    expect(
      projectHealthContext(report, 'weekly').quantities[0]?.weeks?.[0]
        ?.activityContext,
    ).toEqual(projected.activityContext);
    expect(healthContextContent(scope, report)).toContain(
      'no_recorded_workout_overlap_is_not_resting_heart_rate',
    );
    const display = presentHealthContext(scope, report);
    expect(JSON.stringify(display)).toContain('운동 기록과 시간이 겹치는 심박');
    expect(JSON.stringify(display)).toContain('150 count/min');
    expect(JSON.stringify(display)).toContain('휴식 상태라고 볼 수 없고');
    expect(JSON.stringify(projected)).not.toContain('com.example.synthetic');
  } finally {
    f.close();
  }
});

test('uses exact instants across midnight, offsets and submilliseconds, keeping unknown outside-period intervals', async () => {
  const f = await fixture();
  try {
    await f.put(
      'cross-midnight',
      '2026-10-01T08:50:00+09:00',
      '2026-10-01T09:10:00.0005+09:00',
      15,
      true,
    );
    await f.put(
      'point',
      '2026-10-01T00:10:00.0001Z',
      '2026-10-01T00:10:00.0001Z',
      140,
    );
    await f.put(
      'boundary',
      '2026-10-01T00:10:00.0005Z',
      '2026-10-01T00:10:00.0005Z',
      110,
    );
    await f.put('extends', '2026-10-01T23:59:00Z', '2026-10-02T00:01:00Z', 90);
    const groups = projectHealthContext(await f.read(window, ['measurements']))
      .quantities[0]!.activityContext;
    expect(groups).toEqual([
      {
        context: 'no_recorded_workout_overlap',
        samples: 1,
        minimum: 110,
        maximum: 110,
      },
      { context: 'unknown', samples: 1, minimum: 90, maximum: 90 },
      { context: 'workout_overlap', samples: 1, minimum: 140, maximum: 140 },
    ]);
  } finally {
    f.close();
  }
});

test('recomputes cached source revisions on workout insertion and deletion, and respects ingestion cutoff', async () => {
  const f = await fixture();
  try {
    await f.put('heart', '2026-10-01T10:30:00Z', '2026-10-01T10:30:00Z', 145);
    const before = await f.read(window, ['measurements']);
    expect(before.quantities[0]?.days[0]?.activityContext?.[0]?.context).toBe(
      'unknown',
    );
    await f.put(
      'late-workout',
      '2026-10-01T10:00:00Z',
      '2026-10-01T11:00:00Z',
      50,
      true,
      '2026-10-03T00:00:00Z',
    );
    const added = await f.read(window, ['measurements']);
    expect(added.quantities[0]?.days[0]?.activityContext?.[0]?.context).toBe(
      'workout_overlap',
    );
    expect(healthContextRevision(scope, added)).not.toBe(
      healthContextRevision(scope, before),
    );
    const cutoff = await f.read(
      { ...window, dataAvailableThrough: '2026-10-02T12:00:00Z' },
      ['measurements'],
    );
    expect(cutoff.quantities[0]?.days[0]?.activityContext?.[0]?.context).toBe(
      'unknown',
    );
    await f.records.delete('health_observation', 'late-workout');
    const deleted = await f.read(window, ['measurements']);
    expect(deleted.quantities[0]?.days[0]?.activityContext?.[0]?.context).toBe(
      'unknown',
    );
    expect(deleted.deletionGeneration).toBeGreaterThan(
      added.deletionGeneration,
    );
    expect(healthContextRevision(scope, deleted)).not.toBe(
      healthContextRevision(scope, added),
    );
  } finally {
    f.close();
  }
});

test('does not query workout context for unrelated topics or after cancellation', async () => {
  const f = await fixture();
  try {
    const execute = jest.spyOn(f.database, 'execute');
    const controller = new AbortController();
    controller.abort();
    await expect(
      f.read(window, ['measurements'], controller.signal),
    ).rejects.toThrow('cancelled');
    await f.read(window, ['activity']);
    expect(
      execute.mock.calls.some(([sql]) => sql.includes('classified AS')),
    ).toBe(false);
  } finally {
    f.close();
  }
});
