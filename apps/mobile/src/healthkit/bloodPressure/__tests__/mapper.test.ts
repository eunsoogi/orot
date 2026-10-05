import { mapBloodPressureCorrelation } from '../mapper';
import {
  bloodPressureSampleTypeIdentifiers as typeIds,
  type BloodPressureCorrelationSnapshot,
} from '../types';

const timestamp = '2026-10-02T12:34:56.123456789+09:00';

function correlation(
  components: BloodPressureCorrelationSnapshot['components'],
): BloodPressureCorrelationSnapshot {
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

describe('mapBloodPressureCorrelation', () => {
  it('pairs components by HealthKit type and preserves exact times, source, and original units', () => {
    const result = mapBloodPressureCorrelation(
      correlation([
        {
          id: 'diastolic-sample',
          typeIdentifier: typeIds.diastolic,
          startDate: timestamp,
          endDate: timestamp,
          sourceIdentifier: 'com.example.device',
          sourceName: 'Blood pressure monitor',
          originalValue: 8,
          originalUnit: 'kPa',
        },
        {
          id: 'systolic-sample',
          typeIdentifier: typeIds.systolic,
          startDate: timestamp,
          endDate: timestamp,
          sourceIdentifier: 'com.example.device',
          sourceName: 'Blood pressure monitor',
          originalValue: 120.5,
          originalUnit: 'mmHg',
        },
      ]),
    );

    expect(result).toMatchObject({
      id: 'healthkit-correlation-1',
      startDate: timestamp,
      sourceIdentifier: 'com.example.device',
      provenance: {
        origin: 'imported',
        sourceSystem: 'HealthKit',
        sourceSampleId: 'healthkit-correlation-1',
      },
      systolic: {
        sampleId: 'systolic-sample',
        startDate: timestamp,
        originalValue: 120.5,
        originalUnit: 'mmHg',
        normalizedValue: 120.5,
        normalizedUnit: 'mmHg',
      },
      diastolic: {
        sampleId: 'diastolic-sample',
        originalValue: 8,
        originalUnit: 'kPa',
        normalizedValue: 8 * (760 / 101.325),
        normalizedUnit: 'mmHg',
      },
    });
    expect(result.endDate).toBe('2026-10-02T12:34:57.000000001+09:00');
  });

  it('keeps an unobserved component missing instead of supplying a value', () => {
    const result = mapBloodPressureCorrelation(
      correlation([
        {
          id: 'systolic-sample',
          typeIdentifier: typeIds.systolic,
          startDate: timestamp,
          endDate: timestamp,
          sourceIdentifier: 'com.example.device',
          sourceName: 'Blood pressure monitor',
          originalValue: 120,
          originalUnit: 'mmHg',
        },
      ]),
    );

    expect(result.systolic?.normalizedValue).toBe(120);
    expect(result.diastolic).toBeNull();
  });

  it('rejects ambiguous duplicate components and unsupported original units', () => {
    const systolic = {
      id: 'systolic-sample',
      typeIdentifier: typeIds.systolic,
      startDate: timestamp,
      endDate: timestamp,
      sourceIdentifier: 'com.example.device',
      sourceName: 'Blood pressure monitor',
      originalValue: 120,
      originalUnit: 'mmHg',
    };

    expect(() =>
      mapBloodPressureCorrelation(correlation([systolic, systolic])),
    ).toThrow('duplicate systolic');
    expect(() =>
      mapBloodPressureCorrelation(
        correlation([{ ...systolic, originalUnit: 'cmH2O' }]),
      ),
    ).toThrow('unit is unsupported');
  });
});
