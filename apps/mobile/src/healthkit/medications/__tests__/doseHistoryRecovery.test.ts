import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { syncHealthKitMedications } from '../importer';
import { DOSE_EVENT_CHECKPOINT_KEY } from '../syncTypes';
import { doseSample, medication, now, page } from '../testSupport';
import { createUnifiedFeatureImporter } from '../../unifiedImport/featureImporter';
import { configureHealthKitAutoSync } from '../../autoSyncSettings';
import { healthKitSampleChangesCheckpointKey } from '../../sampleChangesCheckpoint';

test('does not reuse an unscoped medication anchor for the medication-scoped query', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    const legacyKey = healthKitSampleChangesCheckpointKey(
      'medications',
      'medicationDoseEvents',
    );
    await repository.transaction(writer =>
      writer.putSyncCheckpoint({
        key: legacyKey,
        value: 'empty-unscoped-anchor',
        updatedAt: now,
      }),
    );
    const querySampleChanges = jest.fn(async () =>
      page([doseSample('taken', 'Health')], 'scoped-anchor'),
    );
    await syncHealthKitMedications({
      repository,
      now: () => now,
      healthKit: {
        querySampleChanges,
        queryMedicationDefinitions: jest.fn().mockResolvedValue({
          availability: 'available',
          status: 'completed',
          readAuthorization: 'notObservable',
          completeSnapshot: true,
          medications: [medication('medication-concept-1', 'Example')],
        }),
      },
    });
    expect(querySampleChanges).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: null }),
    );
    expect((await repository.getSyncCheckpoint(legacyKey))?.value).toBe(
      'empty-unscoped-anchor',
    );
    expect(
      (await repository.getSyncCheckpoint(DOSE_EVENT_CHECKPOINT_KEY))?.value,
    ).toBe('scoped-anchor');
    expect(await repository.list('dose_event')).toHaveLength(1);
  } finally {
    await close();
  }
});

/** A prior empty anchor must not prevent explicit recovery of Health's existing dose history. */
test('explicit dose-history refresh replays bounded pages while automatic sync retains its anchor', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    await repository.transaction(writer =>
      writer.putSyncCheckpoint({
        key: DOSE_EVENT_CHECKPOINT_KEY,
        value: 'previously-empty',
        updatedAt: now,
      }),
    );
    const first = {
      ...doseSample('taken', 'Health'),
      scheduledDate: '2026-10-01T07:00:00.000Z',
    };
    const second = {
      ...first,
      id: 'second-dose',
      startDate: '2026-10-02T09:15:00.000Z',
      endDate: '2026-10-02T09:15:00.000Z',
    };
    const querySampleChanges = jest.fn(
      async ({
        cursor,
        resetAnchor,
      }: {
        cursor: string | null;
        resetAnchor?: boolean;
      }) =>
        resetAnchor || cursor === null
          ? page([first], 'page-one', [], true)
          : cursor === 'page-one'
            ? page([second], 'reconciled')
            : page([], cursor),
    );
    const options = {
      repository,
      now: () => now,
      healthKit: {
        querySampleChanges,
        queryMedicationDefinitions: jest.fn().mockResolvedValue({
          availability: 'available',
          status: 'completed',
          readAuthorization: 'notObservable',
          completeSnapshot: true,
          medications: [medication('medication-concept-1', 'Example')],
        }),
      },
    };
    await syncHealthKitMedications(options);
    expect(querySampleChanges.mock.calls[0][0].cursor).toBe('previously-empty');
    expect(await repository.list('dose_event')).toHaveLength(0);

    const recovery = { ...options, refreshDoseHistory: true };
    const result = await syncHealthKitMedications(recovery);
    expect(result.doseEvents).toMatchObject({
      status: 'completed',
      upserted: 2,
    });
    expect(
      querySampleChanges.mock.calls.slice(1).map(([query]) => query.cursor),
    ).toEqual(['previously-empty', 'page-one']);
    expect(querySampleChanges.mock.calls[1][0].resetAnchor).toBe(true);
    expect(querySampleChanges.mock.calls[2][0].resetAnchor).toBeUndefined();
    expect(
      await repository.get('dose_event', 'healthkit-dose-event:new-event-id'),
    ).toMatchObject({
      observationStatus: 'taken',
      effectiveAt: first.startDate,
      scheduledAt: first.scheduledDate,
      ingestedAt: now,
    });
    expect(
      await repository.get('dose_event', 'healthkit-dose-event:second-dose'),
    ).toMatchObject({
      effectiveAt: second.startDate,
    });
    expect(
      (await repository.getSyncCheckpoint(DOSE_EVENT_CHECKPOINT_KEY))?.value,
    ).toBe('reconciled');

    const repeated = await syncHealthKitMedications(recovery);
    expect(repeated.doseEvents.upserted).toBe(0);
    expect(await repository.list('dose_event')).toHaveLength(2);
    await configureHealthKitAutoSync(['medications'], {
      ...options,
      healthKit: {
        ...options.healthKit,
        requestReadAuthorizations: jest.fn().mockResolvedValue({
          availability: 'available',
          requestStatus: 'completed',
          readAuthorization: 'notObservable',
        }),
      },
    });
    expect(
      querySampleChanges.mock.calls.slice(-2).map(([query]) => query.cursor),
    ).toEqual(['reconciled', 'page-one']);
    await syncHealthKitMedications(options);
    expect(querySampleChanges.mock.calls.at(-1)?.[0].cursor).toBe('reconciled');
    expect(
      querySampleChanges.mock.calls.every(
        ([query]) => 'limit' in query && query.limit === 200,
      ),
    ).toBe(true);
    const explicitImport = createUnifiedFeatureImporter({
      healthKit: options.healthKit,
      now: options.now,
    });
    await explicitImport(
      'medications',
      {
        availability: 'available',
        requestStatus: 'completed',
        readAuthorization: 'notObservable',
      },
      repository,
      { query: operation => operation(), persist: operation => operation() },
    );
    expect(
      querySampleChanges.mock.calls.slice(-2).map(([query]) => query.cursor),
    ).toEqual(['reconciled', 'page-one']);
    expect(await repository.list('dose_event')).toHaveLength(2);
  } finally {
    await close();
  }
});
