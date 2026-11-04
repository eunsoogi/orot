import { formatHomeMetricValue } from './metricFormatting';

test('keeps inherited property names as unsupported metric units', () => {
  expect(formatHomeMetricValue('steps', 70.6, 'constructor')).toBe(
    '70.6 constructor',
  );
});
