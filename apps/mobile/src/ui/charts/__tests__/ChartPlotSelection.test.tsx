import { fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { ChartPlot } from '../ChartPlot';
import type { ChartData } from '../types';

/** Covers selected values, adjustable navigation, mixed units and large text. */
jest.mock('react-native-chart-kit/v2', () => {
  const { View } = require('react-native');
  return {
    ChartKitProvider: ({ children }: { children: React.ReactNode }) => children,
    LineChart: (props: object) => <View {...props} testID="line-renderer" />,
    BarChart: (props: object) => <View {...props} testID="bar-renderer" />,
  };
});

const data: ChartData = {
  metric: 'bloodPressure',
  coverage: { requested: 'week', displayed: 'partial', status: 'partial' },
  series: [
    {
      id: 's',
      style: 'primary',
      label: '수축기',
      unit: 'mmHg',
      points: [
        { x: '2026-01-01T00:00:00Z', value: 120, source: 'synthetic' },
        { x: '2026-01-01T01:00:00Z', value: null, source: 'synthetic' },
        { x: '2026-01-01T04:00:00Z', value: 0, source: 'synthetic' },
      ],
    },
    {
      id: 'd',
      style: 'secondary',
      label: '이완기',
      unit: 'mmHg',
      points: [{ x: '2026-01-01T02:00:00Z', value: 80, source: 'synthetic' }],
    },
  ],
};

const props = { data, width: 320, height: 200, title: '혈압' } as const;

beforeEach(() => {
  Dimensions.set({
    window: { width: 390, height: 844, scale: 3, fontScale: 1 },
  });
});

test('keeps the legend and one selected measurement while preserving split lines', async () => {
  await render(<ChartPlot {...props} kind="line" testID="pressure-chart" />);
  expect(screen.getByText(/수축기 \(실선\)/)).toBeTruthy();
  expect(screen.getByText(/이완기 \(점선\)/)).toBeTruthy();
  const selection = screen.getByTestId('pressure-chart-selected-point');
  expect(selection.props.accessibilityRole).toBe('adjustable');
  expect(selection.props.accessibilityLabel).toContain('0 mmHg');
  expect(selection.props.accessibilityLabel).toContain('출처: synthetic');
  expect(selection.props.accessibilityLabel).not.toContain('120 mmHg');
  expect(selection.props.accessibilityLabel).not.toContain('80 mmHg');
  expect(selection.props.accessibilityLabel).not.toContain('측정되지 않음');
  expect(
    screen.getByTestId('line-renderer', { includeHiddenElements: true }).props
      .series,
  ).toHaveLength(3);
  expect(
    screen.getByTestId('line-renderer', { includeHiddenElements: true }).props
      .connectNulls,
  ).toBe(true);
});

test('moves selected details with buttons and adjustable accessibility actions', async () => {
  await render(<ChartPlot {...props} kind="line" testID="pressure-chart" />);
  const previous = screen.getByTestId('pressure-chart-selected-point-previous');

  await fireEvent.press(previous);
  let selection = screen.getByTestId('pressure-chart-selected-point');
  expect(selection.props.accessibilityLabel).toContain('80 mmHg');
  expect(selection.props.accessibilityLabel).not.toContain('수축기: 0 mmHg');
  expect(selection.props.accessibilityValue.now).toBe(3);

  await fireEvent(selection, 'accessibilityAction', {
    nativeEvent: { actionName: 'decrement' },
  });
  selection = screen.getByTestId('pressure-chart-selected-point');
  expect(selection.props.accessibilityLabel).toContain('측정되지 않음');
  expect(selection.props.accessibilityActions).toEqual([
    { name: 'decrement', label: '이전 측정값' },
    { name: 'increment', label: '다음 측정값' },
  ]);
});

test('keeps the plot and selected details at large text sizes', async () => {
  Dimensions.set({
    window: { width: 390, height: 844, scale: 3, fontScale: 3 },
  });
  await render(<ChartPlot {...props} kind="line" testID="pressure-chart" />);
  const chart = screen.getByTestId('line-renderer', {
    includeHiddenElements: true,
  });
  expect(chart.props.height).toBe(600);
  expect(
    screen.queryByText('큰 글자에서는 아래 목록으로 값을 확인하세요.'),
  ).toBeNull();
  expect(
    screen.getByTestId('pressure-chart-selected-point').props
      .accessibilityLabel,
  ).toContain('0 mmHg');
});

test('renders unlike measurement units on independent plot scales', async () => {
  const mixedUnits = {
    ...data,
    series: [
      data.series[0]!,
      {
        ...data.series[1]!,
        unit: 'kPa',
        points: [
          ...data.series[1]!.points,
          { x: '2026-01-01T04:00:00Z', value: 85, source: 'synthetic' },
        ],
      },
    ],
  };
  await render(
    <ChartPlot
      {...props}
      data={mixedUnits}
      kind="line"
      testID="mixed-unit-chart"
    />,
  );

  const plots = screen.getAllByTestId('line-renderer', {
    includeHiddenElements: true,
  });
  expect(plots).toHaveLength(2);
  expect(plots.map(plot => plot.props.series[0].label)).toEqual([
    '수축기',
    '이완기',
  ]);
  expect(plots.map(plot => plot.props.data.length)).toEqual([3, 2]);
  const label = screen.getByTestId('mixed-unit-chart-selected-point').props
    .accessibilityLabel;
  expect(label).toContain('0 mmHg');
  expect(label).toContain('85 kPa');
});

test('keeps partial coverage, missing values and source in the selected details', async () => {
  const partial = {
    ...data,
    coverage: {
      requested: '1월',
      displayed: '1월 1일',
      status: 'partial' as const,
    },
    series: [
      {
        ...data.series[0]!,
        points: [
          { x: '2026-01-01', value: 0, source: '합성 기기', partial: true },
          { x: '2026-01-02', value: null, source: '합성 기기' },
        ],
      },
    ],
  };
  await render(
    <ChartPlot {...props} data={partial} kind="bar" testID="partial-chart" />,
  );
  expect(screen.getByText('일부 기록만 표시하고 있어요.')).toBeTruthy();
  expect(screen.getByText(/요청 범위: 1월.*표시 범위: 1월 1일/)).toBeTruthy();
  const selection = screen.getByTestId('partial-chart-selected-point');
  expect(selection.props.accessibilityLabel).toContain('2026-01-02');
  expect(selection.props.accessibilityLabel).toContain('측정되지 않음');
  expect(selection.props.accessibilityLabel).toContain('출처: 합성 기기');
  expect(selection.props.accessibilityLabel).not.toContain('0 mmHg');
  await fireEvent.press(
    screen.getByTestId('partial-chart-selected-point-previous'),
  );
  const previousSelection = screen.getByTestId('partial-chart-selected-point');
  expect(previousSelection.props.accessibilityLabel).toContain('0 mmHg');
  expect(previousSelection.props.accessibilityLabel).toContain('일부 기록');
  expect(previousSelection.props.accessibilityLabel).not.toContain(
    '측정되지 않음',
  );
});
