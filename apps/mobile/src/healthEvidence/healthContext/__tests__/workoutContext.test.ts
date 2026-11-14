import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../localEvidenceTestSupport';
import { readHealthQuantityContext } from '../quantityQuery';
import { healthContextDays } from '../window';
import {
  mapCommonObservationSample,
  toCommonObservationRecord,
} from '../../../healthkit/commonObservations/mapper';
import { healthKitSample } from '../../../healthkit/commonObservations/testSupport';
import { projectOverviewMetric } from '../../../routes/overview/metricProjection';
import { evidenceQueryTerms } from '../../evidenceCandidateScope';

it('reads workouts as activity using SQLite and propagates deletion to records and retrieval', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    const mapped = mapCommonObservationSample(
      'workouts',
      healthKitSample('workouts', {
        startDate: '2026-10-04T10:00:00Z',
        endDate: '2026-10-04T12:00:00Z',
        value: 75,
      }),
    );
    if (mapped.status !== 'mapped')
      throw new Error('Expected synthetic workout');
    const record = toCommonObservationRecord(
      mapped.observation,
      '2026-10-04T13:00:00Z',
    );
    await repository.put('health_observation', record);
    const days = healthContextDays({
      fromInclusive: '2026-10-04T00:00:00Z',
      toExclusive: '2026-10-05T00:00:00Z',
      timeZone: 'UTC',
    });
    const read = () =>
      readHealthQuantityContext(database, days, undefined, 'activity');
    const quantities = (await read()).series;
    const projected = projectOverviewMetric(
      {
        window: {
          fromInclusive: '2026-10-04T00:00:00Z',
          toExclusive: '2026-10-05T00:00:00Z',
          timeZone: 'UTC',
        },
        days,
        quantities,
        sleep: [],
        medications: [],
        symptoms: { entryCount: 0, recordedDays: 0, latest: [] },
        limitations: [],
        mutationGeneration: 0,
        deletionGeneration: 0,
      },
      'workouts',
      'Synthetic source',
    );
    expect(projected?.latest).toEqual({ date: '2026-10-04', value: 75 });
    expect(projected?.unit).toBe('min');
    expect((await read()).series[0]).toMatchObject({
      concept: 'workout_duration',
      unit: 'min',
      days: [{ sum: 75, samples: 1 }],
    });
    expect(
      (
        await readHealthQuantityContext(
          database,
          days,
          undefined,
          'measurements',
        )
      ).series,
    ).toEqual([]);
    const page = await repository.listHealthObservationPage(null, 10, {
      category: 'workouts',
      toInclusive: '2026-10-05T00:00:00Z',
    });
    expect(JSON.stringify(page)).toContain(record.id);
    expect(evidenceQueryTerms('최근 운동 기록')).toContain('workout_duration');
    await repository.delete('health_observation', record.id);
    expect((await read()).series).toEqual([]);
  } finally {
    close();
  }
});
