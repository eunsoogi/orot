import { mapBloodPressureCorrelation } from '../bloodPressure/mapper';
import { correlation } from '../bloodPressure/testSupport';
import {
  buildHealthChartSeries,
  healthChartSummary,
} from '../healthRecordsChartModel';

test('keeps separate pressure series and includes only exact saved quantities', () => {
  const observations = mapBloodPressureCorrelation(
    correlation('chart-pressure'),
    '2026-10-05T10:00:00.000Z',
  ).observations;
  const systolic = observations.find(item => item.concept.endsWith('systolic'));
  const diastolic = observations.find(item =>
    item.concept.endsWith('diastolic'),
  );
  if (!systolic || systolic.value.kind !== 'quantity' || !diastolic) {
    throw new Error('Expected both pressure samples.');
  }
  const sixActualValues = Array.from({ length: 6 }, (_, index) => ({
    ...systolic,
    id: 'systolic-' + index,
    effectiveAt: new Date(Date.UTC(2026, 9, index + 1)).toISOString(),
    value: { ...systolic.value, amount: 120 + index },
  }));
  const textOnly = {
    ...systolic,
    id: 'text-only',
    value: { kind: 'text' as const, text: 'asleepCore' },
  };

  const series = buildHealthChartSeries('blood_pressure', [
    ...sixActualValues,
    diastolic,
    textOnly,
  ]);
  const systolicSeries = series.find(item => item.key.endsWith('systolic'));
  const summary = healthChartSummary(series, '혈압');

  expect(systolicSeries?.points.map(point => point.amount)).toEqual([
    121, 122, 123, 124, 125,
  ]);
  expect(
    series.find(item => item.key.endsWith('diastolic'))?.points,
  ).toHaveLength(1);
  expect(summary).toContain('121 mmHg');
  expect(summary).toContain('125 mmHg');
  expect(summary).not.toContain('120 mmHg');
  expect(summary).not.toContain('asleepCore');
});
