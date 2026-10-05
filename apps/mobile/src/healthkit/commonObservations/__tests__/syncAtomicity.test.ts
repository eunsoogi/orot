import type { HealthKitNativeModule } from '../../types';
import { healthKitSampleChangesCheckpointKey } from '../../sampleChangesCheckpoint';
import { syncCommonObservationChanges } from '../sync';
import { healthKitSample, MemoryObservationRepository } from '../testSupport';
import { healthKit, observedAt, page } from '../testSyncSupport';

const key = healthKitSampleChangesCheckpointKey('heartRate', 'heartRate');

describe('common observation change transaction boundaries', () => {
  it('applies sample-ID deletions and the new cursor in the same transaction', async () => {
    const repository = new MemoryObservationRepository();
    repository.seed({
      id: 'healthkit:heartRate:sample-1',
      effectiveAt: '2026-10-04T10:00:00.000Z',
      ingestedAt: observedAt,
      provenance: {
        origin: 'imported',
        sourceRecordIds: ['sample-1'],
        source: { system: 'healthkit' },
      },
      reviewState: { status: 'unreviewed' },
      observationKind: 'measurement',
      concept: 'heart_rate',
      value: { kind: 'quantity', amount: 72, unit: 'count/min' },
    });

    const result = await syncCommonObservationChanges({
      feature: 'heartRate',
      healthKit: healthKit([
        page({ deletedSampleIds: ['sample-1'], cursor: 'a4' }),
      ]),
      repository,
      now: () => observedAt,
    });

    expect(result).toMatchObject({ status: 'complete', deleted: 1 });
    expect(repository.read('healthkit:heartRate:sample-1')).toBeNull();
    expect(await repository.getSyncCheckpoint(key)).toMatchObject({
      value: 'a4',
    });
  });

  it('rolls back observation writes when saving a page transaction fails', async () => {
    const repository = new MemoryObservationRepository();
    repository.failNextTransaction = new Error('transaction failed');

    await expect(
      syncCommonObservationChanges({
        feature: 'heartRate',
        healthKit: healthKit([
          page({ addedSamples: [healthKitSample('heartRate')], cursor: 'a5' }),
        ]),
        repository,
        now: () => observedAt,
      }),
    ).rejects.toThrow('transaction failed');
    expect(repository.read('healthkit:heartRate:sample-1')).toBeNull();
    expect(await repository.getSyncCheckpoint(key)).toBeNull();
    expect(repository.transactionsCommitted).toBe(0);
  });

  it('keeps authorization opaque and does not advance past unsupported data', async () => {
    const repository = new MemoryObservationRepository();
    const unsupported = {
      requestReadAuthorization: jest.fn().mockResolvedValue({
        availability: 'unsupportedFeature',
        requestStatus: 'notRequested',
        readAuthorization: 'notObservable',
      }),
      querySampleChanges: jest.fn(),
    } as unknown as Pick<
      HealthKitNativeModule,
      'requestReadAuthorization' | 'querySampleChanges'
    >;
    const unavailable = await syncCommonObservationChanges({
      feature: 'heartRate',
      healthKit: unsupported,
      repository,
      now: () => observedAt,
    });
    expect(unavailable.status).toBe('unsupportedFeature');
    expect(unsupported.querySampleChanges).not.toHaveBeenCalled();

    const malformed = await syncCommonObservationChanges({
      feature: 'heartRate',
      healthKit: healthKit([
        page({
          addedSamples: [healthKitSample('heartRate', { unit: 'beats/min' })],
          cursor: 'a6',
        }),
      ]),
      repository,
      now: () => observedAt,
    });
    expect(malformed.status).toBe('unsupportedData');
    expect(malformed.skipped).toBe(1);
    expect(await repository.getSyncCheckpoint(key)).toBeNull();
  });
});
