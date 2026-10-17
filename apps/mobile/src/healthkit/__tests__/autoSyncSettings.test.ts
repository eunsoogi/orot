import { configureHealthKitAutoSync } from '../autoSyncSettings';
import {
  healthKitAutoSyncCheckpointKey,
  loadHealthKitAutoSyncSelection,
  loadHealthKitAutoSyncStatus,
} from '../autoSyncCheckpoint';
import { MemoryObservationRepository } from '../commonObservations/testSupport';
import { healthKitSampleChangesCheckpointKey } from '../sampleChangesCheckpoint';
import { page, sample } from '../sleep/sleepImporterFixtures';

const now = '2026-10-18T12:00:00.000Z';

test('stores the selection before requesting access and syncs selected records', async () => {
  const repository = new MemoryObservationRepository();
  const requestReadAuthorizations = jest.fn(async () => {
    expect(
      await repository.getSyncCheckpoint(
        healthKitAutoSyncCheckpointKey('sleep'),
      ),
    ).toMatchObject({ value: 'requested' });
    return {
      availability: 'available' as const,
      requestStatus: 'completed' as const,
      readAuthorization: 'notObservable' as const,
      requestedFeatures: ['sleep'] as const,
      unsupportedFeatures: [],
    };
  });
  const querySampleChanges = jest.fn(async () =>
    page([sample('night')], 'sleep-anchor'),
  );

  await expect(
    configureHealthKitAutoSync(['sleep'], {
      repository,
      healthKit: { requestReadAuthorizations, querySampleChanges },
      now: () => now,
    }),
  ).resolves.toEqual({ status: 'complete', attemptedFeatures: ['sleep'] });

  expect(requestReadAuthorizations).toHaveBeenCalledWith(['sleep']);
  expect(querySampleChanges).toHaveBeenCalledTimes(1);
  await expect(loadHealthKitAutoSyncSelection(repository)).resolves.toEqual([
    'sleep',
  ]);
  await expect(loadHealthKitAutoSyncStatus(repository)).resolves.toMatchObject({
    status: 'complete',
    updatedAt: now,
  });
});

test('saves disabled choices without requesting access or deleting sample cursors', async () => {
  const repository = new MemoryObservationRepository();
  const querySampleChanges = jest.fn();
  const requestReadAuthorizations = jest.fn();
  const sleepCursorKey = healthKitSampleChangesCheckpointKey('sleep', 'sleep');
  await repository.transaction(writer =>
    writer.putSyncCheckpoint({
      key: sleepCursorKey,
      value: 'sleep-anchor',
      updatedAt: now,
    }),
  );

  await expect(
    configureHealthKitAutoSync([], {
      repository,
      healthKit: { requestReadAuthorizations, querySampleChanges },
      now: () => now,
    }),
  ).resolves.toEqual({ status: 'skipped', attemptedFeatures: [] });

  expect(requestReadAuthorizations).not.toHaveBeenCalled();
  expect(querySampleChanges).not.toHaveBeenCalled();
  await expect(loadHealthKitAutoSyncSelection(repository)).resolves.toEqual([]);
  await expect(
    repository.getSyncCheckpoint(sleepCursorKey),
  ).resolves.toMatchObject({ value: 'sleep-anchor' });
});
