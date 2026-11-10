import { render, screen } from '@testing-library/react-native';
import { ChartPlot } from '../ChartPlot';
import type { ChartData } from '../types';

jest.mock('react-native-chart-kit/v2', () => {
  const { View: NativeView } = require('react-native');
  return {
    ChartKitProvider: ({ children }: { children: React.ReactNode }) => children,
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
    <ChartPlot data={data} width={320} height={112} title="걸음" kind="bar" />,
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
  expect(screen.getByText(/2026-10-08:.*1걸음/u)).toBeTruthy();
});
