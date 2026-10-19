import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { HealthRecordsLineChart } from '../HealthRecordsLineChart';
import { mapBloodPressureCorrelation } from '../bloodPressure/mapper';
import { correlation } from '../bloodPressure/testSupport';

// Uneven measurement dates must not become evenly spaced chart labels.
test('anchors the middle date to its timestamp and hides overlapping ticks', async () => {
  const originalWindow = Dimensions.get('window');
  Dimensions.set({
    window: { width: 438, height: 900, scale: 3, fontScale: 1 },
  });
  // Labels use the device time zone; keep the fixture at local 09:00 on CI and developer machines.
  const measuredAt = (day: number) => new Date(2026, 9, day, 9).toISOString();
  const observations = [1, 4, 11].flatMap(day =>
    mapBloodPressureCorrelation(
      correlation('date-' + day),
      '2026-10-12T00:00:00Z',
    ).observations.map(observation => ({
      ...observation,
      effectiveAt: measuredAt(day),
    })),
  );
  await render(
    <HealthRecordsLineChart
      category="blood_pressure"
      observations={observations}
    />,
  );
  await fireEvent(
    screen.getByTestId('health-record-chart-plot-row'),
    'layout',
    {
      nativeEvent: { layout: { width: 438 } },
    },
  );
  expect(screen.getByTestId('health-chart-date-' + measuredAt(11))).toHaveStyle(
    { left: 400 },
  );
  expect(screen.getByText('10. 1.\n09:00')).toHaveStyle({ width: 68 });
  expect(screen.getByTestId('health-chart-date-' + measuredAt(4))).toHaveStyle({
    left: 120,
  });
  await fireEvent(
    screen.getByTestId('health-record-chart-plot-row'),
    'layout',
    {
      nativeEvent: { layout: { width: 138 } },
    },
  );
  expect(screen.queryByTestId('health-chart-date-' + measuredAt(4))).toBeNull();
  expect(
    screen.getByTestId('health-record-chart-blood_pressure').props
      .accessibilityLabel,
  ).toContain('120 mmHg');
  await act(() => Dimensions.set({ window: originalWindow }));
});
