import { mapBloodPressureCorrelation } from '../mapper';
import {
  bloodPressureObservationId,
  bloodPressureSampleTypeIdentifiers as typeIds,
} from '../types';
import type { HealthKitSampleSnapshot } from '../../types';

const timestamp = '2026-10-02T12:34:56.123456789+09:00';
const originalDisplayUnitUnavailable = {
  status: 'unavailable' as const,
  reason: 'healthkit_does_not_expose_original_display_unit' as const,
};

function component(
  id: string,
  typeIdentifier: string,
  value: number,
  unit: string,
): HealthKitSampleSnapshot {
  return {
    id,
    typeIdentifier,
    startDate: timestamp,
    endDate: '2026-10-02T12:34:57.000000001+09:00',
    sourceIdentifier: 'com.example.device',
    sourceName: 'Blood pressure monitor',
    sourceVersion: '3.1',
    device: { manufacturer: 'Example', model: 'Monitor 1' },
    value,
    unit,
    sourceRepresentation: originalDisplayUnitUnavailable,
  };
}

function correlation(
  components: readonly HealthKitSampleSnapshot[],
): HealthKitSampleSnapshot {
  return {
    id: 'healthkit-correlation-1',
    typeIdentifier: typeIds.correlation,
    startDate: timestamp,
    endDate: '2026-10-02T12:34:57.000000001+09:00',
    sourceIdentifier: 'com.example.device',
    sourceName: 'Blood pressure monitor',
    components,
  };
}

function byComponent(
  observations: ReturnType<typeof mapBloodPressureCorrelation>['observations'],
  componentName: 'systolic' | 'diastolic',
) {
  return observations.find(
    observation => observation.concept === 'blood pressure ' + componentName,
  );
}

describe('mapBloodPressureCorrelation', () => {
  it('pairs shared HealthKit components and preserves timestamps, source, and unavailable original units', () => {
    const mapped = mapBloodPressureCorrelation(
      correlation([
        component('diastolic-sample', typeIds.diastolic, 8, 'kPa'),
        component('systolic-sample', typeIds.systolic, 120.5, 'mmHg'),
      ]),
      '2026-10-05T10:00:00.000Z',
    );
    const systolic = byComponent(mapped.observations, 'systolic');
    const diastolic = byComponent(mapped.observations, 'diastolic');

    expect(mapped.correlationId).toBe('healthkit-correlation-1');
    expect(systolic).toMatchObject({
      id: bloodPressureObservationId('healthkit-correlation-1', 'systolic'),
      effectiveAt: timestamp,
      endedAt: '2026-10-02T12:34:57.000000001+09:00',
      ingestedAt: '2026-10-05T10:00:00.000Z',
      provenance: {
        origin: 'imported',
        sourceRecordIds: ['healthkit-correlation-1', 'systolic-sample'],
        source: {
          system: 'healthkit',
          sourceIdentifier: 'com.example.device',
          sourceName: 'Blood pressure monitor',
          sourceVersion: '3.1',
          device: { manufacturer: 'Example', model: 'Monitor 1' },
        },
      },
      reviewState: { status: 'unreviewed' },
      observationKind: 'measurement',
      value: {
        kind: 'quantity',
        amount: 120.5,
        unit: 'mmHg',
        sourceRepresentation: originalDisplayUnitUnavailable,
      },
    });
    expect(diastolic?.value).toEqual({
      kind: 'quantity',
      amount: 8 * (760 / 101.325),
      unit: 'mmHg',
      sourceRepresentation: originalDisplayUnitUnavailable,
    });
    expect(systolic).not.toHaveProperty('recordedAt');
    expect(diastolic).not.toHaveProperty('recordedAt');
  });

  it('leaves an unobserved component absent instead of creating a normal value', () => {
    const mapped = mapBloodPressureCorrelation(
      correlation([
        component('systolic-sample', typeIds.systolic, 120, 'mmHg'),
      ]),
      '2026-10-05T10:00:00.000Z',
    );

    expect(mapped.observations).toHaveLength(1);
    expect(byComponent(mapped.observations, 'systolic')?.value).toMatchObject({
      amount: 120,
      unit: 'mmHg',
    });
    expect(byComponent(mapped.observations, 'diastolic')).toBeUndefined();
  });

  it('rejects duplicate components and unsupported units', () => {
    const systolic = component(
      'systolic-sample',
      typeIds.systolic,
      120,
      'mmHg',
    );

    expect(() =>
      mapBloodPressureCorrelation(correlation([systolic, systolic]), timestamp),
    ).toThrow('duplicate systolic');
    expect(() =>
      mapBloodPressureCorrelation(
        correlation([
          component('systolic-sample', typeIds.systolic, 120, 'cmH2O'),
        ]),
        timestamp,
      ),
    ).toThrow('unit is unsupported');
  });
});
