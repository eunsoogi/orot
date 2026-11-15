import { render, screen } from '@testing-library/react-native';
import { ChartPlot } from '../ChartPlot';
import type { ChartData } from '../types';

jest.mock('react-native-chart-kit/v2', () => {
  const { View } = require('react-native');
  return {
    ChartKitProvider: ({ children }: { children: React.ReactNode }) => children,
    BarChart: (props: object) => <View {...props} testID="native-bars" />,
  };
});
const data: ChartData = {
  metric: 'steps',
  coverage: { requested: 'week', displayed: 'partial', status: 'partial' },
  series: [
    {
      id: 'steps',
      label: '걸음',
      style: 'primary',
      unit: 'count',
      points: [
        { x: '2026-01-01', value: 0, source: 'synthetic' },
        { x: '2026-01-02', value: null, source: 'synthetic', partial: true },
      ],
    },
  ],
};

test('removes the details action without mutating chart data or suppressing accessible gaps', async () => {
  const original = JSON.stringify(data);
  const props = {
    data,
    width: 320,
    height: 112,
    title: '걸음',
    kind: 'bar' as const,
    testID: 'chart',
  };
  const view = await render(<ChartPlot {...props} compact hideDetails />);
  expect(screen.queryByTestId('chart-details')).toBeNull();
  expect(screen.queryByTestId('chart-selected-point')).toBeNull();
  const plot = screen.getByTestId('chart-plot');
  expect(plot.props.accessibilityLabel).toContain('0걸음');
  expect(plot.props.accessibilityLabel).toContain('측정되지 않음');
  expect(plot.props.accessibilityLabel).toContain('일부 기록');
  expect(
    screen.getByTestId('native-bars', { includeHiddenElements: true }),
  ).toBeTruthy();
  expect(JSON.stringify(data)).toBe(original);
  await view.rerender(<ChartPlot {...props} compact />);
  expect(screen.getByTestId('chart-details')).toBeTruthy();
  await view.rerender(<ChartPlot {...props} />);
  expect(screen.getByTestId('chart-selected-point')).toBeTruthy();
  await view.rerender(
    <ChartPlot
      {...props}
      compact
      hideDetails
      data={{ ...data, coverage: { ...data.coverage, status: 'permission' } }}
    />,
  );
  expect(
    screen.getByTestId('chart-plot').props.accessibilityLabel,
  ).not.toContain('synthetic');
  expect(
    screen.queryByTestId('native-bars', { includeHiddenElements: true }),
  ).toBeNull();
});

test('chart-only pressure keeps a concise non-color legend without detailed values', async () => {
  const pressure: ChartData = {
    metric: 'bloodPressure',
    coverage: { requested: 'month', displayed: 'today', status: 'partial' },
    series: [
      {
        id: 'systolic',
        label: '수축기',
        style: 'primary',
        unit: 'mmHg',
        points: [{ x: '2026-01-01', value: 120, source: 'synthetic' }],
      },
      {
        id: 'diastolic',
        label: '이완기',
        style: 'secondary',
        unit: 'mmHg',
        points: [{ x: '2026-01-01', value: 80, source: 'synthetic' }],
      },
    ],
  };
  await render(
    <ChartPlot
      data={pressure}
      width={0}
      height={112}
      title="혈압"
      kind="line"
      compact
      hideDetails
      testID="pressure"
    />,
  );
  expect(screen.getByText('수축기 (실선) · mmHg')).toBeTruthy();
  expect(screen.getByText('이완기 (점선) · mmHg')).toBeTruthy();
  expect(screen.queryByTestId('pressure-details')).toBeNull();
  expect(screen.queryByText(/요청 범위:/)).toBeNull();
  expect(
    screen.getByTestId('pressure-plot').props.accessibilityLabel,
  ).toContain('120 mmHg');
});
