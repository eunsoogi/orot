import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { HealthObservation } from '@orot/domain';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { HealthRecordsCategoryCharts } from '../HealthRecordsCategoryCharts';
import { workoutDurationPreviewSeries } from '../workoutDurationPreviewSeries';
import { ChartPlot } from '../../ui/charts';
jest.mock('../../ui/charts', () => ({
  ...jest.requireActual('../../ui/charts'),
  ChartPlot: jest.fn(() => null),
}));
const chart = jest.mocked(ChartPlot);
function record(
  id: string,
  time: string,
  amount: number,
  sourceIdentifier: string | undefined = 'source-a',
  unit = 'min',
): HealthObservation {
  const source = healthObservation(id, 'workout_duration', time);
  return {
    ...source,
    value: { kind: 'quantity', amount, unit },
    provenance: {
      ...source.provenance,
      source: {
        system: 'healthkit',
        sourceIdentifier,
        sourceName: 'Synthetic label',
      },
    },
  };
}

test('source-bound day sums keep missing slots, duplicate records, true zero and other units distinct', () => {
  const a = record('a', '2026-10-01T23:30:00Z', 12);
  const b = record('b', '2026-10-02T00:45:00Z', 17);
  const multi = workoutDurationPreviewSeries(
    [
      a,
      a,
      b,
      record('zero', '2026-10-04T00:00:00Z', 0),
      record('other-source', '2026-10-02T01:00:00Z', 40, 'source-b'),
      record('different-unit', '2026-10-02T01:00:00Z', 300, 'source-a', 's'),
    ],
    'min',
    'Asia/Seoul',
    true,
  );
  expect(
    multi.map(series =>
      series.points.map(({ x, value, partial }) => [x, value, partial]),
    ),
  ).toEqual([
    [
      ['2026-10-02', 29, true],
      ['2026-10-03', null, undefined],
      ['2026-10-04', 0, undefined],
    ],
    [
      ['2026-10-02', 40, true],
      ['2026-10-03', null, undefined],
      ['2026-10-04', null, undefined],
    ],
  ]);
});

test('Records mounts a daily bar plot from all visible workout sessions, not a thinned sample', async () => {
  const daily = Array.from({ length: 20 }, (_, i) =>
    record('synthetic-' + i, '2026-10-11T00:00:00Z', i + 1),
  );
  await render(
    <HealthRecordsCategoryCharts
      category="workouts"
      observations={daily}
      loadState="ready"
      hasMore={false}
    />,
  );
  await act(async () =>
    fireEvent(screen.getByTestId('health-record-chart-plot-row'), 'layout', {
      nativeEvent: { layout: { width: 300 } },
    }),
  );
  const props = chart.mock.calls.at(-1)?.[0];
  expect(props).toMatchObject({
    kind: 'bar',
    barTooltip: true,
    hideDetails: true,
    width: 300,
    data: {
      metric: 'workouts',
      series: [{ unit: 'min', points: [{ value: 210 }] }],
    },
  });
});

test('empty and nonworkout categories do not fabricate workout dates or adopt its bar renderer', async () => {
  const view = await render(
    <HealthRecordsCategoryCharts
      category="workouts"
      observations={[]}
      loadState="ready"
      hasMore={false}
    />,
  );
  expect(chart.mock.calls.at(-1)?.[0]).toMatchObject({
    kind: 'bar',
    data: { series: [], coverage: { status: 'empty' } },
  });
  await view.rerender(
    <HealthRecordsCategoryCharts
      category="body_mass"
      observations={[
        healthObservation('kg', 'body_mass', '2026-10-01T00:00:00Z'),
      ]}
      loadState="ready"
      hasMore={false}
    />,
  );
  expect(chart.mock.calls.at(-1)?.[0]).toMatchObject({ kind: 'line' });
});
