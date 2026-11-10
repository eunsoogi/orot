import { render, screen } from '@testing-library/react-native';
import type { ChartData } from '../../ui/charts';
import { HealthRecordsLineChart } from '../HealthRecordsLineChart';
import { HealthRecordsCategoryCharts } from '../HealthRecordsCategoryCharts';
import { mapBloodPressureCorrelation } from '../bloodPressure/mapper';
import { correlation } from '../bloodPressure/testSupport';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';

jest.mock('../../ui/charts', () => {
  const { Text } = require('react-native');
  return {
    ChartPlot: ({ data }: { data: ChartData }) => (
      <Text testID="chart-data">{JSON.stringify(data)}</Text>
    ),
  };
});

test.each([
  ['heart_rate', 'heart_rate', 'heartRate'],
  ['steps', 'step_count', 'steps'],
  ['body_mass', 'body_mass', 'bodyMass'],
] as const)(
  'preserves a single measured %s observation',
  async (category, concept, metric) => {
    const record = healthObservation('one', concept, '2026-10-01T00:00:00Z');
    await render(
      <HealthRecordsLineChart category={category} observations={[record]} />,
    );
    const data = JSON.parse(
      screen.getByTestId('chart-data').props.children,
    ) as ChartData;
    expect(data.metric).toBe(metric);
    expect(data.series.flatMap(series => series.points)).toHaveLength(1);
    expect(data.series[0]?.points[0]?.x).toBe(record.effectiveAt);
  },
);

test('preserves distinct labeled pressure series with non-color line styles', async () => {
  const observations = mapBloodPressureCorrelation(
    correlation('pressure'),
    '2026-10-01T00:00:00Z',
  ).observations;
  const result = await render(
    <HealthRecordsLineChart
      category="blood_pressure"
      observations={observations}
    />,
  );
  const data = JSON.parse(
    screen.getByTestId('chart-data').props.children,
  ) as ChartData;
  expect(data.metric).toBe('bloodPressure');
  expect(
    data.series.map(series => [series.label, series.style, series.unit]),
  ).toEqual([
    ['수축기', 'primary', 'mmHg'],
    ['이완기', 'secondary', 'mmHg'],
  ]);
  expect(
    data.series.flatMap(series => series.points.map(point => point.value)),
  ).toEqual([120, 80]);
  await result.rerender(
    <HealthRecordsLineChart
      category="blood_pressure"
      observations={[...observations].reverse()}
    />,
  );
  const reversed = JSON.parse(
    screen.getByTestId('chart-data').props.children,
  ) as ChartData;
  expect(reversed.series.map(series => [series.label, series.id])).toEqual([
    ['이완기', 'diastolic'],
    ['수축기', 'systolic'],
  ]);
});

test('keeps unit groups separate and drops invalid values and dates', async () => {
  const original = healthObservation(
    'original',
    'body_mass',
    '2026-10-01T00:00:00Z',
  );
  if (original.value.kind !== 'quantity') throw new Error('Expected quantity');
  const value = original.value;
  await render(
    <HealthRecordsCategoryCharts
      category="body_mass"
      hasMore={false}
      loadState="ready"
      observations={[
        { ...original, id: 'kg', value: { ...value, unit: 'kg', amount: 70 } },
        { ...original, id: 'lb', value: { ...value, unit: 'lb', amount: 154 } },
        {
          ...original,
          id: 'invalid-value',
          value: { ...value, unit: 'kg', amount: NaN },
        },
        {
          ...original,
          id: 'invalid-date',
          effectiveAt: 'invalid',
          value: { ...value, unit: 'kg' },
        },
      ]}
    />,
  );
  const plots = screen
    .getAllByTestId('chart-data')
    .map(node => JSON.parse(node.props.children) as ChartData);
  expect(plots.map(plot => plot.series[0]?.unit)).toEqual(['kg', 'lb']);
  expect(
    plots.map(plot => plot.series[0]?.points.map(point => point.value)),
  ).toEqual([[70], [154]]);
});

test('retains duplicate instants and updates coverage and values on refresh', async () => {
  const record = healthObservation('one', 'heart_rate', '2026-10-01T00:00:00Z');
  if (record.value.kind !== 'quantity') throw new Error('Expected quantity');
  const next = {
    ...record,
    id: 'two',
    value: { ...record.value, amount: 180 },
  };
  const result = await render(
    <HealthRecordsLineChart
      category="heart_rate"
      observations={[record, next]}
      loadState="loading"
    />,
  );
  const read = () =>
    JSON.parse(screen.getByTestId('chart-data').props.children) as ChartData;
  expect(read().coverage.status).toBe('loading');
  expect(read().series[0]?.points).toHaveLength(2);
  await result.rerender(
    <HealthRecordsLineChart
      category="heart_rate"
      observations={[next]}
      loadState="failed"
    />,
  );
  expect(read().coverage.status).toBe('stale');
  expect(read().series[0]?.points.map(point => point.value)).toEqual([180]);
  await result.rerender(
    <HealthRecordsLineChart
      category="heart_rate"
      observations={[]}
      loadState="failed"
    />,
  );
  expect(read().coverage.status).toBe('error');
  expect(read().series).toEqual([]);
  await result.rerender(
    <HealthRecordsLineChart category="heart_rate" observations={[]} />,
  );
  expect(read().coverage.status).toBe('empty');
  expect(read().series).toEqual([]);
});

test('passes measured values, timestamps, provenance and partial coverage to the shared chart', async () => {
  const first = healthObservation(
    'first',
    'heart_rate',
    '2026-10-01T00:00:00Z',
  );
  const second = healthObservation(
    'second',
    'heart_rate',
    '2026-10-10T00:00:00Z',
  );
  if (first.value.kind !== 'quantity' || second.value.kind !== 'quantity')
    throw new Error('Expected quantities');
  await render(
    <HealthRecordsLineChart
      category="heart_rate"
      observations={[
        { ...second, value: { ...second.value, amount: 200 } },
        { ...first, value: { ...first.value, amount: 0 } },
      ]}
      hasMore
    />,
  );
  const data = JSON.parse(
    screen.getByTestId('chart-data').props.children,
  ) as ChartData;
  expect(data.coverage.status).toBe('partial');
  expect(data.series[0]?.points.map(point => [point.x, point.value])).toEqual([
    ['2026-10-01T00:00:00Z', 0],
    ['2026-10-10T00:00:00Z', 200],
  ]);
  expect(data.series[0]?.points.every(point => point.source.length > 0)).toBe(
    true,
  );
});
