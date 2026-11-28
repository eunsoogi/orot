import { render, screen } from '@testing-library/react-native';
import { OverviewCompactChanges } from './OverviewCompactChanges';
import type { OverviewMetricProjection } from './metricProjection';

function metric(
  name: OverviewMetricProjection['metric'],
  unit: string,
  recent: number,
): OverviewMetricProjection {
  const dates = (first: number) =>
    Array.from(
      { length: 7 },
      (_, n) => `2026-11-${String(first + n).padStart(2, '0')}`,
    );
  return {
    metric: name,
    unit,
    measuredAt: null,
    source: 'Synthetic source',
    timeZone: 'Asia/Seoul',
    days: [],
    latest: { date: '2026-11-14', value: recent },
    comparison: {
      previous: 10,
      recent,
      previousCoverage: 6,
      recentCoverage: 7,
      previousDates: dates(1),
      recentDates: dates(8),
    },
  };
}

it('keeps the widget order, one comparison for heart, and no two-item cap', async () => {
  await render(
    <OverviewCompactChanges
      available
      selected={['sleep', 'heartRate', 'steps', 'workouts']}
      metrics={{
        sleep: metric('sleep', 'min', 34),
        heartRate: metric('heartRate', 'count/min', 20),
        restingHeartRate: metric('restingHeartRate', 'count/min', 7),
        walkingHeartRate: metric('walkingHeartRate', 'count/min', 21),
        steps: metric('steps', 'count', 28),
        workouts: { ...metric('workouts', 'min', 11), comparison: null },
        bodyMass: metric('bodyMass', 'kg', 9),
      }}
    />,
  );
  const rows = screen.getAllByTestId(
    /^overview-recent-change-(sleep|heartRate|steps|workouts|bodyMass)$/,
  );
  expect(rows.map(row => row.props.testID)).toEqual([
    'overview-recent-change-sleep',
    'overview-recent-change-heartRate',
    'overview-recent-change-steps',
  ]);
  expect(rows[0]).toHaveTextContent(/24분 늘었어요/u);
  expect(rows[1]).toHaveTextContent(/3 BPM 줄었어요/u);
  expect(rows[1].props.accessibilityLabel).toContain('기록된 날: 6일/7일');
  expect(rows[1].props.accessibilityLabel).not.toMatch(
    /Synthetic source|Asia\/Seoul/u,
  );
});

it('does not announce a change while unavailable or when the displayed delta rounds to zero', async () => {
  const metrics = { steps: metric('steps', 'count', 10.1) };
  const view = await render(
    <OverviewCompactChanges
      selected={['steps']}
      metrics={metrics}
      available={false}
    />,
  );
  expect(screen.queryByTestId('overview-recent-change-steps')).toBeNull();
  await view.rerender(
    <OverviewCompactChanges selected={['steps']} metrics={metrics} available />,
  );
  expect(screen.getByTestId('overview-recent-change-steps')).toHaveTextContent(
    /비슷해요/u,
  );
});
