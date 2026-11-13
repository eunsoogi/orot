import { formatOverviewMetricValue } from './metricFormatting';

test.each([
  ['sleep', 70.4, 'min', '70분'],
  ['heartRate', 70.25, 'count/min', '70.3회/분'],
  ['bodyMass', 70.25, 'kg', '70.3 kg'],
  ['steps', 70.6, 'count', '71걸음'],
] as const)(
  'formats %s values with their established unit meaning',
  (metric, value, unit, expected) => {
    expect(formatOverviewMetricValue(metric, value, unit)).toBe(expected);
  },
);

test('keeps unsupported metric units unchanged', () => {
  expect(formatOverviewMetricValue('steps', 70.6, 'quantity')).toBe(
    '70.6 quantity',
  );
});

test('keeps inherited property names as unsupported metric units', () => {
  expect(formatOverviewMetricValue('steps', 70.6, 'constructor')).toBe(
    '70.6 constructor',
  );
});
