import { formatChartPosition, formatChartValue } from '../format';

test('formats canonical health units consistently without rounding measurements', () => {
  expect(formatChartValue('steps', 1234, 'count')).toBe('1,234걸음');
  expect(formatChartValue('heartRate', 72.125, 'count/min')).toBe(
    '72.125회/분',
  );
  expect(formatChartValue('bloodPressure', 120, 'mmHg')).toBe('120 mmHg');
  expect(formatChartValue('bodyMass', 72.35, 'kg')).toBe('72.35 kg');
});

test('keeps calendar-day identity instead of converting it through UTC', () => {
  expect(formatChartPosition('2026-01-01', 'day')).toBe('2026-01-01');
});
