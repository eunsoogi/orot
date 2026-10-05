import type {
  HealthKitNativeModule,
  HealthKitSampleChangesResult,
} from '../../types';
import { importCommonObservations } from '../importer';
import { healthKitSample, MemoryObservationRepository } from '../testSupport';

function page(
  values: Partial<
    Extract<HealthKitSampleChangesResult, { status: 'completed' }>
  > = {},
): HealthKitSampleChangesResult {
  return {
    availability: 'available',
    status: 'completed',
    readAuthorization: 'notObservable',
    addedSamples: [],
    deletedSampleIds: [],
    cursor: null,
    hasMore: false,
    ...values,
  };
}

function healthKit(
  pages: HealthKitSampleChangesResult[],
): Pick<
  HealthKitNativeModule,
  'requestReadAuthorization' | 'querySampleChanges'
> {
  return {
    requestReadAuthorization: jest.fn().mockImplementation(async feature =>
      feature === 'bodyMass'
        ? {
            availability: 'unsupportedFeature',
            requestStatus: 'notRequested',
            readAuthorization: 'notObservable',
          }
        : {
            availability: 'available',
            requestStatus: 'completed',
            readAuthorization: 'notObservable',
          },
    ),
    querySampleChanges: jest.fn().mockImplementation(async () => {
      const next = pages.shift();
      if (!next) throw new Error('Unexpected HealthKit page request.');
      return next;
    }),
  };
}

describe('common observation import selection and status', () => {
  it('imports only selected types and reports a mixed unsupported result as partial', async () => {
    const repository = new MemoryObservationRepository();
    const health = healthKit([
      page({
        addedSamples: [healthKitSample('heartRate')],
        cursor: 'heart-rate-anchor',
      }),
    ]);

    const result = await importCommonObservations({
      features: ['heartRate', 'bodyMass'],
      healthKit: health,
      repository,
      now: () => '2026-10-05T10:00:00.000Z',
    });

    expect(health.requestReadAuthorization).toHaveBeenNthCalledWith(
      1,
      'heartRate',
    );
    expect(health.requestReadAuthorization).toHaveBeenNthCalledWith(
      2,
      'bodyMass',
    );
    expect(health.querySampleChanges).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'partial',
      importedCount: 1,
      deletedCount: 0,
      unsupportedCount: 0,
      readAuthorization: 'notObservable',
    });
  });

  it('keeps overlapping step samples as separate source records', async () => {
    const repository = new MemoryObservationRepository();
    const result = await importCommonObservations({
      features: ['steps'],
      healthKit: healthKit([
        page({
          addedSamples: [
            healthKitSample('steps', {
              id: 'watch-1',
              sourceIdentifier: 'com.example.watch',
              startDate: '2026-10-04T10:00:00.000Z',
              endDate: '2026-10-04T10:10:00.000Z',
              value: 120,
            }),
            healthKitSample('steps', {
              id: 'phone-1',
              sourceIdentifier: 'com.example.phone',
              startDate: '2026-10-04T10:05:00.000Z',
              endDate: '2026-10-04T10:15:00.000Z',
              value: 100,
            }),
          ],
          cursor: 'step-anchor',
        }),
      ]),
      repository,
      now: () => '2026-10-05T10:00:00.000Z',
    });

    expect(result).toMatchObject({
      status: 'complete',
      importedCount: 2,
    });
    const records = await repository.list('health_observation');
    expect(records).toHaveLength(2);
    const bySource = new Map(
      records.map(record => [
        record.provenance.source?.sourceIdentifier,
        record,
      ]),
    );
    expect(bySource.get('com.example.watch')).toMatchObject({
      id: 'healthkit:steps:watch-1',
      effectiveAt: '2026-10-04T10:00:00.000Z',
      endedAt: '2026-10-04T10:10:00.000Z',
      provenance: {
        sourceRecordIds: ['watch-1'],
        source: { sourceIdentifier: 'com.example.watch' },
      },
      value: { kind: 'quantity', amount: 120, unit: 'count' },
    });
    expect(bySource.get('com.example.phone')).toMatchObject({
      id: 'healthkit:steps:phone-1',
      effectiveAt: '2026-10-04T10:05:00.000Z',
      endedAt: '2026-10-04T10:15:00.000Z',
      provenance: {
        sourceRecordIds: ['phone-1'],
        source: { sourceIdentifier: 'com.example.phone' },
      },
      value: { kind: 'quantity', amount: 100, unit: 'count' },
    });
  });

  it('distinguishes unchanged data from a denied authorization claim', async () => {
    const repository = new MemoryObservationRepository();
    const health = healthKit([page({ cursor: 'empty-anchor' })]);
    const result = await importCommonObservations({
      features: ['bodyMass'],
      healthKit: {
        ...health,
        requestReadAuthorization: jest.fn().mockResolvedValue({
          availability: 'available',
          requestStatus: 'completed',
          readAuthorization: 'notObservable',
        }),
      },
      repository,
      now: () => '2026-10-05T10:00:00.000Z',
    });

    expect(result).toMatchObject({
      status: 'empty',
      importedCount: 0,
      readAuthorization: 'notObservable',
    });
  });
});
