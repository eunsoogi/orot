import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ChartPlot } from '../ChartPlot';
import { ChartTooltipHost } from '../ChartTooltipHost';
import { installChartBarTooltipTestMeasurements } from '../testSupport/chartBarTooltipFixture';
import type { ChartData } from '../types';
jest.mock('react-native-chart-kit/v2', () => {
  const { View } = require('react-native');
  return {
    ChartKitProvider: ({ children }: { children: React.ReactNode }) => children,
    BarChart: (props: object) => <View {...props} testID="duration-bars" />,
  };
});
installChartBarTooltipTestMeasurements();
const source = 'synthetic';
const data: ChartData = {
  metric: 'workouts',
  coverage: { status: 'partial', requested: 'week', displayed: 'partial' },
  series: [
    {
      id: 'workout',
      label: '운동 기록',
      unit: 'min',
      style: 'primary',
      points: [
        { x: '2026-01-01', value: 35, source },
        { x: '2026-01-02', value: null, source },
        { x: '2026-01-03', value: 0, source },
      ],
    },
  ],
};
test('duration bars retain gaps but only measured marks are available to touch or VoiceOver', async () => {
  await render(
    <ChartTooltipHost testID="chart-host">
      <ChartPlot
        data={data}
        width={160}
        height={112}
        title="운동 기록"
        kind="bar"
        compact
        hideDetails
        barTooltip
        testID="chart"
      />
    </ChartTooltipHost>,
  );
  const bars = screen.getByTestId('duration-bars', {
    includeHiddenElements: true,
  });
  const accessible = () => screen.getByTestId('chart-plot');
  expect(accessible().props.accessibilityRole).toBe('adjustable');
  expect(accessible().props.accessibilityLabel).not.toContain('2026-01-02');
  expect(bars.props.data).toContainEqual({ x: '2026-01-02', workout: null });
  const pick = (x: string) =>
    act(() =>
      bars.props.interaction.onSelect({
        x,
        seriesKey: 'workout',
        position: { x: 80, y: 80 },
      }),
    );
  await pick('2026-01-02');
  expect(
    screen.queryByTestId('chart-plot-tooltip', { includeHiddenElements: true }),
  ).toBeNull();
  await pick('2026-01-01');
  expect(
    screen.getByText('2026-01-01 · 운동 기록 · 35분', {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
  await fireEvent(accessible(), 'accessibilityAction', {
    nativeEvent: { actionName: 'increment' },
  });
  expect(accessible().props.accessibilityLabel).toContain('2026-01-03');
  expect(accessible().props.accessibilityLabel).toContain('0분');
});
