import { chartWindows } from '../window';
import type { ChartData } from '../types';

test('pages every observation in time order without losing extrema or source', () => {
  const data: ChartData = {
    metric: 'heartRate',
    coverage: { requested: '전체', displayed: '전체', status: 'ready' },
    series: [
      {
        id: 'rate',
        style: 'primary',
        label: '심박수',
        unit: 'count/min',
        points: [
          { x: '2026-01-03T00:00:00Z', value: 500, source: '세 번째' },
          { x: '2026-01-01T00:00:00Z', value: 1, source: '첫 번째' },
          { x: '2026-01-02T00:00:00Z', value: null, source: '두 번째' },
        ],
      },
    ],
  };
  const windows = chartWindows(data, 'time', 2);
  expect(windows).toHaveLength(2);
  expect(windows.flatMap(window => window.series[0]!.points)).toEqual([
    data.series[0]!.points[1],
    data.series[0]!.points[2],
    data.series[0]!.points[0],
  ]);
});

test('bounds simultaneous observations and retains all series identities', () => {
  const data: ChartData = {
    metric: 'bloodPressure',
    coverage: { requested: 'day', displayed: 'day', status: 'ready' },
    series: [
      {
        id: 's',
        style: 'primary',
        label: '수축기',
        unit: 'mmHg',
        points: Array.from({ length: 3 }, (_, i) => ({
          x: '2026-01-01T00:00:00Z',
          value: i,
          source: String(i),
        })),
      },
      {
        id: 'd',
        style: 'secondary',
        label: '이완기',
        unit: 'mmHg',
        points: [{ x: '2026-01-01T00:00:00Z', value: 80, source: 'd' }],
      },
    ],
  };
  const windows = chartWindows(data, 'time', 2);
  expect(
    windows.map(page =>
      page.series.reduce((sum, series) => sum + series.points.length, 0),
    ),
  ).toEqual([2, 2]);
  expect(
    windows.flatMap(page => page.series.flatMap(series => series.points)),
  ).toHaveLength(4);
  expect(
    windows.every(
      page => page.series.map(series => series.id).join(',') === 's,d',
    ),
  ).toBe(true);
});
