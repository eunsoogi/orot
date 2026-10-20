import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { syncHealthKitMedications } from '../importer';
import { DOSE_EVENT_CHECKPOINT_KEY } from '../syncTypes';
import { doseSample, medication, now, page } from '../testSupport';
import type { HealthKitSampleChangesResult } from '../../types';

test('catalog shrinkage preserves the opaque scope checkpoint until its dose deletion is committed', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    let shrunk = false;
    const first = doseSample('taken', 'Synthetic Health');
    const second = { ...first, id: 'dose-b', medicationConceptIdentifier: 'B' };
    const healthKit = {
      queryMedicationDefinitions: jest.fn(async () => ({
        availability: 'available' as const,
        status: 'completed' as const,
        readAuthorization: 'notObservable' as const,
        completeSnapshot: true,
        medications: shrunk
          ? [medication('B', 'Synthetic B')]
          : [
              medication('medication-concept-1', 'Synthetic A'),
              medication('B', 'Synthetic B'),
            ],
      })),
      // Native policy separately verifies A remains in this opaque cursor's
      // predicate. This boundary verifies reconciliation never discards it.
      querySampleChanges: jest.fn(
        async (query: {
          cursor: string | null;
          resetAnchor?: boolean;
          medicationConceptIdentifiers?: readonly string[];
        }) => {
          if (!shrunk) return page([first, second], 'scope-a-b');
          expect(query.cursor).toBe('scope-a-b');
          expect(query.resetAnchor).toBe(true);
          expect(query.medicationConceptIdentifiers).toEqual(
            expect.arrayContaining(['medication-concept-1', 'B']),
          );
          return page([], 'scope-a-b-after-delete', [first.id]);
        },
      ),
    };
    const options = { repository, healthKit, now: () => now };
    await syncHealthKitMedications(options);
    expect(await repository.list('dose_event')).toHaveLength(2);
    shrunk = true;
    const result = await syncHealthKitMedications({
      ...options,
      refreshDoseHistory: true,
    });
    expect(result.doseEvents.deleted).toBe(1);
    expect(
      await repository.get('dose_event', `healthkit-dose-event:${first.id}`),
    ).toBeNull();
    expect(
      await repository.get('dose_event', 'healthkit-dose-event:dose-b'),
    ).not.toBeNull();
    expect(
      (await repository.getSyncCheckpoint(DOSE_EVENT_CHECKPOINT_KEY))?.value,
    ).toBe('scope-a-b-after-delete');
  } finally {
    await close();
  }
});

test.each(['unavailable', 'query failure', 'checkpoint failure'])(
  'legacy catalog scope survives %s before its first durable migration page',
  async failure => {
    const { database, close } = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(database);
      const repository = createRecordRepository(database);
      let shrunk = false;
      let failOnce = true;
      let failCheckpoint = false;
      const first = doseSample('taken', 'Synthetic Health');
      const second = {
        ...first,
        id: 'dose-b',
        medicationConceptIdentifier: 'B',
      };
      const options = {
        repository: {
          ...repository,
          transaction: <T>(
            operation: Parameters<typeof repository.transaction<T>>[0],
          ) =>
            repository.transaction(writer =>
              operation({
                ...writer,
                putSyncCheckpoint: async checkpoint => {
                  if (failCheckpoint) {
                    failCheckpoint = false;
                    throw new Error('Synthetic checkpoint failure');
                  }
                  await writer.putSyncCheckpoint(checkpoint);
                },
              }),
            ),
        },
        now: () => now,
        healthKit: {
          queryMedicationDefinitions: jest.fn(async () => ({
            availability: 'available' as const,
            status: 'completed' as const,
            readAuthorization: 'notObservable' as const,
            completeSnapshot: true,
            medications: shrunk
              ? [medication('B', 'Synthetic B')]
              : [
                  medication('medication-concept-1', 'Synthetic A'),
                  medication('B', 'Synthetic B'),
                ],
          })),
          querySampleChanges: jest.fn(
            async (query: {
              medicationConceptIdentifiers?: readonly string[];
            }): Promise<HealthKitSampleChangesResult> => {
              if (!shrunk) return page([first, second], 'legacy-scope');
              expect(query.medicationConceptIdentifiers).toEqual(
                expect.arrayContaining(['medication-concept-1', 'B']),
              );
              if (failOnce) {
                failOnce = false;
                if (failure === 'unavailable')
                  return {
                    availability: 'unavailable',
                    status: 'notRun',
                    readAuthorization: 'notObservable',
                  };
                if (failure === 'query failure')
                  throw new Error('Synthetic query failure');
                failCheckpoint = true;
              }
              return page([], 'durable-scope-after-delete', [first.id]);
            },
          ),
        },
      };
      await syncHealthKitMedications(options);
      shrunk = true;
      if (failure === 'unavailable') {
        expect(
          (await syncHealthKitMedications(options)).doseEvents.status,
        ).toBe('notRun');
      } else {
        await expect(syncHealthKitMedications(options)).rejects.toThrow(
          'Synthetic',
        );
      }
      // A catalog row is the only durable concept source for this legacy anchor.
      // Losing it before a committed scope would make the retry miss A's tombstone.
      expect(
        await repository.get(
          'medication_definition',
          'healthkit-medication:medication-concept-1',
        ),
      ).not.toBeNull();
      expect(
        await repository.get('dose_event', `healthkit-dose-event:${first.id}`),
      ).not.toBeNull();
      expect(
        (await repository.getSyncCheckpoint(DOSE_EVENT_CHECKPOINT_KEY))?.value,
      ).toBe('legacy-scope');
      const retried = await syncHealthKitMedications(options);
      expect(retried.doseEvents.deleted).toBe(1);
      expect(
        await repository.get('dose_event', `healthkit-dose-event:${first.id}`),
      ).toBeNull();
      expect(
        await repository.get('dose_event', 'healthkit-dose-event:dose-b'),
      ).not.toBeNull();
    } finally {
      await close();
    }
  },
);
