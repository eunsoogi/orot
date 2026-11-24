import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { runHealthKitAutoSync } from '../../autoSync';
import { rememberHealthKitAutoSyncRequest } from '../../autoSyncCheckpoint';
import { commonObservationRecordId } from '../mapper';
import { syncCommonObservationChanges } from '../sync';
import { healthKitSample } from '../testSupport';
import { healthKit, page } from '../testSyncSupport';

const feature = 'restingHeartRate' as const;
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

test('no exact source match and a capped snapshot permit later retry without repeated reads within a day', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    const repository = createRecordRepository(f.database);
    let day = 15;
    const now = () => new Date(2035, 0, day, 20).toISOString();
    const cursor = 'old-anchor';
    await syncCommonObservationChanges({
      feature,
      repository,
      healthKit: healthKit([
        page({ addedSamples: [sample('known', false)], cursor }),
      ]),
      now,
    });
    await rememberHealthKitAutoSyncRequest(repository, feature, now);
    const wire = healthKit(Array.from({ length: 5 }, () => page({ cursor })));
    let samples = [sample('unknown', true)];
    const querySamples = jest.fn(async () => ({
      availability: 'available' as const,
      status: 'completed' as const,
      readAuthorization: 'notObservable' as const,
      samples,
    }));
    const options = { repository, now, healthKit: { ...wire, querySamples } };
    const sync = () => runHealthKitAutoSync(options);
    const read = () =>
      repository.get(
        'health_observation',
        commonObservationRecordId(feature, 'known'),
      );
    await sync();
    await sync();
    expect(querySamples).toHaveBeenCalledTimes(1);
    expect((await read())?.heartRateSampleSummary).toBeUndefined();

    day += 1;
    samples = [
      sample('known', true),
      ...Array.from({ length: 499 }, (_, i) => sample('unknown-' + i, true)),
    ];
    await sync();
    expect(querySamples).toHaveBeenCalledTimes(2);
    expect((await read())?.heartRateSampleSummary).toEqual(summary);

    day += 1;
    samples = [sample('known', true)];
    await sync();
    expect(querySamples).toHaveBeenCalledTimes(3);

    day += 1;
    await sync();
    expect(querySamples).toHaveBeenCalledTimes(3);
    expect(wire.requestReadAuthorization).not.toHaveBeenCalled();
    expect(await repository.list('health_observation')).toHaveLength(1);
  } finally {
    f.close();
  }
});
