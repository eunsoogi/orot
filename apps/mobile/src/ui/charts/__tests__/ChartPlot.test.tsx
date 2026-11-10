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
  expect(screen.getByText('이완기 (점선)')).toBeTruthy();
  expect(screen.getByText('수축기 (실선)')).toBeTruthy();
  const series = screen.getByTestId('line-renderer', {
    includeHiddenElements: true,
  }).props.series;
  expect(series[0].strokeDasharray).toEqual([5, 3]);
  expect(series[1].strokeDasharray).toBeUndefined();
});

test('exposes one label per original series and its actual values while passing split segments to the renderer', async () => {
  await render(<ChartPlot {...props} kind="line" />);
  expect(screen.getAllByText('수축기 (실선)')).toHaveLength(1);
  expect(screen.getAllByText('이완기 (점선)')).toHaveLength(1);
  expect(screen.getByText(/: 0 mmHg/)).toBeTruthy();
  expect(screen.getByText(/측정되지 않음/)).toBeTruthy();
  expect(
    screen.getByTestId('line-renderer', { includeHiddenElements: true }).props
      .series,
  ).toHaveLength(3);
  expect(
    screen.getByTestId('line-renderer', { includeHiddenElements: true }).props
      .connectNulls,
  ).toBe(true);
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

test('uses the full value list instead of a clipped plot at large text sizes', async () => {
  Dimensions.set({
    window: { width: 390, height: 844, scale: 3, fontScale: 3 },
  });
  await render(<ChartPlot {...props} kind="line" />);
  expect(
    screen.getByText('큰 글자에서는 아래 목록으로 값을 확인하세요.'),
  ).toBeTruthy();
  expect(screen.getByText(/: 0 mmHg/)).toBeTruthy();
  expect(
    screen.queryByTestId('line-renderer', { includeHiddenElements: true }),
  ).toBeNull();
});

test('shows partial coverage, source and localized missing and partial values', async () => {
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
  await render(<ChartPlot {...props} data={partial} kind="bar" />);
  expect(screen.getByText('일부 기록만 표시하고 있어요.')).toBeTruthy();
  expect(screen.getByText(/요청 범위: 1월.*표시 범위: 1월 1일/)).toBeTruthy();
  expect(screen.getByText(/0 mmHg.*일부 기록.*합성 기기/)).toBeTruthy();
  expect(screen.getByText(/측정되지 않음.*합성 기기/)).toBeTruthy();
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
  await render(<ChartPlot {...props} data={dense} kind="bar" />);
  expect(screen.getByText('1 / 2쪽')).toBeTruthy();
  expect(screen.queryByText(/999,999걸음/)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: '다음 기록' }));
  expect(screen.getByText('2 / 2쪽')).toBeTruthy();
  expect(screen.getByText(/999,999걸음/)).toBeTruthy();
});
