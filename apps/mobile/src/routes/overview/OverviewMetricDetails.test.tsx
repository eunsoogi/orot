import { fireEvent, render, screen } from '@testing-library/react-native';
import { OverviewMetrics } from './OverviewMetrics';
import { useOverviewMetrics } from './useOverviewMetrics';
import type { OverviewMetric } from './metricSelection';
import type { OverviewMetricProjection } from './metricProjection';

jest.mock('./useOverviewMetrics');
jest.mock('react-native-chart-kit/v2', () => ({
  ChartKitProvider: ({ children }: { children: React.ReactNode }) => children,
  LineChart: () => null,
  BarChart: () => null,
}));
const mocked = jest.mocked(useOverviewMetrics);

test.each([
  ['sleep', '해당 날짜 기록 합계', 'min', 70.4, '70분', 'min'],
  [
    'heartRate',
    '해당 날짜 측정 평균',
    'count/min',
    70.25,
    '70.3회/분',
    'count/min',
  ],
  ['bodyMass', '해당 날짜 마지막 측정', 'kg', 70.25, '70.3 kg', null],
  ['steps', '해당 날짜 기록 합계', 'count', 70.6, '71걸음', 'count'],
] as const)(
  'formats the %s metric in Korean and keeps chart units separate from projection provenance',
  async (
    metric: OverviewMetric,
    statistic: string,
    unit: string,
    measuredValue: number,
    formattedValue: string,
    rawUnit: string | null,
  ) => {
    const projection: OverviewMetricProjection = {
      metric,
      unit,
      source: 'Synthetic Watch App',
      measuredAt: '2026-10-14T10:00:00Z',
      timeZone: 'Asia/Seoul',
      latest: { date: '2026-10-14', value: measuredValue },
      days: [{ date: '2026-10-14', value: measuredValue, partial: false }],
      comparison: null,
    };
    mocked.mockReturnValue({
      selection: [metric, metric === 'sleep' ? 'heartRate' : 'sleep'],
      metrics: { [metric]: projection },
      quantityTruncated: false,
      state: 'ready',
      retry: jest.fn(),
      save: jest.fn(),
    });

    await render(<OverviewMetrics />);

    const summary = screen.getByTestId(`overview-metric-summary-${metric}`);
    expect(summary.props.accessibilityLabel).toContain(statistic);
    expect(summary.props.accessibilityLabel).toContain(`${formattedValue}.`);
    if (rawUnit)
      expect(summary.props.accessibilityLabel).not.toContain(rawUnit);
    expect(summary.props.accessibilityLabel).not.toContain(
      'Synthetic Watch App',
    );
    expect(summary.props.accessibilityLabel).not.toContain('Asia/Seoul');
    expect(screen.getByText(formattedValue)).toBeTruthy();
    expect(screen.queryByText('최근 날짜별 기록')).toBeNull();
    expect(screen.queryByText(`일별 집계 · ${unit}`)).toBeNull();
    await fireEvent.press(
      screen.getByTestId(`overview-metric-chart-${metric}-details`),
    );
    expect(screen.getByText(`일별 집계 · ${unit}`)).toBeTruthy();
    expect(
      screen.getByTestId(`overview-metric-chart-${metric}-selected-point`).props
        .accessibilityLabel,
    ).toContain('출처: 건강 기록');
    expect(screen.queryByText(/Synthetic Watch App|Asia\/Seoul/u)).toBeNull();
    expect(projection).toMatchObject({
      unit,
      source: 'Synthetic Watch App',
      timeZone: 'Asia/Seoul',
      latest: { value: measuredValue },
    });
  },
);
