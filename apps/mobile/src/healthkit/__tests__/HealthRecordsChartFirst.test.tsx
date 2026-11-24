import { render, within } from '@testing-library/react-native';
import type { ChartData } from '../../ui/charts';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { HealthRecordsCategoryCard } from '../HealthRecordsCategoryCard';
import { sleepPreviewPoints } from '../HealthRecordsSleepChart';
import { sleepAnalysisTypeIdentifier } from '../sleep/types';

jest.mock('../../ui/charts', () => {
  const { Text } = require('react-native');
  return {
    ChartPlot: (props: { data: ChartData; testID: string }) => (
      <Text testID={props.testID}>{JSON.stringify(props)}</Text>
    ),
  };
});

function sleep(id: string, stage: string, start: Date, end: Date) {
  return {
    ...healthObservation(id, sleepAnalysisTypeIdentifier, start.toISOString()),
    endedAt: end.toISOString(),
    value: { kind: 'text' as const, text: stage },
  };
}

test('coincident ordinary heart rate uses the detailed range with no sparse presentation', async () => {
  const at = new Date(Date.now() - 60000).toISOString();
  const record = healthObservation('one', 'heart_rate', at);
  const view = await render(
    <HealthRecordsCategoryCard
      category="heart_rate"
      loadState="ready"
      observations={[
        {
          ...record,
          value: { kind: 'quantity', amount: 60, unit: 'count/min' },
        },
        {
          ...record,
          id: 'two',
          value: { kind: 'quantity', amount: 80, unit: 'count/min' },
        },
      ]}
      onOpenDetail={jest.fn()}
    />,
  );
  const chart = view.getByTestId('health-record-chart-values-heart_rate');
  const props = JSON.parse(chart.props.children);
  expect(props).toMatchObject({
    compact: false,
    hideDetails: false,
    kind: 'range',
  });
  expect(props.data.series[0].points[0]).toMatchObject({
    value: 70,
    range: { minimum: 60, maximum: 80, samples: 2 },
  });
  const card = view.getByTestId('health-record-category-heart_rate');
  const detail = within(card).getByTestId(
    'health-record-open-detail-heart_rate',
  );
  expect(
    within(card).getAllByTestId(
      /^health-record-(chart-values|open-detail)-heart_rate$/,
    ),
  ).toEqual([chart, detail]);
});

test('Sleep unions measured asleep intervals per local day without plotting awake or in-bed categories', () => {
  const a = new Date(2035, 0, 2, 23, 30);
  const midnight = new Date(2035, 0, 3, 0);
  const b = new Date(2035, 0, 3, 0, 30);
  const c = new Date(2035, 0, 3, 1, 0);
  const d = new Date(2035, 0, 3, 2, 0);
  const points = sleepPreviewPoints(
    [
      sleep('overlap-one', '3', a, b),
      sleep('overlap-two', 'asleepREM', midnight, c),
      sleep('awake', '2', c, d),
      sleep('inbed', '0', c, d),
      sleep('malformed', '4', d, c),
    ],
    d,
    true,
  );
  expect(points.map(({ x, value, partial }) => [x, value, partial])).toEqual([
    ['2035-01-02', 30, true],
    ['2035-01-03', 60, true],
  ]);
});

test('Sleep mounts a minutes bar and keeps its detail action below chart and no-data states', async () => {
  const end = new Date(Date.now() - 5 * 60000);
  const start = new Date(end.getTime() - 10 * 60000);
  const renderSleep = (stage: string) => (
    <HealthRecordsCategoryCard
      category="sleep"
      loadState="ready"
      observations={[sleep('synthetic', stage, start, end)]}
      onOpenDetail={jest.fn()}
    />
  );
  const view = await render(renderSleep('3'));
  const chart = view.getByTestId('health-record-chart-values-sleep');
  const opts = JSON.parse(chart.props.children);
  expect(opts).toMatchObject({ kind: 'bar' });
  expect(opts.data.series[0].unit).toBe('min');
  expect(
    opts.data.series[0].points.reduce(
      (total: number, point: { value: number }) => total + point.value,
      0,
    ),
  ).toBe(10);
  expect(
    view.getAllByTestId(/^health-record-(chart-values|open-detail)-sleep$/),
  ).toEqual([chart, view.getByTestId('health-record-open-detail-sleep')]);
  await view.rerender(renderSleep('2'));
  const empty = JSON.parse(
    view.getByTestId('health-record-chart-values-sleep').props.children,
  );
  expect(empty.data.coverage.status).toBe('empty');
  expect(empty.data.series[0].points).toEqual([]);
});
