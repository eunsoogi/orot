import { runHealthKitAutoSync } from '../../autoSync';
import { rememberHealthKitAutoSyncRequest } from '../../autoSyncCheckpoint';
import { subscribeLocalSourceDeletion } from '../../../storage/localDataClearEvents';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  commonObservationRecordId,
  mapCommonObservationSample,
} from '../mapper';
import { syncCommonObservationChanges } from '../sync';
import { healthKitSample } from '../testSupport';
import { healthKit, page } from '../testSyncSupport';
import { heartRatePreviewSeries } from '../../heartRatePreviewSeries';
import { discreteHeartRateRangeOnLocalDay } from '../../discreteHeartRateRangeOnLocalDay';

const feature = 'restingHeartRate' as const;
const clock = () => new Date(2035, 0, 15, 20).toISOString();
const summary = { count: 4, minimum: 50, maximum: 81, mean: 61.25 };
function sample(id: string, includeSummary: boolean) {
  return healthKitSample(feature, {
    id,
    value: summary.mean,
    startDate: new Date(2035, 0, 14, 10).toISOString(),
    endDate: new Date(2035, 0, 14, 11).toISOString(),
    ...(includeSummary ? { heartRateSampleSummary: summary } : {}),
  });
}

test('upgrade refresh enriches only same retained derived record and never resets anchor', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    const repository = createRecordRepository(f.database);
    const sampleChanges = (args: Parameters<typeof page>[0]) =>
      healthKit([page(args)]);
    const seed = sampleChanges({
      addedSamples: [sample('known', false)],
      cursor: 'anchor1',
    });
    await syncCommonObservationChanges({
      feature,
      repository,
      healthKit: seed,
      now: clock,
    });
    const get = (id: string) =>
      repository.get(
        'health_observation',
        commonObservationRecordId(feature, id),
      );
    const original = await get('known');
    expect(original?.heartRateSampleSummary).toBeUndefined();
    const next = sampleChanges({
      addedSamples: [sample('new', true)],
      cursor: 'anchor2',
    });
    const read = jest.fn(async () => ({
      availability: 'available' as const,
      status: 'completed' as const,
      readAuthorization: 'notObservable' as const,
      samples: [
        sample('known', true),
        sample('deleted-or-unknown', true),
        sample('new', true),
      ],
    }));
    await expect(
      syncCommonObservationChanges({
        feature,
        repository,
        healthKit: next,
        now: clock,
        refreshDerivedSamples: read,
      }),
    ).resolves.toMatchObject({
      status: 'complete',
      upserted: 2,
      cursorAdvanced: true,
    });
    expect(next.querySampleChanges).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 'anchor1' }),
    );
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ feature, sampleKind: feature, limit: 500 }),
    );
    const enriched = await get('known');
    expect(enriched).toEqual({ ...original, heartRateSampleSummary: summary });
    expect(await get('new')).toMatchObject({ heartRateSampleSummary: summary });
    expect(await get('deleted-or-unknown')).toBeNull();
    const plotted = heartRatePreviewSeries(
      'count/min',
      [{ id: enriched!.id, effectiveAt: enriched!.effectiveAt, amount: 61.25 }],
      new Map([[enriched!.id, enriched!]]),
      false,
    );
    expect(plotted[0]?.points[0]).toMatchObject({
      value: 61.25,
      range: { samples: 4, minimum: 50, maximum: 81 },
    });
    expect(discreteHeartRateRangeOnLocalDay(enriched!)).toEqual({
      samples: 4,
      minimum: 50,
      maximum: 81,
    });
    expect(
      discreteHeartRateRangeOnLocalDay({
        ...enriched!,
        endedAt: new Date(2035, 0, 15, 0).toISOString(),
      }),
    ).toBeUndefined();
  } finally {
    f.close();
  }
});

test('only derived accepted metadata may add extrema; malformed stats leave the scalar unmodified', () => {
  const raw = healthKitSample('heartRate', {
    value: summary.mean,
    heartRateSampleSummary: summary,
  });
  const mixed = {
    ...sample('mixed', true),
    heartRateSampleSummary: { ...summary, maximum: 60 },
  };
  const captured = mapCommonObservationSample(feature, mixed);
  expect(captured).toMatchObject({
    status: 'mapped',
    observation: { value: { amount: summary.mean } },
  });
  if (captured.status === 'mapped')
    expect(captured.observation.heartRateSampleSummary).toBeUndefined();
  const generic = mapCommonObservationSample('heartRate', raw);
  if (generic.status !== 'mapped')
    throw new Error('Expected valid synthetic raw quantity');
  expect(generic.observation.heartRateSampleSummary).toBeUndefined();
});

test('ordinary opted-in sync enriches an anchored legacy sample once without permissions or deletion', async () => {
  const f = openSqliteTestDatabase(':memory:');
  const deleted = jest.fn();
  const unsubscribe = subscribeLocalSourceDeletion(deleted);
  try {
    await runMigrations(f.database);
    const repository = createRecordRepository(f.database);
    await syncCommonObservationChanges({
      feature,
      repository,
      healthKit: healthKit([
        page({ addedSamples: [sample('known', false)], cursor: 'old-anchor' }),
      ]),
      now: clock,
    });
    await rememberHealthKitAutoSyncRequest(repository, feature, clock);
    const wire = healthKit([
      page({ cursor: 'old-anchor' }),
      page({ cursor: 'old-anchor' }),
    ]);
    const querySamples = jest.fn(async () => ({
      availability: 'available' as const,
      status: 'completed' as const,
      readAuthorization: 'notObservable' as const,
      samples: [sample('known', true), sample('unknown', true)],
    }));
    const options = {
      repository,
      healthKit: { ...wire, querySamples },
      now: clock,
    };
    const read = () =>
      repository.get(
        'health_observation',
        commonObservationRecordId(feature, 'known'),
      );
    const original = await read();
    expect(original?.heartRateSampleSummary).toBeUndefined();
    await expect(runHealthKitAutoSync(options)).resolves.toMatchObject({
      status: 'complete',
      attemptedFeatures: [feature],
    });
    expect(await read()).toEqual({
      ...original,
      heartRateSampleSummary: summary,
    });
    await expect(runHealthKitAutoSync(options)).resolves.toMatchObject({
      status: 'complete',
    });
    expect(querySamples).toHaveBeenCalledTimes(1);
    expect(querySamples).toHaveBeenCalledWith(
      expect.objectContaining({ feature, sampleKind: feature, limit: 500 }),
    );
    expect(wire.querySampleChanges).toHaveBeenCalledTimes(2);
    expect(wire.querySampleChanges).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 'old-anchor' }),
    );
    expect(wire.requestReadAuthorization).not.toHaveBeenCalled();
    expect(
      await repository.get(
        'health_observation',
        commonObservationRecordId(feature, 'unknown'),
      ),
    ).toBeNull();
    expect(deleted).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
    f.close();
  }
});
