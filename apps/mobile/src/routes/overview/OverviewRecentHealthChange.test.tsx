import { render, screen } from '@testing-library/react-native';
import type { OverviewMetricProjection } from './metricProjection';
import { OverviewRecentHealthChange } from './OverviewRecentHealthChange';
import type { OverviewMetric } from './metricSelection';

const comparisonMetric = (
  metric: OverviewMetric,
  previous: number,
  recent: number,
  previousCoverage: number,
  recentCoverage: number,
): OverviewMetricProjection => {
  const dates = (firstDay: number) =>
    Array.from(
      { length: 7 },
      (_, offset) => `2026-10-${String(firstDay + offset).padStart(2, '0')}`,
    );
  return {
    metric,
    unit: {
      sleep: 'min',
      heartRate: 'count/min',
      bodyMass: 'kg',
      steps: 'count',
      workouts: 'min',
    }[metric],
    source: 'Watch',
    measuredAt: null,
    latest: { date: '2026-10-14', value: recent },
    timeZone: 'Asia/Seoul',
    days: [],
    comparison: {
      previous,
      recent,
      previousCoverage,
      recentCoverage,
      previousDates: dates(1),
      recentDates: dates(8),
    },
  };
};

const formatValue = (amount: number, unit: string) => `${amount} ${unit}`;

test('keeps seven-day periods, values and unequal recorded-day counts distinct', async () => {
  const sleep = comparisonMetric('sleep', 420, 450, 3, 4);
  const heartRate = comparisonMetric('heartRate', 70, 72, 7, 7);

  await render(
    <>
      <OverviewRecentHealthChange
        metric={sleep}
        title="기록된 수면"
        formatValue={formatValue}
      />
      <OverviewRecentHealthChange
        metric={heartRate}
        title="심박수"
        formatValue={formatValue}
      />
    </>,
  );

  expect(screen.getAllByText('이전 7일')).toHaveLength(2);
  expect(screen.getAllByText('최근 7일')).toHaveLength(2);
  expect(screen.getByText('420 min')).toBeTruthy();
  expect(screen.getByText('450 min')).toBeTruthy();
  expect(screen.getByText('70 count/min')).toBeTruthy();
  expect(screen.getByText('72 count/min')).toBeTruthy();

  const sleepLabel = screen.getByTestId('overview-recent-change-sleep').props
    .accessibilityLabel;
  expect(sleepLabel).toMatch(
    /기록된 수면.*이전 7일.*2026-10-01–2026-10-07.*420 min.*기록된 날: 3일\/7일.*최근 7일.*2026-10-08–2026-10-14.*450 min.*기록된 날: 4일\/7일/u,
  );
  const heartRateLabel = screen.getByTestId('overview-recent-change-heartRate')
    .props.accessibilityLabel;
  expect(heartRateLabel.match(/기록된 날: 7일\/7일/gu)).toHaveLength(2);
  expect(sleepLabel).not.toContain('Watch');
  expect(sleepLabel).not.toContain('Asia/Seoul');
  expect(screen.queryByText(/Watch|Asia\/Seoul/u)).toBeNull();
});

test('includes the longest Korean metric title in its accessible label', async () => {
  const steps = comparisonMetric('steps', 1200, 1300, 5, 6);

  await render(
    <OverviewRecentHealthChange
      metric={steps}
      title="기록된 걸음 샘플 합계"
      formatValue={formatValue}
    />,
  );

  expect(
    screen.getByTestId('overview-recent-change-steps').props.accessibilityLabel,
  ).toContain('기록된 걸음 샘플 합계');
});

test('keeps an unavailable comparison absent instead of inventing zero values', async () => {
  const metric = {
    ...comparisonMetric('sleep', 420, 450, 3, 4),
    comparison: null,
  };

  await render(
    <OverviewRecentHealthChange
      metric={metric}
      title="기록된 수면"
      formatValue={formatValue}
    />,
  );

  expect(screen.queryByTestId('overview-recent-change-sleep')).toBeNull();
  expect(screen.queryByText(/420|450|0 min/u)).toBeNull();
});
