import {
  commonObservationRecordId,
  mapCommonObservationSample,
  toCommonObservationRecord,
} from '../mapper';
import type { CommonObservationMapperInput } from '../types';

function sample(
  typeIdentifier: string,
  unit: string,
  overrides: Partial<CommonObservationMapperInput> = {},
): CommonObservationMapperInput {
  return {
    id: 'sample-1',
    typeIdentifier,
    startDate: '2026-10-04T10:00:00.000Z',
    endDate: '2026-10-04T10:00:00.000Z',
    sourceIdentifier: 'com.example.watch',
    sourceName: 'Synthetic Watch',
    value: 72,
    unit,
    ...overrides,
  };
}

describe('common HealthKit observation mapping', () => {
  it.each([
    ['heartRate', 'HKQuantityTypeIdentifierHeartRate', 'count/min', 72],
    ['steps', 'HKQuantityTypeIdentifierStepCount', 'count', 1200],
    ['bodyMass', 'HKQuantityTypeIdentifierBodyMass', 'kg', 68.4],
  ] as const)(
    'preserves units, source identity and time range for %s',
    (feature, typeIdentifier, unit, value) => {
      const result = mapCommonObservationSample(
        feature,
        sample(typeIdentifier, unit, {
          value,
          startDate: '2026-10-04T09:59:00.000Z',
          endDate: '2026-10-04T10:00:00.000Z',
        }),
      );

      expect(result.status).toBe('mapped');
      if (result.status !== 'mapped') return;
      expect(result.observation).toMatchObject({
        feature,
        observationKind: 'measurement',
        concept: {
          heartRate: 'heart_rate',
          steps: 'step_count',
          bodyMass: 'body_mass',
        }[feature],
        typeIdentifier,
        value: { kind: 'quantity', unit, amount: value },
        sourceSampleId: 'sample-1',
        sourceIdentifier: 'com.example.watch',
        sourceName: 'Synthetic Watch',
        startDate: '2026-10-04T09:59:00.000Z',
        endDate: '2026-10-04T10:00:00.000Z',
      });
    },
  );

  it('uses a stable sample-keyed record id for repeated samples', () => {
    const snapshot = sample('HKQuantityTypeIdentifierStepCount', 'count');
    const first = mapCommonObservationSample('steps', snapshot);
    const second = mapCommonObservationSample('steps', snapshot);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: 'mapped',
      observation: {
        recordId: 'healthkit:steps:sample-1',
      },
    });
  });

  it('stores normalized quantities with provenance and no invented source time', () => {
    const result = mapCommonObservationSample(
      'bodyMass',
      sample('HKQuantityTypeIdentifierBodyMass', 'kg', {
        value: 68.4,
        sourceVersion: '4.2',
        sourceProductType: 'Watch7,2',
        device: { manufacturer: 'Apple', model: 'Watch' },
      }),
    );
    if (result.status !== 'mapped')
      throw new Error('Expected a mapped HealthKit sample.');

    const record = toCommonObservationRecord(
      result.observation,
      '2026-10-05T10:00:00.000Z',
    );
    expect(record).toMatchObject({
      id: 'healthkit:bodyMass:sample-1',
      effectiveAt: '2026-10-04T10:00:00.000Z',
      endedAt: '2026-10-04T10:00:00.000Z',
      observationKind: 'measurement',
      concept: 'body_mass',
      value: {
        kind: 'quantity',
        amount: 68.4,
        unit: 'kg',
        sourceRepresentation: { status: 'unavailable' },
      },
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
      reviewState: { status: 'unreviewed' },
    });
    expect(record.recordedAt).toBeUndefined();
  });

  it('rebuilds the same record id from a deletion sample ID', () => {
    const sourceA = mapCommonObservationSample(
      'steps',
      sample('HKQuantityTypeIdentifierStepCount', 'count'),
    );
    const sourceB = mapCommonObservationSample(
      'steps',
      sample('HKQuantityTypeIdentifierStepCount', 'count', {
        sourceIdentifier: 'com.example.phone',
      }),
    );

    expect(commonObservationRecordId('steps', 'sample-1')).toBe(
      'healthkit:steps:sample-1',
    );
    expect(sourceA).toMatchObject({
      status: 'mapped',
      observation: { recordId: 'healthkit:steps:sample-1' },
    });
    expect(sourceB).toMatchObject({
      status: 'mapped',
      observation: {
        recordId: 'healthkit:steps:sample-1',
        sourceIdentifier: 'com.example.phone',
      },
    });
  });

  it.each([
    [
      'heartRate',
      'wrongSampleType',
      sample('HKQuantityTypeIdentifierBodyMass', 'kg'),
    ],
    [
      'heartRate',
      'missingIdentity',
      sample('HKQuantityTypeIdentifierHeartRate', 'count/min', { id: '' }),
    ],
    [
      'steps',
      'invalidTimeRange',
      sample('HKQuantityTypeIdentifierStepCount', 'count', {
        startDate: '2026-10-05T00:00:00.000Z',
        endDate: '2026-10-04T00:00:00.000Z',
      }),
    ],
    [
      'steps',
      'invalidTimeRange',
      sample('HKQuantityTypeIdentifierStepCount', 'count', {
        startDate: '2026-02-30T10:00:00.000Z',
      }),
    ],
    [
      'heartRate',
      'invalidTimeRange',
      sample('HKQuantityTypeIdentifierHeartRate', 'count/min', {
        startDate: '2026-10-04T10:00:00.0002Z',
        endDate: '2026-10-04T10:00:00.0001Z',
      }),
    ],
    [
      'bodyMass',
      'invalidValue',
      sample('HKQuantityTypeIdentifierBodyMass', 'kg', { value: Number.NaN }),
    ],
    [
      'bodyMass',
      'unsupportedUnit',
      sample('HKQuantityTypeIdentifierBodyMass', 'pounds'),
    ],
  ] as const)(
    'does not import a malformed sample (%s)',
    (feature, reason, snapshot) => {
      expect(mapCommonObservationSample(feature, snapshot)).toEqual({
        status: 'skipped',
        reason,
      });
    },
  );

  it('keeps missing quantity evidence distinct from zero and unsupported units', () => {
    expect(
      mapCommonObservationSample(
        'steps',
        sample('HKQuantityTypeIdentifierStepCount', 'count', {
          value: undefined,
        }),
      ),
    ).toEqual({ status: 'skipped', reason: 'missingValue' });
    expect(
      mapCommonObservationSample(
        'steps',
        sample('HKQuantityTypeIdentifierStepCount', 'count', {
          unit: undefined,
        }),
      ),
    ).toEqual({ status: 'skipped', reason: 'missingUnit' });
    expect(
      mapCommonObservationSample(
        'steps',
        sample('HKQuantityTypeIdentifierStepCount', 'count', { value: 0 }),
      ),
    ).toMatchObject({
      status: 'mapped',
      observation: { value: { kind: 'quantity', amount: 0, unit: 'count' } },
    });
  });
});
