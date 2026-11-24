import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ChartPlot } from '../ChartPlot';
import { lineSegments } from '../model';
import type { ChartData } from '../types';

jest.mock('react-native-chart-kit/v2', () => {
  const { View: NativeView } = require('react-native');
  return {
    ChartKitProvider: ({ children }: { children: React.ReactNode }) => children,
    LineChart: (props: object) => (
      <NativeView {...props} testID="line-renderer" />
    ),
    BarChart: (props: object) => (
      <NativeView {...props} testID="bar-renderer" />
    ),
  };
});

const data: ChartData = {
  metric: 'steps',
  coverage: { requested: 'week', displayed: 'two days', status: 'ready' },
  series: [
    {
      id: 'steps',
      style: 'primary',
      label: '일별 집계',
      unit: 'count',
      points: [
        { x: '2026-10-08', value: 1, source: '건강 기록' },
        { x: '2026-10-09', value: 2, source: '건강 기록' },
      ],
    },
  ],
};

afterEach(() => jest.restoreAllMocks());

test('passes compact daily ticks while keeping full dates in keys and values', async () => {
  jest
    .spyOn(require('react-native'), 'useWindowDimensions')
    .mockReturnValue({ width: 390, height: 800, scale: 3, fontScale: 1 });

  await render(
    <ChartPlot
      data={data}
      width={320}
      height={112}
      title="걸음"
      kind="bar"
      testID="daily-chart"
    />,
  );

  const chart = screen.getByTestId('bar-renderer', {
    includeHiddenElements: true,
  });
  const { data: rows, formatXLabel } = chart.props as {
    data: { x: string }[];
    formatXLabel: (value: string, index: number) => string;
  };
  expect(rows.map(row => row.x)).toEqual(['2026-10-08', '2026-10-09']);
  expect(rows.map((row, index) => formatXLabel(row.x, index))).toEqual([
    '10/08',
    '10/09',
  ]);
  const selected = screen.getByTestId('daily-chart-selected-point');
  expect(selected.props.accessibilityLabel).toContain('2026-10-09');
  expect(selected.props.accessibilityLabel).toContain('2걸음');
  expect(selected.props.accessibilityLabel).not.toContain('2026-10-08');
  await fireEvent.press(
    screen.getByTestId('daily-chart-selected-point-previous'),
  );
  const previous = screen.getByTestId('daily-chart-selected-point');
  expect(previous.props.accessibilityLabel).toContain('2026-10-08');
  expect(previous.props.accessibilityLabel).toContain('1걸음');
});

test('daily lines bridge gaps with only real endpoints and keep missing rows unselectable', async () => {
  const [first, last] = data.series[0]!.points;
  const partial: ChartData = {
    ...data,
    series: [
      {
        ...data.series[0]!,
        points: [
          first!,
          { x: '2026-10-09', value: null, source: '건강 기록' },
          { ...last!, x: '2026-10-10' },
        ],
      },
    ],
  };
  await render(
    <ChartPlot
      data={partial}
      width={320}
      height={176}
      title="걸음"
      kind="line"
      lineAxis="day"
      hideDetails
      barTooltip
      testID="daily-line"
    />,
  );
  const plot = screen.getByTestId('daily-line-plot');
  const chart = screen.getByTestId('line-renderer', {
    includeHiddenElements: true,
  });
  expect(chart.props.showHorizontalGridLines).toBe(true);
  expect(chart.props.showVerticalGridLines).toBe(false);
  expect(chart.props.series).toMatchObject([
    { yKey: 'segment_0' },
    { yKey: 'segment_1', strokeDasharray: [4, 4], dot: false },
    { yKey: 'segment_2' },
  ]);
  expect(chart.props.series[0]).not.toHaveProperty('strokeDasharray');
  expect(chart.props.series[2]).not.toHaveProperty('strokeDasharray');
  const rows = chart.props.data as { x: number }[];
  expect(rows).toEqual([
    { x: Date.parse('2026-10-08'), segment_0: 1, segment_1: 1 },
    { x: Date.parse('2026-10-09') },
    { x: Date.parse('2026-10-10'), segment_1: 2, segment_2: 2 },
  ]);
  expect(chart.props.formatXLabel(rows[1]!.x)).toBe('10/09');
  await fireEvent(plot, 'accessibilityAction', {
    nativeEvent: { actionName: 'increment' },
  });
  expect(plot.props.accessibilityLabel).toContain('1걸음');
  await fireEvent(plot, 'accessibilityAction', {
    nativeEvent: { actionName: 'increment' },
  });
  expect(plot.props.accessibilityLabel).toContain('2걸음');
  expect(plot.props.accessibilityLabel).not.toContain('2026-10-09');
  await act(() =>
    chart.props.interaction.onSelect({
      raw: rows[1],
      series: [],
      position: { x: 100, y: 30 },
    }),
  );
  expect(plot.props.accessibilityLabel).toContain('측정되지 않음');
  expect(plot.props.accessibilityValue).toBeUndefined();
  await act(() =>
    chart.props.interaction.onSelect({
      raw: rows[2],
      series: [
        { key: 'segment_1', value: 2 },
        { key: 'segment_2', value: 2 },
      ],
      position: { x: 210, y: 16 },
    }),
  );
  expect(plot.props.accessibilityLabel).toContain('2026-10-10');
  expect(plot.props.accessibilityLabel).toContain('2걸음');
});

test('daily sparse observations bridge implicit missing calendar days without creating rows', () => {
  const series = data.series[0]!;
  const points = [series.points[0]!, { ...series.points[1]!, x: '2026-10-12' }];
  const daily = lineSegments(
    { ...data, series: [{ ...series, points }] },
    'day',
  );
  expect(daily.rows).toHaveLength(2);
  expect(daily.segments.filter(item => item.bridge)).toEqual([
    { id: 'segment_1', seriesId: 'steps', bridge: true },
  ]);
  const instants = lineSegments(
    { ...data, series: [{ ...series, points }] },
    'time',
  );
  expect(instants.segments).toHaveLength(1);
  expect(instants.segments[0]?.bridge).toBeUndefined();
});
