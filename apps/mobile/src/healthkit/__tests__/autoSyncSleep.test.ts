import { runHealthKitAutoSync } from '../autoSync';
import { healthKitAutoSyncCheckpointKey } from '../autoSyncCheckpoint';
import { MemoryObservationRepository } from '../commonObservations/testSupport';
import { sample, page } from '../sleep/sleepImporterFixtures';
import { sleepObservationRecordId } from '../sleep/recordMapper';

const now = '2026-10-18T12:00:00.000Z';

test('refreshes a previously selected sleep category during automatic sync', async () => {
  const repository = new MemoryObservationRepository();
  await repository.transaction(writer =>
    writer.putSyncCheckpoint({
      key: healthKitAutoSyncCheckpointKey('sleep'),
      value: 'requested',
      updatedAt: now,
    }),
  );
  const querySampleChanges = jest.fn(async () =>
    page([sample('night')], 'sleep-anchor'),
  );
  const result = await runHealthKitAutoSync({
    repository,
    healthKit: { querySampleChanges },
    now: () => now,
  });

  expect(result).toEqual({ status: 'complete', attemptedFeatures: ['sleep'] });
  expect(querySampleChanges).toHaveBeenCalledWith(
    expect.objectContaining({ feature: 'sleep', sampleKind: 'sleep' }),
  );
  await expect(repository.list('health_observation')).resolves.toEqual([
    expect.objectContaining({ id: sleepObservationRecordId('night') }),
  ]);
});
