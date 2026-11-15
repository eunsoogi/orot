import { fireEvent, render, screen } from '@testing-library/react-native';
import { ChartPlot } from '../ChartPlot';
import type { ChartData } from '../types';

jest.mock('react-native-chart-kit/v2', () => {
  const { View } = require('react-native');
  return {
    ChartKitProvider: ({ children }: { children: React.ReactNode }) => children,
    BarChart: (props: object) => <View {...props} testID="bars" />,
  };
});
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
const plot = (value = data) => (
  <ChartPlot
    data={value}
    width={160}
    height={112}
    title="수면"
    kind="bar"
    compact
    hideDetails
    barTooltip
    testID="chart"
  />
);
const bars = () => screen.getByTestId('bars', { includeHiddenElements: true });
const tooltip = () => screen.queryByTestId('chart-plot-tooltip');

test('bar callback shows exact dated duration, deselects, and never restores details', async () => {
  const original = JSON.stringify(data);
  await render(plot());
  expect(tooltip()).toBeNull();
  expect(bars().props.interaction.mode).toBe('tap');
  // Invoke the chart-kit callback contract: it reports stable x and series identity.
  const { act } = require('@testing-library/react-native');
  await act(() =>
    bars().props.interaction.onSelect({ x: '2026-01-01', seriesKey: 'sleep' }),
  );
  expect(screen.getByText('2026-01-01 · 수면 · 1시간 30분')).toBeTruthy();
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
  const { act } = require('@testing-library/react-native');
  const renderers = screen.getAllByTestId('bars', {
    includeHiddenElements: true,
  });
  await act(() =>
    renderers[1]!.props.interaction.onSelect({
      x: '2026-01-01',
      seriesKey: 'lb',
    }),
  );
  expect(screen.getByText('2026-01-01 · 다른 단위 · 143.5 lb')).toBeTruthy();
  await act(() =>
    renderers[0]!.props.interaction.onSelect({
      x: '2026-01-01',
      seriesKey: 'kg',
    }),
  );
  expect(screen.getByText('2026-01-01 · 체중 · 65.125 kg')).toBeTruthy();
});

test('editing a selected value clears its old callout even when its date survives', async () => {
  const view = await render(plot());
  await fireEvent(screen.getByTestId('chart-plot'), 'accessibilityAction', {
    nativeEvent: { actionName: 'increment' },
  });
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
  expect(screen.getByText('2026-01-01 · 수면 · 2시간 0분')).toBeTruthy();
});
