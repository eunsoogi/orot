import { fireEvent, render, screen } from '@testing-library/react-native';
import { overviewMetricChartData } from '../../../routes/overview/overviewMetricChart';
import type { OverviewMetricProjection } from '../../../routes/overview/metricProjection';
import { ChartPlot } from '../ChartPlot';
import { groupedRangeTicks } from '../groupedRangeTicks';
import { HealthRecordsLineChart } from '../../../healthkit/HealthRecordsLineChart';
import {
  mapCommonObservationSample,
  toCommonObservationRecord,
} from '../../../healthkit/commonObservations/mapper';
import { healthKitSample } from '../../../healthkit/commonObservations/testSupport';
import { summarizeSparseHeartRates } from '../summarizeSparseHeartRates';
import type { ChartPoint, ChartSeries } from '../types';

function point(date: string, value: number, samples = 1): ChartPoint {
  return {
    x: date,
    value,
    source: 'synthetic sensor',
    range: { minimum: value, maximum: value, samples },
  };
}
function series(id: string, points: readonly ChartPoint[]): ChartSeries {
  return { id, points, label: id, unit: 'count/min', style: 'primary' };
}
const day = (i: number) => '2035-01-0' + i;
const first = [
  point(day(1), 60, 3),
  point(day(2), 90),
  { x: day(3), value: null, source: '' },
  { x: day(4), value: null, source: '' },
  point(day(5), 70),
  point(day(6), 74),
  { ...point(day(7), 82), partial: true },
];

test('partitions the exact seven days 2/2/3, weights by readings and leaves an empty range empty', () => {
  const input = Object.freeze([
    series('watch-A', first),
    series('watch-B', [point(day(2), 95)]),
  ]);
  const [a, b] = summarizeSparseHeartRates(input);
  expect(
    a?.points.map(({ x, period, value, range, partial }) => [
      x,
      period,
      value,
      range,
      partial,
    ]),
  ).toEqual([
    [
      day(2),
      { start: day(1), end: day(2) },
      67.5,
      { minimum: 60, maximum: 90, samples: 4 },
      undefined,
    ],
    [day(4), { start: day(3), end: day(4) }, null, undefined, undefined],
    [
      day(7),
      { start: day(5), end: day(7) },
      226 / 3,
      { minimum: 70, maximum: 82, samples: 3 },
      true,
    ],
  ]);
  expect(b?.points[0]).toMatchObject({
    value: 95,
    range: { minimum: 95, maximum: 95, samples: 1 },
  });
  expect(b?.points.filter(p => p.value !== null)).toHaveLength(1);
  expect(input[0]?.points).toBe(first);
});

test('keeps daily data when it has an observed span, or wider bins still have no span', () => {
  const dense = [
    series('a', [
      { ...point(day(1), 70), range: { minimum: 60, maximum: 80, samples: 2 } },
      point(day(2), 80),
    ]),
  ];
  const equal = [series('b', [point(day(1), 70), point(day(2), 70)])];
  expect(summarizeSparseHeartRates(dense)).toBe(dense);
  expect(summarizeSparseHeartRates(equal)).toBe(equal);
});

test.each(['restingHeartRate', 'walkingHeartRate'] as const)(
  '%s draws true ranges and speaks interval bounds and mean',
  async metric => {
    const projection: OverviewMetricProjection = {
      metric,
      unit: 'count/min',
      source: 'synthetic',
      measuredAt: null,
      timeZone: 'UTC',
      latest: { date: day(7), value: 82 },
      comparison: null,
      days: first.map(p => ({
        date: p.x,
        value: p.value,
        partial: p.partial === true,
        ...(p.range ? { range: p.range } : {}),
      })),
    };
    const data = overviewMetricChartData(projection);
    expect(data.series[0]?.points).toHaveLength(3);
    await render(
      <ChartPlot
        data={data}
        width={300}
        height={176}
        title="합성 심박수"
        testID="sparse"
        hideDetails
        barTooltip
        kind="range"
      />,
    );
    expect(screen.getByText(/2~3일 단위/)).toBeTruthy();
    const opts = { includeHiddenElements: true };
    expect(screen.getAllByTestId('chart-range-span', opts)).toHaveLength(2);
    expect(screen.getAllByTestId('chart-range-mean', opts)).toHaveLength(2);
    const ticks = screen.getAllByTestId('chart-grouped-range-tick', opts);
    expect(ticks[0]?.props.accessibilityLabel).toBe('01/01–01/02');
    for (const tick of ticks)
      expect(tick.props.accessibilityLabel).toMatch(/^01\/\d{2}–01\/\d{2}$/u);
    const plot = screen.getByTestId('sparse-plot');
    await fireEvent(plot, 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
    expect(plot.props.accessibilityLabel).toContain(day(1) + ' ~ ' + day(2));
    expect(plot.props.accessibilityLabel).toContain(
      '최저 60회/분, 최고 90회/분, 평균 68회/분',
    );
  },
);

test('Health Records uses true multi-day range while leaving another sensor independent', async () => {
  const sample = (
    id: string,
    index: number,
    bpm: number,
    sourceIdentifier: string,
  ) => {
    const at = new Date(2035, 0, index, 12).toISOString();
    const mapped = mapCommonObservationSample(
      'restingHeartRate',
      healthKitSample('restingHeartRate', {
        id,
        startDate: at,
        endDate: at,
        value: bpm,
        sourceIdentifier,
        sourceName: sourceIdentifier,
      }),
    );
    if (mapped.status !== 'mapped') throw new Error('Invalid synthetic sample');
    return toCommonObservationRecord(mapped.observation, at);
  };
  await render(
    <HealthRecordsLineChart
      category="resting_heart_rate"
      preview
      observations={[
        sample('watch1', 1, 60, 'watch'),
        sample('watch2', 2, 85, 'watch'),
        sample('phone1', 2, 100, 'phone'),
        sample('watch7', 7, 70, 'watch'),
      ]}
    />,
  );
  await fireEvent(
    screen.getByTestId('health-record-chart-plot-row'),
    'layout',
    {
      nativeEvent: { layout: { width: 320 } },
    },
  );
  const opts = { includeHiddenElements: true };
  expect(screen.getAllByTestId('chart-range-span', opts)).toHaveLength(1);
  expect(screen.getAllByTestId('chart-range-flat', opts)).toHaveLength(2);
  const plot = screen.getByTestId(
    'health-record-chart-values-resting_heart_rate-plot',
  );
  expect(plot.props.accessibilityLabel).toContain(
    '최저 60회/분, 최고 85회/분, 평균 73회/분',
  );
  expect(plot.props.accessibilityLabel).not.toContain('최고 100회/분');
});

test('thins complete interval labels when compact and keeps all full interval labels when wide', () => {
  const grouped = summarizeSparseHeartRates([series('watch', first)]);
  const ticks = (width: number) =>
    groupedRangeTicks(
      grouped,
      width,
      11,
      Date.parse(day(2)),
      Date.parse(day(7)),
    )?.map(value => value.label);
  expect(ticks(160)).toEqual(['01/01–01/02']);
  expect(ticks(400)).toEqual(['01/01–01/02', '01/03–01/04', '01/05–01/07']);
});
