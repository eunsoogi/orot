import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { installChartBarTooltipTestMeasurements } from '../testSupport/chartBarTooltipFixture';
import { ChartPlot } from '../ChartPlot';
import { ChartTooltipHost } from '../ChartTooltipHost';
import type { ChartData } from '../types';

jest.mock('react-native-chart-kit/v2', () => {
  const { View } = require('react-native');
  return {
    ChartKitProvider: ({ children }: { children: React.ReactNode }) => children,
    BarChart: (props: object) => <View {...props} testID="bars" />,
  };
});
const measurement = installChartBarTooltipTestMeasurements();
const data: ChartData = {
  metric: 'sleep',
  coverage: { requested: 'week', displayed: 'partial', status: 'partial' },
  series: [
    {
      id: 'sleep',
      label: '수면',
      style: 'primary',
      unit: 'min',
      points: [
        { x: '2026-01-01', value: 90, source: 'synthetic' },
        { x: '2026-01-02', value: null, source: 'synthetic', partial: true },
        { x: '2026-01-03', value: 0, source: 'synthetic' },
      ],
    },
  ],
};
const plot = (value = data, width = 160) => (
  <ChartTooltipHost testID="chart-host">
    <ChartPlot
      data={value}
      width={width}
      height={112}
      title="수면"
      kind="bar"
      compact
      hideDetails
      barTooltip
      testID="chart"
    />
  </ChartTooltipHost>
);
const bars = () => screen.getByTestId('bars', { includeHiddenElements: true });
const tooltip = () =>
  screen.queryByTestId('chart-plot-tooltip', { includeHiddenElements: true });

test('bar callback shows exact dated duration, deselects, and never restores details', async () => {
  const original = JSON.stringify(data);
  await render(plot());
  expect(tooltip()).toBeNull();
  expect(bars().props.interaction.mode).toBe('tap');
  // Invoke the chart-kit callback contract: it reports stable x and series identity.
  await act(() =>
    bars().props.interaction.onSelect({
      x: '2026-01-01',
      seriesKey: 'sleep',
      position: { x: 80, y: 90 },
    }),
  );
  expect(
    screen.getByText('2026-01-01 · 수면 · 1시간 30분', {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
  expect(screen.queryByTestId('chart-details')).toBeNull();
  await act(() =>
    bars().props.interaction.onDeselect({ reason: 'outsidePress' }),
  );
  expect(tooltip()).toBeNull();
  expect(JSON.stringify(data)).toBe(original);
});

test('VoiceOver selects missing and zero values and refreshed data invalidates selection', async () => {
  const view = await render(plot());
  const next = () =>
    fireEvent(screen.getByTestId('chart-plot'), 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
  await next();
  await next();
  expect(screen.getByTestId('chart-plot').props.accessibilityLabel).toContain(
    '측정되지 않음',
  );
  await next();
  expect(screen.getByTestId('chart-plot').props.accessibilityLabel).toContain(
    '0분',
  );
  await view.rerender(
    plot({ ...data, series: [{ ...data.series[0]!, points: [] }] }),
  );
  expect(tooltip()).toBeNull();
  await view.rerender(
    plot({ ...data, coverage: { ...data.coverage, status: 'permission' } }),
  );
  expect(tooltip()).toBeNull();
});

test('multi-series selection uses the selected series unit and preserves decimal precision', async () => {
  const multi: ChartData = {
    ...data,
    metric: 'bodyMass',
    series: [
      {
        ...data.series[0]!,
        id: 'kg',
        label: '체중',
        unit: 'kg',
        points: [{ x: '2026-01-01', value: 65.125, source: 'synthetic' }],
      },
      {
        ...data.series[0]!,
        id: 'lb',
        label: '다른 단위',
        unit: 'lb',
        points: [{ x: '2026-01-01', value: 143.5, source: 'synthetic' }],
      },
    ],
  };
  await render(plot(multi));
  const renderers = screen.getAllByTestId('bars', {
    includeHiddenElements: true,
  });
  await act(() =>
    renderers[1]!.props.interaction.onSelect({
      x: '2026-01-01',
      seriesKey: 'lb',
      position: { x: 80, y: 90 },
    }),
  );
  expect(
    screen.getByText('2026-01-01 · 다른 단위 · 143.5 lb', {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
  await act(() =>
    renderers[0]!.props.interaction.onSelect({
      x: '2026-01-01',
      seriesKey: 'kg',
      position: { x: 80, y: 90 },
    }),
  );
  expect(
    screen.getByText('2026-01-01 · 체중 · 65.125 kg', {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
});

test('editing a selected value clears its old callout even when its date survives', async () => {
  const view = await render(plot());
  await act(() =>
    bars().props.interaction.onSelect({
      x: '2026-01-01',
      seriesKey: 'sleep',
      position: { x: 80, y: 90 },
    }),
  );
  expect(tooltip()).toBeTruthy();
  await view.rerender(
    plot({
      ...data,
      series: [
        {
          ...data.series[0]!,
          points: [{ ...data.series[0]!.points[0]!, value: 120 }],
        },
      ],
    }),
  );
  expect(tooltip()).toBeNull();
  await fireEvent(screen.getByTestId('chart-plot'), 'accessibilityAction', {
    nativeEvent: { actionName: 'increment' },
  });
  expect(screen.getByTestId('chart-plot').props.accessibilityLabel).toContain(
    '2시간 0분',
  );
  expect(tooltip()).toBeNull();
});

test('floating label uses the route overlay outside the chart and avoids touch/accessibility interception', async () => {
  await render(plot());
  const select = (day: string, x: number) =>
    act(() =>
      bars().props.interaction.onSelect({
        x: day,
        seriesKey: 'sleep',
        position: { x, y: 90 },
      }),
    );
  await select('2026-01-01', 10);
  expect(
    within(screen.getByTestId('chart')).queryByTestId('chart-plot-tooltip', {
      includeHiddenElements: true,
    }),
  ).toBeNull();
  await fireEvent(tooltip()!, 'layout', {
    nativeEvent: { layout: { width: 240, height: 40 } },
  });
  expect(StyleSheet.flatten(tooltip()!.props.style)).toMatchObject({
    position: 'absolute',
    left: 8,
    top: 52,
    width: 240,
    opacity: 1,
  });
  expect(tooltip()!.props.pointerEvents).toBe('none');
  expect(tooltip()!.props.accessibilityElementsHidden).toBe(true);
  await fireEvent(screen.getByTestId('chart-host'), 'touchMove');
  expect(tooltip()).toBeNull();
  measurement.setPlotY(20);
  await select('2026-01-03', 155);
  await fireEvent(tooltip()!, 'layout', {
    nativeEvent: { layout: { width: 240, height: 40 } },
  });
  expect(StyleSheet.flatten(tooltip()!.props.style)).toMatchObject({
    top: 328,
    opacity: 1,
  });
});
test('resizing clears coordinates from the old chart layout', async () => {
  const view = await render(plot());
  await act(() =>
    bars().props.interaction.onSelect({
      x: '2026-01-01',
      seriesKey: 'sleep',
      position: { x: 80, y: 90 },
    }),
  );
  await view.rerender(plot(data, 320));
  expect(tooltip()).toBeNull();
});
