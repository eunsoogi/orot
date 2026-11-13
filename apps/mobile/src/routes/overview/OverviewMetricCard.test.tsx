import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ChartPlot } from '../../ui/charts';
import {
  OverviewMetricCard,
  OverviewMetricChartPlaceholder,
  overviewMetricTitle,
} from './OverviewMetricCard';
import { overviewMetricChartData } from './overviewMetricChart';
import type { OverviewMetricProjection } from './metricProjection';
import type { OverviewMetric } from './metricSelection';

jest.mock('../../ui/charts', () => ({
  ChartPlot: jest.fn(() => null),
}));

const chartPlot = jest.mocked(ChartPlot);

function projection(
  metric: OverviewMetric,
  value: number,
): OverviewMetricProjection {
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
    metric: OverviewMetric,
    unit: string,
    value: number,
    displayedValue: number,
  ) => {
    await render(
      <OverviewMetricCard metric={projection(metric, value)} width={320} />,
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

  const data = overviewMetricChartData(metric);
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
  await render(
    <OverviewMetricCard metric={projection('steps', 10)} width={320} />,
  );
  const container = screen.getByTestId('overview-metric-chart-container-steps');
  await act(async () => {
    container.props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 278, height: 112 } },
    });
  });

  expect(chartPlot.mock.calls.at(-1)?.[0].width).toBe(278);
});

test('keeps the metric summary and its chart as separate accessibility targets', async () => {
  await render(
    <OverviewMetricCard metric={projection('steps', 10)} width={320} />,
  );

  const card = screen.getByTestId('overview-metric-steps');
  const summary = screen.getByTestId('overview-metric-summary-steps');
  const chart = screen.getByTestId('overview-metric-chart-container-steps');

  expect(card.props.accessible).not.toBe(true);
  expect(card.props.accessibilityLabel).toBeUndefined();
  expect(summary.props.accessible).toBe(true);
  expect(summary.props.accessibilityLabel).toContain(
    overviewMetricTitle('steps'),
  );
  expect(summary.props.accessibilityLabel).toContain('2026-10-14');
  expect(summary.props.accessibilityLabel).toContain('10걸음');
  expect(card.children).toContain(summary);
  expect(card.children).toContain(chart);
  expect(StyleSheet.flatten(card.props.style).gap).toBe(6);
  expect(StyleSheet.flatten(summary.props.style).gap).toBe(6);
});

test('keeps placeholder chart status and guidance outside its title summary', async () => {
  await render(
    <OverviewMetricChartPlaceholder
      metric="steps"
      width={320}
      status="empty"
      emptyMessage="No records are available."
    />,
  );

  const card = screen.getByTestId('overview-metric-steps');
  const summary = screen.getByTestId('overview-metric-summary-steps');
  const chart = screen.getByTestId('overview-metric-chart-container-steps');

  expect(card.props.accessible).not.toBe(true);
  expect(summary.props.accessible).toBe(true);
  expect(summary.props.accessibilityLabel).toBe(overviewMetricTitle('steps'));
  expect(card.children).toContain(summary);
  expect(card.children).toContain(chart);
  expect(card.children).toContain(
    screen.getByText('No records are available.'),
  );
  expect(chartPlot.mock.calls.at(-1)?.[0].data.coverage.status).toBe('empty');
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

  const data = overviewMetricChartData(metric);
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

    const data = overviewMetricChartData(metric, status);

    expect(data.coverage.status).toBe(status);
    expect(data.series[0]?.points.map(point => point.value)).toEqual([70, 72]);
  },
);
