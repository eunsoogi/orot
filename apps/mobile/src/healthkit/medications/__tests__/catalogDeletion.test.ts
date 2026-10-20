import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { syncHealthKitMedications } from '../importer';
import { DOSE_EVENT_CHECKPOINT_KEY } from '../syncTypes';
import { doseSample, medication, now, page } from '../testSupport';

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
