import { ChartTooltipHost } from '../ChartTooltipHost';
import { AppState, Dimensions, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ChartPlot } from '../ChartPlot';
import { chartRangeGeometry } from '../chartRangeGeometry';
import type { ChartData } from '../types';

const data: ChartData = {
  metric: 'heartRate',
  coverage: {
    requested: 'synthetic',
    displayed: 'synthetic',
    status: 'partial',
  },
  series: [
    {
      id: 'heartRate',
      label: '심박수',
      style: 'primary',
      unit: 'count/min',
      points: [
        {
          x: '2035-01-01',
          value: 70,
          source: 'synthetic',
          range: { minimum: 60, maximum: 100, samples: 3 },
        },
        { x: '2035-01-02', value: null, source: 'synthetic' },
        {
          x: '2035-01-03',
          value: 85,
          source: 'synthetic',
          range: { minimum: 85, maximum: 85, samples: 1 },
        },
      ],
    },
  ],
};

test('keeps the middle bucket blank and maps the mean to its true position between sampled extrema', () => {
  const plot = chartRangeGeometry(data.series, 200, 110, 'day');
  expect(plot?.marks.map(mark => mark.sourceX)).toEqual([
    '2035-01-01',
    '2035-01-03',
  ]);
  const [span, single] = plot!.marks;
  expect((span!.low - span!.mean) / (span!.low - span!.high)).toBeCloseTo(0.25);
  expect(single!.x).toBeGreaterThan(span!.x);
  expect(single!.low).toBe(single!.high);
  expect(single!.mean).toBe(single!.high);
});

test('shows a span and independent mean marker while exposing accessible bounds, dates, and missing buckets', async () => {
  await render(
    <ChartPlot
      data={data}
      width={240}
      height={112}
      kind="range"
      title="심박수"
      testID="heart"
      hideDetails
      barTooltip
    />,
  );
  const renderer = { includeHiddenElements: true };
  expect(
    screen.getAllByTestId('chart-range-horizontal-guide', renderer),
  ).toHaveLength(2);
  expect(screen.getAllByTestId('chart-range-span', renderer)).toHaveLength(1);
  expect(screen.getAllByTestId('chart-range-mean', renderer)).toHaveLength(1);
  expect(screen.getAllByTestId('chart-range-single', renderer)).toHaveLength(1);
  const plot = screen.getByTestId('heart-plot');
  expect(plot.props.accessibilityLabel).toMatch(
    /2035-01-01.*최저 60회\/분, 최고 100회\/분, 평균 70회\/분/,
  );
  expect(plot.props.accessibilityLabel).toMatch(/2035-01-02.*측정되지 않음/);
  await fireEvent(plot, 'accessibilityAction', {
    nativeEvent: { actionName: 'increment' },
  });
  expect(plot.props.accessibilityLabel).toMatch(/2035-01-01.*평균 70회\/분/);
  await fireEvent(plot, 'accessibilityAction', {
    nativeEvent: { actionName: 'increment' },
  });
  expect(plot.props.accessibilityLabel).toMatch(/2035-01-02.*측정되지 않음/);
});

test('chooses a plotted range through the existing contextual callout', async () => {
  const state = AppState.currentState;
  AppState.currentState = 'active';
  const native = View as unknown as {
    prototype: {
      measureInWindow: (
        callback: (x: number, y: number, width: number, height: number) => void,
      ) => void;
    };
  };
  const measure = jest
    .spyOn(native.prototype, 'measureInWindow')
    .mockImplementation(function (
      this: { props: { testID?: string } },
      callback,
    ) {
      if (this.props.testID === 'heart-host') callback(0, 0, 390, 1000);
      if (this.props.testID === 'heart-plot-anchor')
        callback(20, 220, 240, 112);
    });
  const size = { width: 390, height: 680, scale: 3, fontScale: 1 };
  const previous = {
    window: Dimensions.get('window'),
    screen: Dimensions.get('screen'),
  };
  await act(async () => Dimensions.set({ window: size, screen: size }));
  const view = await render(
    <ChartTooltipHost testID="heart-host">
      <ChartPlot
        data={data}
        width={240}
        height={112}
        kind="range"
        title="심박수"
        testID="heart"
        hideDetails
        barTooltip
      />
    </ChartTooltipHost>,
  );
  const mark = screen.getAllByTestId('chart-range-bucket', {
    includeHiddenElements: true,
  })[0]!;
  await fireEvent.press(mark);
  expect(
    screen.getByTestId('heart-plot-tooltip', { includeHiddenElements: true }),
  ).toHaveTextContent(/평균 70회\/분/);
  await fireEvent.press(mark);
  expect(
    screen.queryByTestId('heart-plot-tooltip', { includeHiddenElements: true }),
  ).toBeNull();
  await view.unmount();
  measure.mockRestore();
  AppState.currentState = state;
  await act(async () => Dimensions.set(previous));
});
