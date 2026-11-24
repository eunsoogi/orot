import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { OverviewMetrics } from './OverviewMetrics';
import { groupOverviewCardSelection } from './OverviewHeartPanel';
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

const selected = [
  'sleep',
  'restingHeartRate',
  'steps',
  'heartRate',
  'workoutHeartRate',
  'walkingHeartRate',
] as const;
const state = () => ({
  selection: selected as readonly OverviewMetricChoice[],
  metrics: {
    sleep: createMetric('sleep'),
    steps: createMetric('steps'),
    heartRate: {
      ...createMetric('heartRate'),
      days: [
        {
          date: '2035-01-01',
          partial: false,
          value: 75,
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

test('locates one heart group at its earliest selected position without changing persisted choices', () => {
  expect(groupOverviewCardSelection(selected)).toEqual([
    { kind: 'metric', metric: 'sleep' },
    {
      kind: 'heart',
      choices: [
        'restingHeartRate',
        'heartRate',
        'workoutHeartRate',
        'walkingHeartRate',
      ],
    },
    { kind: 'metric', metric: 'steps' },
  ]);
  expect(groupOverviewCardSelection(['sleep', 'steps'])).toEqual([
    { kind: 'metric', metric: 'sleep' },
    { kind: 'metric', metric: 'steps' },
  ]);
});

test('shows independent native and derived rows in one card and reflows them with text scaling', async () => {
  const viewport = jest.spyOn(require('react-native'), 'useWindowDimensions');
  viewport.mockReturnValue({ width: 390, height: 800, scale: 3, fontScale: 1 });
  const data = state();
  mocked.mockReturnValue(data);
  workout.mockReturnValue({ status: 'loading' });
  const { rerender } = await render(<OverviewMetrics />);
  await resize(338);
  const panel = within(screen.getByTestId('overview-heart-panel'));
  expect(panel.getByRole('header', { name: '심박수' })).toBeVisible();
  expect(
    panel.getByTestId('overview-metric-summary-heartRate').props
      .accessibilityLabel,
  ).toContain('평균 심박수');
  expect(
    panel.getByTestId('overview-metric-chart-heartRate-plot').props
      .accessibilityLabel,
  ).toContain('최저');
  expect(
    panel.getByTestId('overview-metric-summary-restingHeartRate').props
      .accessibilityLabel,
  ).toContain('안정 시 심박수');
  expect(
    panel.getByTestId('overview-metric-summary-walkingHeartRate').props
      .accessibilityLabel,
  ).toContain('걷기');
  expect(panel.getAllByTestId('overview-metric-workoutHeartRate')).toHaveLength(
    1,
  );
  expect(
    StyleSheet.flatten(panel.getByTestId('overview-heart-subrows').props.style)
      .flexDirection,
  ).toBe('column');
  await resize(760);
  expect(
    StyleSheet.flatten(panel.getByTestId('overview-heart-subrows').props.style)
      .flexDirection,
  ).toBe('row');
  viewport.mockReturnValue({
    width: 390,
    height: 800,
    scale: 3,
    fontScale: 1.4,
  });
  await rerender(<OverviewMetrics />);
  expect(
    StyleSheet.flatten(panel.getByTestId('overview-heart-subrows').props.style)
      .flexDirection,
  ).toBe('column');
  expect(data.save).not.toHaveBeenCalled();
  viewport.mockRestore();
});

test('keeps unrelated cards and does not mount any excluded heart rows or native workout hook', async () => {
  workout.mockClear();
  mocked.mockReturnValue({
    ...state(),
    selection: ['sleep', 'restingHeartRate'],
  });
  await render(<OverviewMetrics />);
  expect(screen.getByTestId('overview-metric-sleep')).toBeVisible();
  const panel = within(screen.getByTestId('overview-heart-panel'));
  expect(panel.getByTestId('overview-metric-restingHeartRate')).toBeVisible();
  expect(panel.queryByTestId('overview-metric-heartRate')).toBeNull();
  expect(panel.queryByTestId('overview-metric-walkingHeartRate')).toBeNull();
  expect(panel.queryByTestId('overview-metric-workoutHeartRate')).toBeNull();
  expect(workout).not.toHaveBeenCalled();
});
