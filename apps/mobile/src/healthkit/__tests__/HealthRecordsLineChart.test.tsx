import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { HealthRecordsLineChart } from '../HealthRecordsLineChart';
import { mapBloodPressureCorrelation } from '../bloodPressure/mapper';
import { correlation } from '../bloodPressure/testSupport';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';

type ChartNode = ReturnType<Awaited<ReturnType<typeof render>>['toJSON']>;
function renderedStyles(
  node: ChartNode | string,
): ReturnType<typeof StyleSheet.flatten>[] {
  if (!node || typeof node === 'string') return [];
  return [
    StyleSheet.flatten(node.props.style),
    ...(node.children ?? []).flatMap(renderedStyles),
  ];
}

test.each([
  ['blood_pressure', 'blood pressure systolic'],
  ['heart_rate', 'heart_rate'],
  ['steps', 'step_count'],
  ['body_mass', 'body_mass'],
] as const)(
  'shows one marker only for a single sample in %s',
  async (category, concept) => {
    const observations = Array.from({ length: 100 }, (_, index) =>
      healthObservation(
        `sample-${index}`,
        concept,
        new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
      ),
    );
    const markers = () =>
      renderedStyles(result.toJSON()).filter(style => {
        return (
          style?.borderRadius === 6 &&
          style?.width === 12 &&
          style?.height === 12
        );
      });
    const lines = () =>
      renderedStyles(result.toJSON()).filter(style => {
        return style?.height === 2 && style?.position === 'absolute';
      });
    const result = await render(
      <HealthRecordsLineChart
        category={category}
        observations={observations.slice(0, 1)}
      />,
    );
    expect(markers()).toHaveLength(1);
    expect(lines()).toHaveLength(0);
    await result.rerender(
      <HealthRecordsLineChart
        category={category}
        observations={observations.slice(0, 2)}
      />,
    );
    expect(markers()).toHaveLength(0);
    expect(lines()).toHaveLength(1);
    await result.rerender(
      <HealthRecordsLineChart
        category={category}
        observations={observations}
      />,
    );
    expect(markers()).toHaveLength(0);
    expect(lines()).toHaveLength(99);
  },
);

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
