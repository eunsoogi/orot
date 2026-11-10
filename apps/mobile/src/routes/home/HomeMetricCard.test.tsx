import { act, render, screen } from '@testing-library/react-native';
import { ChartPlot } from '../../ui/charts';
import { HomeMetricCard } from './HomeMetricCard';
import { homeMetricChartData } from './homeMetricChart';
import type { HomeMetricProjection } from './metricProjection';
import type { HomeMetric } from './metricSelection';

jest.mock('../../ui/charts', () => ({
  ChartPlot: jest.fn(() => null),
}));

const chartPlot = jest.mocked(ChartPlot);

function projection(metric: HomeMetric, value: number): HomeMetricProjection {
  const unit = {
    sleep: 'min',
    heartRate: 'count/min',
    bodyMass: 'kg',
    steps: 'count',
  }[metric];
  return {
    metric,
    unit,
    source: 'Synthetic Watch App',
    measuredAt: '2026-10-14T10:00:00Z',
    latest: { date: '2026-10-14', value },
    timeZone: 'Asia/Seoul',
    days: [{ date: '2026-10-14', value, partial: false }],
    comparison: null,
  };
}

beforeEach(() => chartPlot.mockClear());

test.each([
  ['sleep', 'min', 70.4, 70],
  ['heartRate', 'count/min', 70.25, 70.3],
  ['bodyMass', 'kg', 70.25, 70.3],
  ['steps', 'count', 70.6, 71],
] as const)(
  'routes %s through the daily chart with Home display precision',
  async (
    metric: HomeMetric,
    unit: string,
    value: number,
    displayedValue: number,
  ) => {
    await render(
      <HomeMetricCard metric={projection(metric, value)} width={320} />,
    );

    expect(chartPlot).toHaveBeenCalledTimes(1);
    expect(chartPlot.mock.calls.at(-1)?.[0]).toMatchObject({
      data: {
        metric,
        coverage: {
          requested: '최근 7일',
          displayed: '기록 1일 / 전체 1일',
          status: 'ready',
        },
        series: [
          {
            id: metric,
            label: '일별 집계',
            unit,
            style: 'primary',
            points: [
              {
                x: '2026-10-14',
                value: displayedValue,
                source: '건강 기록',
              },
            ],
          },
        ],
      },
      height: 112,
      kind: 'bar',
      title: '최근 날짜별 기록',
    });
    expect(JSON.stringify(chartPlot.mock.calls.at(-1)?.[0].data)).not.toContain(
      'Synthetic Watch App',
    );
  },
);

test('keeps zero, missing days, constant values, outliers and partial today distinct', () => {
  const metric = {
    ...projection('steps', 999999),
    days: [
      { date: '2026-10-08', value: 0, partial: false },
      { date: '2026-10-09', value: null, partial: false },
      { date: '2026-10-10', value: 5, partial: false },
      { date: '2026-10-11', value: 5, partial: false },
      { date: '2026-10-12', value: 5, partial: false },
      { date: '2026-10-13', value: 5, partial: false },
      { date: '2026-10-14', value: 999999, partial: true },
    ],
  };

  const data = homeMetricChartData(metric);
  expect(data.coverage.status).toBe('partial');
  expect(data.coverage.displayed).toBe('기록 6일 / 전체 7일');
  expect(data.series[0]?.points.map(point => point.value)).toEqual([
    0,
    null,
    5,
    5,
    5,
    5,
    999999,
  ]);
  expect(data.series[0]?.points.at(-1)).toMatchObject({ partial: true });
  expect(metric.source).toBe('Synthetic Watch App');
  expect(data.series[0]?.points[0]?.source).toBe('건강 기록');
});

test('keeps the shared chart width tied to the measured Home card content', async () => {
  await render(<HomeMetricCard metric={projection('steps', 10)} width={320} />);
  const container = screen.getByTestId('home-metric-chart-container-steps');
  await act(async () => {
    container.props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 278, height: 112 } },
    });
  });

  expect(chartPlot.mock.calls.at(-1)?.[0].width).toBe(278);
});

test('marks an all-missing chart empty without turning its slots into zero', () => {
  const metric = {
    ...projection('heartRate', 75),
    days: Array.from({ length: 7 }, (_, index) => ({
      date: '2026-10-' + String(index + 8).padStart(2, '0'),
      value: null,
      partial: index === 6,
    })),
  };

  const data = homeMetricChartData(metric);
  expect(data.coverage.status).toBe('empty');
  expect(data.series[0]?.points.map(point => point.value)).toEqual(
    Array(7).fill(null),
  );
});

test.each(['loading', 'stale'] as const)(
  'keeps daily values available while the shared chart reports %s',
  status => {
    const metric = {
      ...projection('heartRate', 72),
      days: [
        { date: '2026-10-13', value: 70, partial: false },
        { date: '2026-10-14', value: 72, partial: false },
      ],
    };

    const data = homeMetricChartData(metric, status);

    expect(data.coverage.status).toBe(status);
    expect(data.series[0]?.points.map(point => point.value)).toEqual([70, 72]);
  },
);
