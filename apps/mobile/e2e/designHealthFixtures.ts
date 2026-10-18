import type { HealthObservation } from '@orot/domain';
import { mapBloodPressureCorrelation } from '../src/healthkit/bloodPressure/mapper';
import { bloodPressureSampleTypeIdentifiers } from '../src/healthkit/bloodPressure/types';

/** Synthetic values for comparing the real chart and detail screens with the accepted mockups. */
export function designHealthObservations(
  now = new Date(),
): HealthObservation[] {
  return [
    [118, 76],
    [122, 78],
    [121, 79],
  ].flatMap(([systolic, diastolic], index) => {
    const timestamp = new Date(
      now.getTime() - (2 - index) * 2 * 86400000,
    ).toISOString();
    const id = `design-pressure-${index}`;
    const common = {
      startDate: timestamp,
      endDate: timestamp,
      sourceIdentifier: 'synthetic-design-fixture',
      sourceName: '디자인 검증용 데이터',
    };
    return mapBloodPressureCorrelation(
      {
        ...common,
        id,
        typeIdentifier: bloodPressureSampleTypeIdentifiers.correlation,
        components: [
          {
            ...common,
            id: `${id}-systolic`,
            typeIdentifier: bloodPressureSampleTypeIdentifiers.systolic,
            value: systolic,
            unit: 'mmHg',
          },
          {
            ...common,
            id: `${id}-diastolic`,
            typeIdentifier: bloodPressureSampleTypeIdentifiers.diastolic,
            value: diastolic,
            unit: 'mmHg',
          },
        ],
      },
      now.toISOString(),
    ).observations;
  });
}
