import { render, screen } from '@testing-library/react-native';
import { ChartPlot } from '../ChartPlot';
import type { ChartData } from '../types';

// Observe the actual renderer callbacks without depending on native drawing.
jest.mock('react-native-chart-kit/v2', () => {
  const { View } = require('react-native');
  return {
    ChartKitProvider: ({ children }: { children: React.ReactNode }) => children,
    BarChart: (props: object) => <View {...props} testID="duration-renderer" />,
  };
});

test.each([true, false])(
  'shares duration labels with details visibility %s',
  async showDetails => {
    const data: ChartData = {
      metric: 'sleep',
      coverage: { requested: 'week', displayed: 'one day', status: 'ready' },
      series: [
        {
          id: 'sleep',
          label: '수면',
          unit: 'min',
          style: 'primary',
          points: [{ x: '2026-10-08', value: 119.5, source: 'synthetic' }],
        },
      ],
    };
    await render(
      <ChartPlot
        data={data}
        width={320}
        height={112}
        title="수면"
        kind="bar"
        testID="duration-chart"
        hideDetails={!showDetails}
      />,
    );
    const renderer = screen.getByTestId('duration-renderer', {
      includeHiddenElements: true,
    });
    expect(renderer.props.formatYLabel(119.5)).toBe('2시간 0분');
    const target = screen.getByTestId(
      showDetails ? 'duration-chart-selected-point' : 'duration-chart-plot',
    );
    expect(target.props.accessibilityLabel).toContain('2시간 0분');
    expect(target.props.accessibilityLabel).toContain('2026-10-08');
    expect(target.props.accessibilityLabel).toContain('synthetic');
    expect(data.series[0]?.points[0]?.value).toBe(119.5);
    expect(data.series[0]?.unit).toBe('min');
  },
);
