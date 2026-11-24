import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { OverviewMetrics } from './OverviewMetrics';
import { useOverviewMetrics } from './useOverviewMetrics';
import { useOverviewWorkoutPeriodHeartRate } from './useOverviewWorkoutPeriodHeartRate';
import { createMetric } from './overviewMetricLayoutFixtures';
import type { OverviewMetricChoice } from './metricSelection';

jest.mock('./useOverviewMetrics');
jest.mock('./useOverviewWorkoutPeriodHeartRate');
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));

const selected = ['sleep', 'heartRate', 'steps'] as const;
const state = () => ({
  selection: selected as readonly OverviewMetricChoice[],
  metrics: {
    sleep: createMetric('sleep'),
    steps: createMetric('steps'),
    heartRate: {
      ...createMetric('heartRate'),
      days: [
        {
          date: '2026-10-14',
          partial: false,
          value: 70,
          range: { minimum: 60, maximum: 90, samples: 3 },
        },
      ],
    },
    restingHeartRate: createMetric('restingHeartRate'),
  },
  quantityTruncated: false,
  state: 'ready' as const,
  retry: jest.fn(),
  save: jest.fn(),
});
const mocked = jest.mocked(useOverviewMetrics);
const workout = jest.mocked(useOverviewWorkoutPeriodHeartRate);
const shell = () => screen.getByTestId('overview-metric-grid');
const resize = (width: number) =>
  fireEvent(shell(), 'layout', { nativeEvent: { layout: { width } } });

test('renders one chartless card with independently labeled real values at narrow and wide widths', async () => {
  mocked.mockReturnValue(state());
  workout.mockReturnValue({ status: 'loading' });
  await render(<OverviewMetrics />);
  for (const width of [338, 760]) {
    await resize(width);
    const panel = within(screen.getByTestId('overview-heart-panel'));
    expect(panel.getByRole('header', { name: '심박수' })).toBeVisible();
    expect(panel.getByText('평균 심박수')).toBeVisible();
    expect(panel.getByText('범위 60–90회/분')).toBeVisible();
    expect(panel.getByText('안정 시 심박수')).toBeVisible();
    expect(panel.getByText('걷기 평균 심박수')).toBeVisible();
    expect(panel.getByText('운동 심박수')).toBeVisible();
    expect(panel.queryAllByTestId(/^overview-metric-chart-/u)).toHaveLength(0);
  }
});

test('does not mount a heart card or workout read when heart is unselected', async () => {
  workout.mockClear();
  mocked.mockReturnValue({ ...state(), selection: ['sleep', 'steps'] });
  await render(<OverviewMetrics />);
  expect(screen.getByTestId('overview-metric-sleep')).toBeVisible();
  expect(screen.queryByTestId('overview-heart-panel')).toBeNull();
  expect(workout).not.toHaveBeenCalled();
});

test('provisional defaults never enable a native workout read before owned metrics load', async () => {
  workout.mockClear();
  workout.mockReturnValue({ status: 'unavailable' });
  mocked.mockReturnValue({ ...state(), state: 'loading' });
  const { rerender } = await render(<OverviewMetrics />);
  expect(workout).toHaveBeenCalledWith(false);
  expect(workout).not.toHaveBeenCalledWith(true);
  mocked.mockReturnValue(state());
  await rerender(<OverviewMetrics />);
  expect(workout).toHaveBeenCalledWith(true);
});
