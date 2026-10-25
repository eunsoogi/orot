import { healthKitSampleChangesCheckpointKey } from '../sampleChangesCheckpoint';
import {
  healthKitAutoSyncCheckpointKey,
  loadHealthKitAutoSyncSelection,
  saveHealthKitAutoSyncSelection,
} from '../autoSyncCheckpoint';
import { MemoryObservationRepository } from '../commonObservations/testSupport';

const now = '2026-10-18T12:00:00.000Z';

test('persists automatic-sync choices without deleting records or cursors', async () => {
  const repository = new MemoryObservationRepository();
  const sleepCursorKey = healthKitSampleChangesCheckpointKey('sleep', 'sleep');
  await repository.transaction(writer =>
    writer.putSyncCheckpoint({
      key: sleepCursorKey,
      value: 'sleep-anchor',
      updatedAt: now,
    }),
  );

  await saveHealthKitAutoSyncSelection(
    repository,
    ['medications', 'sleep'],
    () => now,
  );

  await expect(loadHealthKitAutoSyncSelection(repository)).resolves.toEqual([
    'medications',
    'sleep',
  ]);
  await expect(
    repository.getSyncCheckpoint(healthKitAutoSyncCheckpointKey('sleep')),
  ).resolves.toMatchObject({ value: 'requested', updatedAt: now });
  await expect(
    repository.getSyncCheckpoint(
      healthKitAutoSyncCheckpointKey('bloodPressure'),
    ),
  ).resolves.toMatchObject({ value: 'disabled', updatedAt: now });
  await expect(
    repository.getSyncCheckpoint(sleepCursorKey),
  ).resolves.toMatchObject({ value: 'sleep-anchor' });
});
