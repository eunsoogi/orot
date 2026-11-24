import { formatOverviewMetricValue } from '../../../routes/overview/metricFormatting';
import {
  formatChartPosition,
  formatChartTick,
  formatChartPointValue,
  formatRangeAxisValue,
  formatChartValue,
} from '../format';

test('formats canonical health units consistently without rounding measurements', () => {
  expect(formatChartValue('steps', 1234, 'count')).toBe('1,234걸음');
  expect(formatChartValue('heartRate', 72.125, 'count/min')).toBe('72 BPM');
  expect(formatChartValue('bloodPressure', 120, 'mmHg')).toBe('120 mmHg');
  expect(formatChartValue('bodyMass', 72.35, 'kg')).toBe('72.35 kg');
});

test('keeps calendar-day identity instead of converting it through UTC', () => {
  expect(formatChartPosition('2026-01-01', 'day')).toBe('2026-01-01');
  expect(formatChartTick('2026-01-01', 'day')).toBe('01/01');
});

// Both consumers must agree at rounding boundaries without changing input units.
test.each([
  [0, '0분'],
  [0.4, '0분'],
  [0.5, '1분'],
  [59.4, '59분'],
  [59.5, '1시간 0분'],
  [60, '1시간 0분'],
  [90, '1시간 30분'],
  [119.5, '2시간 0분'],
  [480, '8시간 0분'],
  [1501, '25시간 1분'],
])('shares duration rounding for %s minutes', (value, expected) => {
  expect(formatChartValue('sleep', Number(value), 'min')).toBe(expected);
  expect(formatChartValue('workouts', Number(value), 'min')).toBe(expected);
  expect(formatOverviewMetricValue('workouts', Number(value), 'min')).toBe(
    expected,
  );
  expect(formatOverviewMetricValue('sleep', Number(value), 'min')).toBe(
    expected,
  );
});

test('does not reinterpret unsupported duration units or rate quantities', () => {
  expect(formatChartValue('sleep', 90, 'seconds')).toBe('90 seconds');
  expect(formatOverviewMetricValue('sleep', 90, 'seconds')).toBe('90 seconds');
  expect(formatChartValue('heartRate', 90, 'min')).toBe('90 min');
  expect(formatChartValue('heartRate', 90, 'count/min')).toBe('90 BPM');
});

test('uses truncated BPM on fractional ticks, visible tooltips and accessible selected values', () => {
  expect(formatRangeAxisValue(89.99, true)).toBe('89 BPM');
  expect(formatRangeAxisValue(89.96, false)).toBe('90');
  const point = {
    x: '2035-01-01',
    value: 76.99,
    range: { minimum: 64.99, maximum: 89.99, samples: 3 },
  };
  const label = '최저 64 BPM, 최고 89 BPM, 평균 76 BPM';
  expect(formatChartPointValue('heartRate', point, 'count/min')).toBe(label);
  expect(
    formatChartPointValue(
      'heartRate',
      point,
      'count/min',
      'whole-bpm-overview',
    ),
  ).toBe(label);
  expect(formatChartValue('steps', 95.99, 'count/min')).toBe('95.99 count/min');
});
