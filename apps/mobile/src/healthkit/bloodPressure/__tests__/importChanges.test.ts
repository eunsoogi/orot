import { applyBloodPressureChanges } from '../importChanges';
import type { BloodPressureChangePage } from '../types';
import {
  correlation,
  createMemoryBloodPressureRepository,
  observationId,
} from '../testSupport';

function page(
  addedSamples: BloodPressureChangePage['addedSamples'] = [],
  deletedSampleIds: readonly string[] = [],
  cursor: string | null = null,
): BloodPressureChangePage {
  return {
    availability: 'available',
    status: 'completed',
    readAuthorization: 'notObservable',
    addedSamples,
    deletedSampleIds,
    cursor,
    hasMore: false,
  };
}

describe('applyBloodPressureChanges', () => {
  it('stores both readings and advances the cursor in one transaction', async () => {
    const store = createMemoryBloodPressureRepository();
    const applied = await applyBloodPressureChanges(
      store.repository,
      page([correlation()], [], 'cursor-1'),
      null,
      () => '2026-10-05T10:00:00.000Z',
    );

    expect(applied).toEqual({
      upserted: 2,
      deleted: 0,
      cursorAdvanced: true,
    });
    expect(store.observations()).toHaveLength(2);
    expect(store.checkpoint('healthkit:bloodPressure:bloodPressure')).toEqual({
      key: 'healthkit:bloodPressure:bloodPressure',
      value: 'cursor-1',
      updatedAt: '2026-10-05T10:00:00.000Z',
    });
  });

  it('keeps replays idempotent and refreshes changed readings without changing ingest time', async () => {
    const store = createMemoryBloodPressureRepository();
    const now = () => '2026-10-05T10:00:00.000Z';
    await applyBloodPressureChanges(
      store.repository,
      page([correlation()], [], 'cursor-1'),
      null,
      now,
    );
    const replay = await applyBloodPressureChanges(
      store.repository,
      page([correlation()], [], 'cursor-1'),
      'cursor-1',
      () => '2026-10-06T10:00:00.000Z',
    );

    expect(replay.upserted).toBe(0);
    expect(store.observations()).toHaveLength(2);
    expect(
      store.observations().every(record => record.ingestedAt === now()),
    ).toBe(true);

    const changed = await applyBloodPressureChanges(
      store.repository,
      page([correlation('correlation-1', 130, 85)], [], 'cursor-1'),
      'cursor-1',
      () => '2026-10-07T10:00:00.000Z',
    );
    expect(changed.upserted).toBe(2);
    expect(
      store
        .observations()
        .find(
          record => record.id === observationId('correlation-1', 'systolic'),
        )?.value,
    ).toMatchObject({ amount: 130, unit: 'mmHg' });
    expect(
      store.observations().every(record => record.ingestedAt === now()),
    ).toBe(true);
  });

  it('deletes only explicit correlations and removes a missing component on update', async () => {
    const store = createMemoryBloodPressureRepository();
    const now = () => '2026-10-05T10:00:00.000Z';
    await applyBloodPressureChanges(
      store.repository,
      page([correlation('keep'), correlation('remove')], [], 'cursor-1'),
      null,
      now,
    );
    await applyBloodPressureChanges(
      store.repository,
      page([], [], 'cursor-1'),
      'cursor-1',
      now,
    );
    expect(store.observations()).toHaveLength(4);

    const partial = correlation('keep');
    await applyBloodPressureChanges(
      store.repository,
      page(
        [
          {
            ...partial,
            components: partial.components?.filter(component =>
              component.typeIdentifier.includes('Systolic'),
            ),
          },
        ],
        [],
        'cursor-1',
      ),
      'cursor-1',
      now,
    );
    expect(store.observations()).toHaveLength(3);
    expect(
      store
        .observations()
        .some(record => record.id === observationId('keep', 'diastolic')),
    ).toBe(false);

    const deletion = await applyBloodPressureChanges(
      store.repository,
      page([], ['remove'], 'cursor-1'),
      'cursor-1',
      now,
    );
    expect(deletion.deleted).toBe(2);
    expect(store.observations()).toHaveLength(1);
    await applyBloodPressureChanges(
      store.repository,
      page([], ['remove'], 'cursor-1'),
      'cursor-1',
      now,
    );
    expect(store.observations()).toHaveLength(1);
  });

  it('rejects conflicting add/delete IDs and rolls back values when checkpoint persistence fails', async () => {
    const conflictStore = createMemoryBloodPressureRepository();
    await expect(
      applyBloodPressureChanges(
        conflictStore.repository,
        page([correlation()], ['correlation-1'], 'cursor-1'),
        null,
        () => '2026-10-05T10:00:00.000Z',
      ),
    ).rejects.toThrow('conflicting blood-pressure correlation IDs');

    const failedStore = createMemoryBloodPressureRepository();
    failedStore.failNextCheckpointWrite();
    await expect(
      applyBloodPressureChanges(
        failedStore.repository,
        page([correlation()], [], 'cursor-1'),
        null,
        () => '2026-10-05T10:00:00.000Z',
      ),
    ).rejects.toThrow('simulated checkpoint write failure');
    expect(failedStore.observations()).toHaveLength(0);
    expect(
      failedStore.checkpoint('healthkit:bloodPressure:bloodPressure'),
    ).toBeNull();
  });
});
