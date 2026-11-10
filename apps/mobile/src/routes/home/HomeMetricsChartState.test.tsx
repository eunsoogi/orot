import { fireEvent, render, screen } from '@testing-library/react-native';
import { ChartPlot } from '../../ui/charts';
import { HomeMetrics } from './HomeMetrics';
import type { HomeMetricProjection } from './metricProjection';
import { useHomeMetrics } from './useHomeMetrics';

jest.mock('./useHomeMetrics');
jest.mock('../../ui/charts', () => ({ ChartPlot: jest.fn(() => null) }));
const mocked = jest.mocked(useHomeMetrics);
const chartPlot = jest.mocked(ChartPlot);

test.each([
  ['loading', 'loading'],
  ['failed', 'error'],
] as const)(
  'reserves shared chart space and reports the initial %s state',
  async (state, chartState) => {
    const retry = jest.fn();
    mocked.mockReturnValue({
      selection: ['sleep', 'heartRate'],
      metrics: {},
      quantityTruncated: false,
      state,
      retry,
      save: jest.fn(),
    });
    chartPlot.mockClear();

    await render(<HomeMetrics />);

    expect(screen.getByTestId('home-metric-grid')).toBeTruthy();
    expect(chartPlot).toHaveBeenCalledTimes(2);
    expect(
      chartPlot.mock.calls.map(([props]) => ({
        metric: props.data.metric,
        status: props.data.coverage.status,
        height: props.height,
      })),
    ).toEqual([
      { metric: 'sleep', status: chartState, height: 112 },
      { metric: 'heartRate', status: chartState, height: 112 },
    ]);

    if (state === 'failed') {
      expect(screen.getByRole('alert')).toHaveTextContent(
        '건강 기록을 불러오지 못했어요.',
      );
      await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
      expect(retry).toHaveBeenCalledTimes(1);
    }
  },
);

test.each([
  ['refreshing', 'loading'],
  ['stale', 'stale'],
] as const)(
  'retains metric values and the chart marks them %s',
  async (state, chartState) => {
    const metric: HomeMetricProjection = {
      metric: 'steps',
      unit: 'count',
      source: 'Synthetic Watch App',
      measuredAt: '2026-10-14T10:00:00Z',
      timeZone: 'Asia/Seoul',
      latest: { date: '2026-10-14', value: 500 },
      days: [
        { date: '2026-10-13', value: 450, partial: false },
        { date: '2026-10-14', value: 500, partial: false },
      ],
      comparison: null,
    };
    const retry = jest.fn();
    mocked.mockReturnValue({
      selection: ['steps', 'sleep'],
      metrics: { steps: metric },
      quantityTruncated: false,
      state,
      retry,
      save: jest.fn(),
    });
    chartPlot.mockClear();

    await render(<HomeMetrics />);

    expect(screen.getByText('500걸음')).toBeTruthy();
    const chartProps = chartPlot.mock.calls.find(
      ([props]) => props.data.metric === 'steps',
    )?.[0];
    expect(chartProps?.data.coverage.status).toBe(chartState);
    expect(
      chartProps?.data.series[0]?.points.map(point => point.value),
    ).toEqual([450, 500]);
    expect(
      screen.getByTestId('home-metric-steps').props.accessibilityLabel,
    ).toContain(state === 'stale' ? '이전에 불러온' : '불러오는 중');

    if (state === 'stale') {
      expect(screen.getByRole('alert')).toHaveTextContent(
        '기록을 새로 불러오지 못해 이전 데이터를 표시하고 있어요.',
      );
      await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
      expect(retry).toHaveBeenCalledTimes(1);
    }
  },
);

test('renders the shared empty state while preserving the Home no-history explanation', async () => {
  mocked.mockReturnValue({
    selection: ['sleep', 'heartRate'],
    metrics: {},
    quantityTruncated: false,
    state: 'ready',
    retry: jest.fn(),
    save: jest.fn(),
  });
  chartPlot.mockClear();

  await render(<HomeMetrics />);

  expect(screen.getAllByText('최근 14일과 오늘에 기록이 없어요.')).toHaveLength(
    2,
  );
  expect(
    chartPlot.mock.calls.map(([props]) => props.data.coverage.status),
  ).toEqual(['empty', 'empty']);
});
