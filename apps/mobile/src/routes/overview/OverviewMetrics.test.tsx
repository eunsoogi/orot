import { fireEvent, render, screen } from '@testing-library/react-native';
import { OverviewMetrics } from './OverviewMetrics';
import { useOverviewMetrics } from './useOverviewMetrics';
import type { OverviewMetricProjection } from './metricProjection';

jest.mock('./useOverviewMetrics');
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => false,
}));
jest.mock('react-native-chart-kit/v2', () => ({
  ChartKitProvider: ({ children }: { children: React.ReactNode }) => children,
  LineChart: () => null,
  BarChart: () => null,
}));
const mocked = jest.mocked(useOverviewMetrics);

test('formats recent comparison units without exposing projection provenance', async () => {
  const dates = (first: number) =>
    Array.from(
      { length: 7 },
      (_, offset) => `2026-10-${String(first + offset).padStart(2, '0')}`,
    );
  const projection: OverviewMetricProjection = {
    metric: 'steps',
    unit: 'count',
    source: 'Synthetic Watch App',
    measuredAt: '2026-10-14T10:00:00Z',
    timeZone: 'Asia/Seoul',
    latest: { date: '2026-10-14', value: 500 },
    days: [],
    comparison: {
      previous: 1000.4,
      recent: 1234.4,
      previousCoverage: 7,
      recentCoverage: 6,
      previousDates: dates(1),
      recentDates: dates(8),
    },
  };
  mocked.mockReturnValue({
    selection: ['steps', 'sleep'],
    metrics: { steps: projection },
    quantityTruncated: false,
    state: 'ready',
    retry: jest.fn(),
    save: jest.fn(),
  });

  await render(<OverviewMetrics />);

  const recentChange = screen.getByTestId('overview-recent-change-steps');
  expect(recentChange).toHaveTextContent('234걸음 늘었어요');
  expect(recentChange.props.accessibilityLabel).toContain('1,000걸음');
  expect(recentChange.props.accessibilityLabel).toContain('1,234걸음');
  expect(recentChange.props.accessibilityLabel).not.toContain(
    'Synthetic Watch App',
  );
  expect(recentChange.props.accessibilityLabel).not.toContain('Asia/Seoul');
  expect(recentChange).not.toHaveTextContent(
    /Synthetic Watch App|Asia\/Seoul|count/u,
  );
  expect(projection).toMatchObject({
    unit: 'count',
    source: 'Synthetic Watch App',
    timeZone: 'Asia/Seoul',
    latest: { value: 500 },
    comparison: { previous: 1000.4, recent: 1234.4 },
  });
});

test('shows accessible gaps and delegates editing to a separate route', async () => {
  const open = jest.fn();
  mocked.mockReturnValue({
    selection: ['sleep', 'heartRate'],
    metrics: {
      heartRate: {
        metric: 'heartRate',
        unit: 'count/min',
        source: 'Watch',
        measuredAt: '2026-10-14T10:00:00Z',
        timeZone: 'UTC',
        latest: { date: '2026-10-14', value: 70 },
        days: [
          { date: '2026-10-14', value: 70, partial: false },
          { date: '2026-10-15', value: null, partial: true },
        ],
        comparison: null,
      },
    },
    state: 'ready',
    quantityTruncated: false,
    retry: jest.fn(),
    save: jest.fn(),
  });
  await render(<OverviewMetrics onEdit={open} />);
  expect(screen.queryByText('오늘 진행 중')).toBeNull();
  expect(
    screen.queryByTestId('overview-metric-chart-heartRate-selected-point'),
  ).toBeNull();
  expect(
    screen.queryByTestId('overview-metric-chart-heartRate-details'),
  ).toBeNull();
  expect(
    screen.queryByTestId('overview-metric-chart-heartRate-plot'),
  ).toBeNull();
  expect(screen.getByText('70 BPM')).toBeVisible();
  await fireEvent.press(screen.getByRole('button', { name: '편집' }));
  expect(open).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('checkbox')).toBeNull();
});
