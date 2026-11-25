import { fireEvent, render, screen } from '@testing-library/react-native';
import { HealthRecordsLineChart } from '../HealthRecordsLineChart';
import { healthKitSample } from '../commonObservations/testSupport';
import {
  mapCommonObservationSample,
  toCommonObservationRecord,
} from '../commonObservations/mapper';

const mounted = { includeHiddenElements: true };
const at = (day: number, hour: number) =>
  new Date(2035, 0, day, hour).toISOString();

test.each([
  ['restingHeartRate', 'resting_heart_rate'],
  ['walkingHeartRateAverage', 'walking_heart_rate_average'],
] as const)(
  '%s uses only measured daily line points in preview and detail',
  async (feature, category) => {
    const measured = (id: string, day: number, hour: number, value: number) => {
      const result = mapCommonObservationSample(
        feature,
        healthKitSample(feature, {
          id,
          value,
          startDate: at(day, hour),
          endDate: at(day, hour + 1),
        }),
      );
      if (result.status !== 'mapped')
        throw new Error('Invalid synthetic estimate');
      return toCommonObservationRecord(result.observation, at(17, 20));
    };
    const observations = [
      measured('first', 12, 9, 65.5),
      measured('same-day', 12, 16, 84.5),
      measured('last', 14, 9, 93.9),
    ];
    const view = await render(
      <HealthRecordsLineChart
        category={category}
        observations={observations}
        preview
      />,
    );
    await fireEvent(
      screen.getByTestId('health-record-chart-plot-row'),
      'layout',
      {
        nativeEvent: { layout: { width: 320 } },
      },
    );
    for (const preview of [true, false]) {
      await view.rerender(
        <HealthRecordsLineChart
          category={category}
          observations={observations}
          preview={preview}
        />,
      );
      const paths = screen.getByTestId('chart-layer.data', mounted).children;
      expect(
        paths.some(
          path =>
            typeof path !== 'string' &&
            JSON.stringify(path.props.strokeDasharray) === '[4,4]',
        ),
      ).toBe(true);
      expect(screen.getAllByTestId(/^line-dot\./u, mounted)).toHaveLength(2);
      expect(screen.queryByTestId('chart-range-span', mounted)).toBeNull();
    }
    await view.rerender(
      <HealthRecordsLineChart category={category} observations={[]} preview />,
    );
    expect(screen.queryAllByTestId(/^line-dot\./u, mounted)).toHaveLength(0);
  },
);
