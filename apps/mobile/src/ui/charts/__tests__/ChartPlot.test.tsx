import { render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { ChartPlot } from '../ChartPlot';
import type { ChartData } from '../types';

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
  stateLabel: '일부 자료',
  largeTextLabel: '목록으로 확인',
  formatPosition: (value: string) => value,
  formatValue: (value: number, unit: string) => `${value} ${unit}`,
} as const;

beforeEach(() => {
  Dimensions.set({
    window: { width: 390, height: 844, scale: 3, fontScale: 1 },
  });
});

test('exposes one label per original series and its actual values while passing split segments to the renderer', async () => {
  await render(<ChartPlot {...props} kind="line" />);
  expect(screen.getAllByText('수축기')).toHaveLength(1);
  expect(screen.getAllByText('이완기')).toHaveLength(1);
  expect(screen.getByText('2026-01-01T04:00:00Z: 0 mmHg')).toBeTruthy();
  expect(screen.getByText(/—/)).toBeTruthy();
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
  expect(screen.queryByText('수축기')).toBeNull();
  expect(screen.queryByTestId('line-renderer')).toBeNull();
});

test('uses the full value list instead of a clipped plot at large text sizes', async () => {
  Dimensions.set({
    window: { width: 390, height: 844, scale: 3, fontScale: 3 },
  });
  await render(<ChartPlot {...props} kind="line" />);
  expect(screen.getByText('목록으로 확인')).toBeTruthy();
  expect(screen.getByText('2026-01-01T04:00:00Z: 0 mmHg')).toBeTruthy();
  expect(
    screen.queryByTestId('line-renderer', { includeHiddenElements: true }),
  ).toBeNull();
});
