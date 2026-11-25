import { fireEvent, render, screen } from '@testing-library/react-native';
import { overviewMetricChartData } from '../../../routes/overview/overviewMetricChart';
import type { OverviewMetricProjection } from '../../../routes/overview/metricProjection';
import { ChartPlot } from '../ChartPlot';
import { HealthRecordsLineChart } from '../../../healthkit/HealthRecordsLineChart';
import {
  mapCommonObservationSample,
  toCommonObservationRecord,
} from '../../../healthkit/commonObservations/mapper';
import { healthKitSample } from '../../../healthkit/commonObservations/testSupport';

const day = (i: number) => '2035-01-0' + i;

test.each(['restingHeartRate', 'walkingHeartRate'] as const)(
  '%s keeps a daily observed range, true singleton days and missing days',
  async metric => {
    const projection: OverviewMetricProjection = {
      metric,
      unit: 'count/min',
      source: 'synthetic',
      measuredAt: null,
      timeZone: 'UTC',
      latest: { date: day(4), value: 85 },
      comparison: null,
      days: [
        {
          date: day(1),
          value: 67.5,
          range: { minimum: 60, maximum: 90, samples: 4 },
          partial: false,
        },
        {
          date: day(2),
          value: 75,
          range: { minimum: 75, maximum: 75, samples: 1 },
          partial: false,
        },
        { date: day(3), value: null, partial: false },
        {
          date: day(4),
          value: 85,
          range: { minimum: 85, maximum: 85, samples: 1 },
          partial: false,
        },
      ],
    };
    const data = overviewMetricChartData(projection);
    expect(
      data.series[0]?.points.map(point => [point.x, point.value, point.range]),
    ).toEqual(projection.days.map(item => [item.date, item.value, item.range]));
    await render(
      <ChartPlot
        data={data}
        width={300}
        height={176}
        title="합성 심박수"
        testID="daily"
        hideDetails
        barTooltip
        kind="range"
        rangeAxis="day"
      />,
    );
    const opts = { includeHiddenElements: true };
    expect(screen.getAllByTestId('chart-range-span', opts)).toHaveLength(1);
    expect(screen.getAllByTestId('chart-range-mean', opts)).toHaveLength(1);
    expect(screen.getAllByTestId('chart-range-flat', opts)).toHaveLength(2);
    const plot = screen.getByTestId('daily-plot');
    await fireEvent(plot, 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
    expect(plot.props.accessibilityLabel).toContain(day(1));
    expect(plot.props.accessibilityLabel).toContain(
      '최저 60 BPM, 최고 90 BPM, 평균 67 BPM',
    );
    expect(screen.queryByText(/2~3일 단위/)).toBeNull();
  },
);

test('Records combines same-day observations only within their exact source', async () => {
  const sample = (
    id: string,
    date: number,
    hour: number,
    bpm: number,
    sourceIdentifier: string,
  ) => {
    const at = new Date(2035, 0, date, hour).toISOString();
    const mapped = mapCommonObservationSample(
      'restingHeartRate',
      healthKitSample('restingHeartRate', {
        id,
        startDate: at,
        endDate: at,
        value: bpm,
        sourceIdentifier,
        sourceName: sourceIdentifier,
      }),
    );
    if (mapped.status !== 'mapped') throw new Error('Invalid synthetic sample');
    return toCommonObservationRecord(mapped.observation, at);
  };
  await render(
    <HealthRecordsLineChart
      category="resting_heart_rate"
      preview
      observations={[
        sample('watch1', 1, 9, 60, 'watch'),
        sample('watch2', 1, 10, 60, 'watch'),
        sample('watch3', 1, 11, 60, 'watch'),
        sample('watch4', 1, 12, 89, 'watch'),
        sample('phone1', 1, 13, 100, 'phone'),
        sample('watch5', 2, 12, 75, 'watch'),
        sample('watch6', 4, 12, 85, 'watch'),
      ]}
    />,
  );
  await fireEvent(
    screen.getByTestId('health-record-chart-plot-row'),
    'layout',
    {
      nativeEvent: { layout: { width: 320 } },
    },
  );
  const opts = { includeHiddenElements: true };
  expect(screen.getAllByTestId(/^line-dot\./u, opts)).toHaveLength(4);
  expect(screen.queryByTestId('chart-range-span', opts)).toBeNull();
  const plot = screen.getByTestId(
    'health-record-chart-values-resting_heart_rate-plot',
  );
  expect(plot.props.accessibilityLabel).toContain(
    '최저 60 BPM, 최고 89 BPM, 평균 67 BPM',
  );
  expect(plot.props.accessibilityLabel).not.toContain('최고 100 BPM');
  expect(plot.props.accessibilityLabel).not.toContain(day(3));
});
