import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, Dimensions, View } from 'react-native';
import { formatOverviewMetricValue } from '../../../routes/overview/metricFormatting';
import { overviewMetricChartData } from '../../../routes/overview/overviewMetricChart';
import type { OverviewMetricProjection } from '../../../routes/overview/metricProjection';
import { ChartPlot } from '../ChartPlot';
import { ChartTooltipHost } from '../ChartTooltipHost';
import { formatChartValue, formatRangeAxisValue } from '../format';

test('uses integer BPM axis labels without changing other axis precision', () => {
  expect(formatRangeAxisValue(125.00000000000001, true)).toBe('125');
  expect(formatRangeAxisValue(60.2, true)).toBe('60');
  expect(formatRangeAxisValue(60.2, false)).toBe('60.2');
});

const metric: OverviewMetricProjection = {
  metric: 'walkingHeartRate',
  unit: 'count/min',
  source: 'synthetic',
  measuredAt: '2035-01-04T09:00:00Z',
  timeZone: 'UTC',
  latest: { date: '2035-01-04', value: 125.00000000000001 },
  comparison: null,
  days: [
    {
      date: '2035-01-01',
      value: 66.51,
      partial: false,
      range: { minimum: 60.2, maximum: 90.3, samples: 3 },
    },
    { date: '2035-01-02', value: null, partial: false },
    {
      date: '2035-01-03',
      value: 104.5,
      partial: false,
      range: { minimum: 104.5, maximum: 104.5, samples: 2 },
    },
    {
      date: '2035-01-04',
      value: 125.00000000000001,
      partial: false,
      range: {
        minimum: 125.00000000000001,
        maximum: 125.00000000000001,
        samples: 1,
      },
    },
  ],
};

test.each(['heartRate', 'restingHeartRate', 'walkingHeartRate'] as const)(
  '%s keeps fractional data but presents whole BPM',
  kind => {
    const chart = overviewMetricChartData({ ...metric, metric: kind });
    expect(formatOverviewMetricValue(kind, 104.5, metric.unit)).toBe(
      '105회/분',
    );
    expect(chart.presentation).toBe('whole-bpm-overview');
    expect(chart.series[0]?.points.map(point => point.value)).toEqual([
      66.51,
      null,
      104.5,
      125.00000000000001,
    ]);
    expect(chart.series[0]?.points[0]?.range).toEqual({
      minimum: 60.2,
      maximum: 90.3,
      samples: 3,
    });
    expect(formatChartValue('bodyMass', 68.75, 'kg', chart.presentation)).toBe(
      '68.75 kg',
    );
    expect(formatChartValue('heartRate', 104.5, 'count/min')).toBe(
      '104.5회/분',
    );
  },
);

test('range-style single values use a centered flat mark; tooltip and accessibility use the same whole value', async () => {
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
      if (this.props.testID === 'health-host') callback(0, 0, 390, 1000);
      if (this.props.testID === 'walking-plot-anchor')
        callback(20, 220, 240, 112);
    });
  const previous = {
    window: Dimensions.get('window'),
    screen: Dimensions.get('screen'),
  };
  const size = { width: 390, height: 680, scale: 3, fontScale: 1 };
  await act(async () => Dimensions.set({ window: size, screen: size }));
  try {
    const view = await render(
      <ChartTooltipHost testID="health-host">
        <ChartPlot
          data={overviewMetricChartData(metric)}
          width={240}
          height={112}
          kind="range"
          title="걷기 평균 심박수"
          testID="walking"
          hideDetails
          barTooltip
        />
      </ChartTooltipHost>,
    );
    const renderer = { includeHiddenElements: true };
    const flat = screen.getAllByTestId('chart-range-flat', renderer);
    expect(flat).toHaveLength(2);
    for (const mark of flat) {
      expect(mark.props.y1).toBe(mark.props.y2);
      expect(mark.props.x2 - mark.props.x1).toBe(6);
    }
    expect(screen.getAllByTestId('chart-range-span', renderer)).toHaveLength(1);
    expect(screen.getAllByTestId('chart-range-mean', renderer)).toHaveLength(1);
    expect(screen.queryByTestId('chart-range-single', renderer)).toBeNull();
    const plot = screen.getByTestId('walking-plot');
    expect(plot.props.accessibilityLabel).toMatch(
      /최저 60회\/분, 최고 90회\/분, 평균 67회\/분/,
    );
    expect(plot.props.accessibilityLabel).toContain('측정되지 않음');
    const mark = screen.getAllByTestId('chart-range-bucket', renderer)[2]!;
    await fireEvent.press(mark);
    const tooltip = screen.getByTestId('walking-plot-tooltip', renderer);
    expect(tooltip).toHaveTextContent(/측정값 125회\/분/);
    expect(tooltip).not.toHaveTextContent('125.');
    expect(plot.props.accessibilityLabel).toContain('측정값 125회/분');
    await fireEvent.press(mark);
    expect(screen.queryByTestId('walking-plot-tooltip', renderer)).toBeNull();
    await view.unmount();
  } finally {
    measure.mockRestore();
    AppState.currentState = state;
    await act(async () => Dimensions.set(previous));
  }
});
