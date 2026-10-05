import type { BloodPressureUnit } from './types';

const kilopascalsToMillimetersOfMercury = 760 / 101.325;

/** Converts only supported pressure units and retains the provider's input verbatim. */
export function normalizeBloodPressureValue(
  value: number,
  unit: string,
): {
  readonly value: number;
  readonly unit: 'mmHg';
  readonly originalValue: number;
  readonly originalUnit: BloodPressureUnit;
} {
  if (!Number.isFinite(value)) {
    throw new Error('A blood-pressure value must be finite.');
  }

  if (unit === 'mmHg') {
    return { value, unit: 'mmHg', originalValue: value, originalUnit: unit };
  }
  if (unit === 'kPa') {
    // Do not round the conversion; presentation can round without losing source precision.
    return {
      value: value * kilopascalsToMillimetersOfMercury,
      unit: 'mmHg',
      originalValue: value,
      originalUnit: unit,
    };
  }

  throw new Error('A blood-pressure unit is unsupported.');
}
