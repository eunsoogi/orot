import { sensorOverviewRow, sensorSummaryFacts } from '../summarySensorRows';

const summary = {
  version: 1,
  kind: 'sensor_period_summary',
  coverage: 'retrieved_subset',
  concept: 'heart_rate',
  unit: 'count/min',
  sampleCount: 3,
  period: {
    fromInclusive: '2026-10-01T10:00:00Z',
    toInclusive: '2026-10-01T12:00:00Z',
  },
  statistics: { minimum: 60, maximum: 90, mean: 75 },
  limitations: [],
};

test('renders sensor rows as subset statistics, not invented individual records', () => {
  const row = sensorOverviewRow(summary)!;
  expect(row.summaryText).toContain('표본 3개 평균 75');
  expect(row.summaryText).toContain('조회 부분집합');
  expect(row.time).toBeUndefined();
  expect(row.raw).toBe(summary);
  expect(row.raw).not.toHaveProperty('value');
  expect(sensorSummaryFacts([summary])).toEqual([
    {
      kind: 'health_context_quantity',
      concept: 'heart_rate',
      unit: 'count/min',
      sampleCount: 3,
      amounts: [60, 90, 75],
    },
  ]);
});

test('does not accept malformed aggregate statistics and preserves explicit conflict disclosure', () => {
  expect(
    sensorOverviewRow({
      ...summary,
      statistics: { minimum: 60, maximum: 90, mean: 120 },
    }),
  ).toBeUndefined();
  expect(sensorOverviewRow({ ...summary, sampleCount: 0 })).toBeUndefined();
  expect(
    sensorOverviewRow({
      ...summary,
      limitations: ['conflicting_values_at_same_instant'],
    })?.summaryText,
  ).toContain('서로 다른 측정값');
});
