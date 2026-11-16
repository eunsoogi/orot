import { createRecordRepository, runMigrations } from '@orot/storage';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createHealthEvidenceTestDatabase } from '../../localEvidenceTestSupport';
import { createHealthContextReader } from '../reader';
import { healthContextRevision } from '../scope';
import { projectHealthContext } from '../projection';
import { readHealthQuantityContext } from '../quantityQuery';
import { addHeartRateActivityContext } from '../heartRateActivity';
import { healthContextDays } from '../window';
import { ensureHealthContextGeneration } from '../generation';

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
const sample = (id: string, at: string, end: string, workout = false) => ({
  ...healthObservation(
    id,
    workout ? 'workout_duration' : 'heart_rate',
    at,
    'healthkit',
    'imported',
    end,
  ),
  value: {
    kind: 'quantity' as const,
    amount: workout ? 45 : 145,
    unit: workout ? 'min' : 'count/min',
  },
});

test('workout corrections and stale-source fences invalidate activity evidence while preserving heart values', async () => {
  const f = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(f.database);
    const records = createRecordRepository(f.database);
    const read = createHealthContextReader(f.database);
    await records.put(
      'health_observation',
      sample('heart', '2026-10-01T10:30:00Z', '2026-10-01T10:30:00Z'),
    );
    await records.put(
      'health_observation',
      sample('workout', '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z', true),
    );
    const original = await read(window, ['measurements']);
    await records.put(
      'health_observation',
      sample('workout', '2026-10-01T12:00:00Z', '2026-10-01T13:00:00Z', true),
    );
    const changed = await read(window, ['measurements']);
    expect(changed.quantities[0]?.days[0]?.activityContext?.[0]?.context).toBe(
      'no_recorded_workout_overlap',
    );
    expect(healthContextRevision(scope, changed)).not.toBe(
      healthContextRevision(scope, original),
    );
    await f.database.execute(
      'INSERT INTO transcript_artifact_staleness (transcript_id, artifact_kind, artifact_id, superseded_segment_id, current_segment_id, invalidated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        'synthetic',
        'health_observation',
        'workout',
        'old',
        'new',
        '2026-10-03T00:00:00Z',
      ],
    );
    const stale = await read(window, ['measurements']);
    expect(stale.quantities[0]?.days[0]?.activityContext?.[0]?.context).toBe(
      'unknown',
    );
    expect(healthContextRevision(scope, stale)).not.toBe(
      healthContextRevision(scope, changed),
    );
    expect(stale.quantities[0]?.days[0]?.maximum).toBe(145);
  } finally {
    f.close();
  }
});

test('keeps sensor strata and local-calendar assignment separate', async () => {
  const f = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(f.database);
    const records = createRecordRepository(f.database);
    const read = createHealthContextReader(f.database);
    const at = '2026-10-01T16:00:00Z';
    const heart = sample('watch-heart', at, at);
    await records.put('health_observation', heart);
    await records.put('health_observation', {
      ...heart,
      id: 'phone-heart',
      provenance: {
        ...heart.provenance,
        source: {
          system: 'healthkit',
          sourceIdentifier: 'com.example.other-synthetic',
        },
      },
      value: { kind: 'quantity', amount: 70, unit: 'count/min' },
    });
    await records.put(
      'health_observation',
      sample('workout', '2026-10-01T15:30:00Z', '2026-10-01T16:30:00Z', true),
    );
    const report = await read(
      {
        fromInclusive: '2026-10-01T15:00:00Z',
        toExclusive: '2026-10-02T15:00:00Z',
        timeZone: 'Asia/Seoul',
      },
      ['measurements'],
    );
    expect(report.quantities).toHaveLength(2);
    expect(
      report.quantities.every(item => item.days[0]?.date === '2026-10-02'),
    ).toBe(true);
    expect(
      projectHealthContext(report).quantities.map(
        item => item.activityContext?.[0]?.samples,
      ),
    ).toEqual([1, 1]);
    expect(
      projectHealthContext(report)
        .quantities.map(item => item.activityContext?.[0]?.maximum)
        .sort(),
    ).toEqual([145, 70].sort());
  } finally {
    f.close();
  }
});

/** Synthetic query-only timings are diagnostics, not a physical-device guarantee. */
test('keeps high-volume temporal grouping complete and bounded', async () => {
  const f = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(f.database);
    const records = createRecordRepository(f.database);
    const start = Date.parse('2026-07-01T00:00:00Z');
    const period = {
      fromInclusive: new Date(start).toISOString(),
      toExclusive: new Date(start + 90 * 86400000).toISOString(),
      timeZone: 'UTC',
    };
    await f.database.transaction(async tx => {
      for (let i = 0; i < 21600; i++) {
        const at = new Date(start + i * 360000).toISOString();
        const record = sample(`synthetic-heart-${i}`, at, at);
        await tx.execute(
          'INSERT INTO health_observations (id, effective_at, ingested_at, payload_json) VALUES (?, ?, ?, ?)',
          [record.id, at, at, JSON.stringify(record)],
        );
      }
    });
    for (let i = -1000; i < 270; i++) {
      const at = start + i * 8 * 3600000;
      await records.put(
        'health_observation',
        sample(
          `synthetic-workout-${i}`,
          new Date(at).toISOString(),
          new Date(at + 3600000).toISOString(),
          true,
        ),
      );
    }
    await ensureHealthContextGeneration(f.database);
    const days = healthContextDays(period);
    const began = performance.now();
    const quantities = await readHealthQuantityContext(
      f.database,
      days,
      undefined,
      'measurements',
    );
    const baselineMs = performance.now() - began;
    const enrichStart = performance.now();
    const series = await addHeartRateActivityContext(
      f.database,
      days,
      quantities.series,
    );
    const enrichmentMs = performance.now() - enrichStart;
    expect(series[0]?.days.reduce((n, day) => n + day.samples, 0)).toBe(21600);
    expect(
      series[0]?.days.reduce(
        (n, day) =>
          n +
          (day.activityContext ?? []).reduce(
            (m, group) => m + group.samples,
            0,
          ),
        0,
      ),
    ).toBe(21600);
    console.info(
      JSON.stringify({
        syntheticHeartSamples: 21600,
        workoutsInPeriod: 270,
        baselineMs: Math.round(baselineMs),
        enrichmentMs: Math.round(enrichmentMs),
      }),
    );
  } finally {
    f.close();
  }
}, 30000);
