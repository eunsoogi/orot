import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { HealthRecordsLineChart } from '../HealthRecordsLineChart';
import { mapBloodPressureCorrelation } from '../bloodPressure/mapper';
import { correlation } from '../bloodPressure/testSupport';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';

jest.mock('react-native-chart-kit/v2', () => {
  const { View } = require('react-native');
  return {
    ChartKitProvider: ({ children }: { children: React.ReactNode }) => children,
    LineChart: (props: object) => <View {...props} testID="line-renderer" />,
    BarChart: (props: object) => <View {...props} testID="bar-renderer" />,
  };
});

beforeEach(() => {
  Dimensions.set({
    window: { width: 390, height: 844, scale: 3, fontScale: 1 },
  });
});

test.each([
  ['blood_pressure', 'blood pressure systolic'],
  ['heart_rate', 'heart_rate'],
  ['steps', 'step_count'],
  ['body_mass', 'body_mass'],
] as const)(
  'passes all %s measurements to the library with visible dots',
  async (category, concept) => {
    const observations = Array.from({ length: 100 }, (_, index) =>
      healthObservation(
        `sample-${index}`,
        concept,
        new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
      ),
    );
    const result = await render(
      <HealthRecordsLineChart
        category={category}
        observations={observations.slice(0, 1)}
      />,
    );
    await fireEvent(
      screen.getByTestId('health-record-chart-plot-row'),
      'layout',
      { nativeEvent: { layout: { width: 320 } } },
    );
    const chart = () =>
      screen.getByTestId('line-renderer', { includeHiddenElements: true });
    expect(chart().props.showDots).toBe(true);
    expect(chart().props.data).toHaveLength(1);
    await result.rerender(
      <HealthRecordsLineChart
        category={category}
        observations={observations.slice(0, 2)}
      />,
    );
    expect(chart().props.data).toHaveLength(2);
    await result.rerender(
      <HealthRecordsLineChart
        category={category}
        observations={observations}
      />,
    );
    expect(chart().props.data).toHaveLength(100);
    expect(chart().props.decimation).toBe(false);
  },
);

test('passes irregular instants to the scale and exposes both pressure values', async () => {
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
    { nativeEvent: { layout: { width: 138 } } },
  );
  const chart = screen.getByTestId('line-renderer', {
    includeHiddenElements: true,
  });
  expect(chart.props.data.map((row: { x: number }) => row.x)).toEqual(
    [1, 4, 11].map(day => Date.parse(measuredAt(day))),
  );
  expect(chart.props.formatXLabel(Date.parse(measuredAt(4)), 1)).toBe('');
  expect(
    screen.getByTestId('health-record-chart-blood_pressure').props
      .accessibilityLabel,
  ).toContain('120 mmHg');
  expect(
    screen.getByTestId('health-record-chart-blood_pressure').props
      .accessibilityLabel,
  ).toContain('80 mmHg');
});

test('keeps measured values accessible when large text replaces the plot', async () => {
  const original = Dimensions.get('window');
  Dimensions.set({ window: { ...original, fontScale: 2 } });
  const observations = mapBloodPressureCorrelation(
    correlation('large-text'),
    '2026-10-12T00:00:00Z',
  ).observations;
  await render(
    <HealthRecordsLineChart
      category="blood_pressure"
      observations={observations}
    />,
  );
  expect(screen.getByText(/큰 글자에서는/)).toBeTruthy();
  expect(screen.getByText(/수축기 \(실선\)/)).toBeTruthy();
  expect(screen.getByText(/이완기 \(점선\)/)).toBeTruthy();
  expect(screen.getByText(/120 mmHg/)).toBeTruthy();
  expect(screen.getByText(/80 mmHg/)).toBeTruthy();
  await act(() => Dimensions.set({ window: original }));
});
