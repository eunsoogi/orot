import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { healthKitAutoSyncCheckpointKey } from '../autoSyncCheckpoint';
import { runHealthKitAutoSync } from '../autoSync';
import { doseSample, medication, now } from '../medications/testSupport';

test('retries authorized medication definitions and dose events on automatic sync', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    await repository.transaction(writer =>
      writer.putSyncCheckpoint({
        key: healthKitAutoSyncCheckpointKey('medications'),
        value: 'requested',
        updatedAt: now,
      }),
    );
    const queryMedicationDefinitions = jest.fn(async () => ({
      availability: 'available' as const,
      status: 'completed' as const,
      readAuthorization: 'notObservable' as const,
      completeSnapshot: true,
      medications: [medication('medication-concept-1', 'Synthetic medication')],
    }));
    const querySampleChanges = jest.fn(async () => ({
      availability: 'available' as const,
      status: 'completed' as const,
      readAuthorization: 'notObservable' as const,
      addedSamples: [doseSample('taken', 'HealthKit source')],
      deletedSampleIds: [],
      cursor: 'dose-anchor-1',
      hasMore: false,
    }));

    const result = await runHealthKitAutoSync({
      repository,
      healthKit: { queryMedicationDefinitions, querySampleChanges },
      now: () => now,
    });

    expect(result).toEqual({
      status: 'complete',
      attemptedFeatures: ['medications'],
    });
    expect(queryMedicationDefinitions).toHaveBeenCalledWith(0);
    expect(querySampleChanges).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'medications',
        sampleKind: 'medicationDoseEvents',
        cursor: null,
      }),
    );
    expect(
      await repository.get('dose_event', 'healthkit-dose-event:new-event-id'),
    ).toMatchObject({
      observationStatus: 'taken',
      medicationDefinitionId: 'healthkit-medication:medication-concept-1',
    });
    expect(
      await repository.get(
        'medication_definition',
        'healthkit-medication:medication-concept-1',
      ),
    ).toMatchObject({
      displayText: 'Synthetic medication',
      medicationConceptIdentifier: 'medication-concept-1',
    });

    // A second app launch reads the saved marker and cursor without duplicating either record.
    const replay = await runHealthKitAutoSync({
      repository,
      healthKit: { queryMedicationDefinitions, querySampleChanges },
      now: () => now,
    });
    expect(replay).toEqual({
      status: 'complete',
      attemptedFeatures: ['medications'],
    });
    expect(await repository.list('medication_definition')).toHaveLength(1);
    expect(await repository.list('dose_event')).toHaveLength(1);
  } finally {
    close();
  }
});
