const kilopascalsToMillimetersOfMercury = 760 / 101.325;

/** Normalizes pressure without rounding; callers retain source uncertainty separately. */
export function normalizeBloodPressureValue(
  value: number,
  unit: string,
): { readonly value: number; readonly unit: 'mmHg' } {
  if (!Number.isFinite(value)) {
    throw new Error('A blood-pressure value must be finite.');
  }

  if (unit === 'mmHg') return { value, unit: 'mmHg' };
  if (unit === 'kPa') {
    // Keep conversion precision so persisted values are not rounded for display.
    return {
      value: value * kilopascalsToMillimetersOfMercury,
      unit: 'mmHg',
    };
  }

  throw new Error('A blood-pressure unit is unsupported.');
}
