import { healthKitSampleChangesCheckpointKey } from '../../sampleChangesCheckpoint';
import { syncCommonObservationChanges } from '../sync';
import { healthKitSample, MemoryObservationRepository } from '../testSupport';
import { healthKit, observedAt, page } from '../testSyncSupport';

const key = healthKitSampleChangesCheckpointKey('heartRate', 'heartRate');

describe('incremental common observation import', () => {
  it('stores a typed observation and its source metadata with the page cursor', async () => {
    const repository = new MemoryObservationRepository();
    const health = healthKit([
      page({
        addedSamples: [
          healthKitSample('heartRate', {
            sourceVersion: '4.2',
            sourceProductType: 'Watch7,2',
            device: { manufacturer: 'Apple', model: 'Watch' },
          }),
        ],
        cursor: 'anchor-1',
      }),
    ]);

    const result = await syncCommonObservationChanges({
      feature: 'heartRate',
      healthKit: health,
      repository,
      now: () => observedAt,
    });

    expect(health.requestReadAuthorization).toHaveBeenCalledWith('heartRate');
    expect(health.querySampleChanges).toHaveBeenCalledWith({
      feature: 'heartRate',
      sampleKind: 'heartRate',
      limit: 200,
      cursor: null,
    });
    expect(result).toMatchObject({
      status: 'complete',
      upserted: 1,
      deleted: 0,
    });
    expect(repository.read('healthkit:heartRate:sample-1')).toMatchObject({
      effectiveAt: '2026-10-04T10:00:00.000Z',
      endedAt: '2026-10-04T10:00:00.000Z',
      ingestedAt: observedAt,
      observationKind: 'measurement',
      concept: 'heart_rate',
      provenance: {
        origin: 'imported',
        sourceRecordIds: ['sample-1'],
        source: {
          system: 'healthkit',
          sourceIdentifier: 'com.example.watch',
          sourceName: 'Synthetic Watch',
          sourceVersion: '4.2',
          productType: 'Watch7,2',
          device: { manufacturer: 'Apple', model: 'Watch' },
        },
      },
      value: {
        kind: 'quantity',
        amount: 72,
        unit: 'count/min',
        sourceRepresentation: {
          status: 'unavailable',
          reason: 'healthkit_does_not_expose_original_display_unit',
        },
      },
    });
    expect(
      repository.read('healthkit:heartRate:sample-1')?.recordedAt,
    ).toBeUndefined();
    expect(await repository.getSyncCheckpoint(key)).toMatchObject({
      key,
      value: 'anchor-1',
      updatedAt: observedAt,
    });
  });

  it('commits each page before requesting the next one', async () => {
    const repository = new MemoryObservationRepository();
    const querySampleChanges = jest
      .fn()
      .mockImplementationOnce(async () =>
        page({
          addedSamples: [healthKitSample('heartRate')],
          cursor: 'anchor-1',
          hasMore: true,
        }),
      )
      .mockImplementationOnce(async () => {
        expect(repository.transactionsCommitted).toBe(1);
        expect(await repository.getSyncCheckpoint(key)).toMatchObject({
          value: 'anchor-1',
        });
        expect(repository.read('healthkit:heartRate:sample-1')).not.toBeNull();
        return page({
          addedSamples: [healthKitSample('heartRate', { id: 'sample-2' })],
          cursor: 'anchor-2',
        });
      });
    const health = {
      ...healthKit([]),
      querySampleChanges,
    };

    const result = await syncCommonObservationChanges({
      feature: 'heartRate',
      healthKit: health,
      repository,
      now: () => observedAt,
    });

    expect(result).toMatchObject({
      status: 'complete',
      upserted: 2,
      cursorAdvanced: true,
    });
    expect(querySampleChanges).toHaveBeenCalledTimes(2);
    expect(await repository.getSyncCheckpoint(key)).toMatchObject({
      value: 'anchor-2',
    });
  });

  it('replays changed samples by ID and preserves the first ingest time for identical data', async () => {
    const repository = new MemoryObservationRepository();
    const first = await syncCommonObservationChanges({
      feature: 'heartRate',
      healthKit: healthKit([
        page({ addedSamples: [healthKitSample('heartRate')], cursor: 'a1' }),
      ]),
      repository,
      now: () => observedAt,
    });
    const replay = await syncCommonObservationChanges({
      feature: 'heartRate',
      healthKit: healthKit([
        page({ addedSamples: [healthKitSample('heartRate')], cursor: 'a2' }),
      ]),
      repository,
      now: () => '2026-10-05T11:00:00.000Z',
    });

    expect(first.upserted).toBe(1);
    expect(replay).toMatchObject({
      status: 'empty',
      upserted: 0,
      cursorAdvanced: true,
    });
    expect(repository.read('healthkit:heartRate:sample-1')?.ingestedAt).toBe(
      observedAt,
    );

    const changed = await syncCommonObservationChanges({
      feature: 'heartRate',
      healthKit: healthKit([
        page({
          addedSamples: [
            healthKitSample('heartRate', {
              value: 81,
              sourceName: 'Updated Watch',
            }),
          ],
          cursor: 'a3',
        }),
      ]),
      repository,
      now: () => '2026-10-05T12:00:00.000Z',
    });
    expect(changed.upserted).toBe(1);
    expect(repository.read('healthkit:heartRate:sample-1')).toMatchObject({
      ingestedAt: '2026-10-05T12:00:00.000Z',
      value: { kind: 'quantity', amount: 81 },
      provenance: { source: { sourceName: 'Updated Watch' } },
    });
  });
});
