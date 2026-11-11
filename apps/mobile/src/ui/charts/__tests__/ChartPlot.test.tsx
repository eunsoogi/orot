import { fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { ChartPlot } from '../ChartPlot';
import type { ChartData } from '../types';
import * as chartApi from '../index';

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
const props = {
  data,
  width: 320,
  height: 200,
  title: '혈압',
} as const;

beforeEach(() => {
  Dimensions.set({
    window: { width: 390, height: 844, scale: 3, fontScale: 1 },
  });
});

test('does not expose the internal row projection as a data adapter', () => {
  expect(chartApi).not.toHaveProperty('chartRows');
});

test('keeps blood-pressure line styles when series order changes', async () => {
  await render(
    <ChartPlot
      {...props}
      data={{ ...data, series: [...data.series].reverse() }}
      kind="line"
    />,
  );
  expect(screen.getByText(/이완기 \(점선\)/)).toBeTruthy();
  expect(screen.getByText(/수축기 \(실선\)/)).toBeTruthy();
  const series = screen.getByTestId('line-renderer', {
    includeHiddenElements: true,
  }).props.series;
  expect(series[0].strokeDasharray).toEqual([5, 3]);
  expect(series[1].strokeDasharray).toBeUndefined();
});

test('shows compact endpoint labels and keeps a full date in selected details', async () => {
  await render(<ChartPlot {...props} kind="line" testID="pressure-chart" />);
  const chart = screen.getByTestId('line-renderer', {
    includeHiddenElements: true,
  });
  const labels = chart.props.data.map((row: { x: number }, index: number) =>
    chart.props.formatXLabel(row.x, index),
  );
  expect(labels[1]).toBe('');
  expect(labels[0].length).toBeLessThan(16);
  expect(labels[labels.length - 1].length).toBeLessThan(16);
  const selection = screen.getByTestId('pressure-chart-selected-point');
  expect(selection.props.accessibilityLabel).toContain('2026년');
  expect(selection.props.accessibilityLabel).toContain('출처: synthetic');
});

test('does not expose stale data after permission is revoked', async () => {
  await render(
    <ChartPlot
      {...props}
      data={{ ...data, coverage: { ...data.coverage, status: 'permission' } }}
      kind="line"
    />,
  );
  expect(screen.queryByText('수축기 (실선)')).toBeNull();
  expect(screen.queryByTestId('line-renderer')).toBeNull();
});

test.each([
  ['loading', '기록을 불러오는 중이에요.'],
  ['permission', '건강 기록 접근 권한이 필요해요.'],
  ['empty', '표시할 기록이 없어요.'],
  ['error', '기록을 불러오지 못했어요.'],
  ['stale', '이전에 불러온 기록을 표시하고 있어요.'],
] as const)('distinguishes %s state', async (status, label) => {
  await render(
    <ChartPlot
      {...props}
      data={{ ...data, coverage: { ...data.coverage, status } }}
      kind="line"
    />,
  );
  expect(screen.getByText(label)).toBeTruthy();
});

test('makes all dense observations reachable without dropping an outlier', async () => {
  const dense = {
    ...data,
    metric: 'steps' as const,
    series: [
      {
        id: 'steps',
        style: 'primary' as const,
        label: '걸음',
        unit: 'count',
        points: Array.from({ length: 101 }, (_, index) => ({
          x: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
          value: index === 100 ? 999999 : index,
          source: '합성',
        })),
      },
    ],
  };
  await render(
    <ChartPlot {...props} data={dense} kind="bar" testID="dense-chart" />,
  );
  expect(screen.getByText('1 / 2쪽')).toBeTruthy();
  expect(
    screen.getByTestId('dense-chart-selected-point').props.accessibilityLabel,
  ).not.toContain('999,999걸음');
  await fireEvent.press(screen.getByRole('button', { name: '다음 기록' }));
  expect(screen.getByText('2 / 2쪽')).toBeTruthy();
  expect(
    screen.getByTestId('dense-chart-selected-point').props.accessibilityLabel,
  ).toContain('999,999걸음');
});

test('clamps the page after deletion and removes deleted observations', async () => {
  const points = Array.from({ length: 101 }, (_, index) => ({
    x: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    value: index === 100 ? 999999 : index,
    source: '합성',
  }));
  const dense = {
    ...data,
    metric: 'steps' as const,
    series: [
      {
        id: 'steps',
        style: 'primary' as const,
        label: '걸음',
        unit: 'count',
        points,
      },
    ],
  };
  const view = await render(
    <ChartPlot {...props} data={dense} kind="bar" testID="dense-chart" />,
  );
  await fireEvent.press(screen.getByRole('button', { name: '다음 기록' }));
  expect(screen.getByText(/999,999걸음/)).toBeTruthy();
  await view.rerender(
    <ChartPlot
      {...props}
      data={{
        ...dense,
        series: [{ ...dense.series[0]!, points: points.slice(0, 1) }],
      }}
      kind="bar"
      testID="dense-chart"
    />,
  );
  expect(screen.queryByText(/999,999걸음/)).toBeNull();
  expect(screen.getByText(/0걸음/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '다음 기록' })).toBeNull();
});
