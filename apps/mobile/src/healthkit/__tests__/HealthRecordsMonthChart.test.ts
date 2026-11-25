import {
  formatChartPosition,
  formatChartPointValue,
} from '../../ui/charts/format';
import type { HealthObservationMonthChart } from '@orot/storage';
import { buildHealthRecordsMonthChart } from '../healthRecordsMonthChart';
import { chartRows } from '../../ui/charts/model';
import { chartRangeGeometry } from '../../ui/charts/chartRangeGeometry';
import { placeChartWindow } from '../../ui/charts/chartWindowPositions';
import { chartWindows } from '../../ui/charts/window';

const window = {
  fromInclusive: '2026-10-22T00:00:00Z',
  toInclusive: '2026-11-22T12:00:00Z',
};
const source = (system: string) =>
  JSON.stringify(['imported', 'healthkit', system, 'watch']);
const row = {
  effectiveAt: '2026-11-01T00:00:00.000Z',
  concept: 'heart_rate',
  unit: 'count/min',
  source: source('one'),
  sampleCount: 8,
  min: 55,
  max: 88,
  mean: 67,
  sum: 536,
};

test('sparse measured heart bands use the real month domain without fabricated points', () => {
  const projection: HealthObservationMonthChart = {
    kind: 'quantity',
    rows: [row, { ...row, source: source('two'), min: 53 }],
  };
  const { kind, data } = buildHealthRecordsMonthChart(
    'heart_rate',
    window,
    projection,
  );
  expect(kind).toBe('range');
  expect(data.series.map(s => s.points.length)).toEqual([1, 1]);
  const plot = chartRangeGeometry(
    data.series,
    338,
    160,
    'day',
    0,
    data.xWindow,
  );
  expect(plot?.ticks).toEqual([
    Date.parse(window.fromInclusive),
    Date.parse('2026-11-22T00:00:00Z'),
  ]);
  expect(plot?.marks).toHaveLength(2);
  expect(plot?.marks.map(p => p.sourceX)).toEqual(['2026-11-01', '2026-11-01']);
  expect(data.series[0]?.points[0]?.range).toEqual({
    minimum: 55,
    maximum: 88,
    samples: 8,
  });
  expect(chartWindows(data, 'time', 1)).toEqual([data]);
});

test('daily step lines leave unmeasured slots empty and do not average source totals', () => {
  const { kind, data } = buildHealthRecordsMonthChart('steps', window, {
    kind: 'quantity',
    rows: [{ ...row, concept: 'step_count', unit: 'count', sum: 536 }],
  });
  expect(kind).toBe('line');
  expect(data.series[0]?.points[0]?.value).toBe(536);
  const rows = placeChartWindow(chartRows(data, 'day'), window, 'day');
  expect(rows[0]).toEqual({ x: '2026-10-22' });
  expect(rows.at(-1)).toEqual({ x: '2026-11-22' });
  expect(rows.filter(item => Object.keys(item).length > 1)).toHaveLength(1);
  expect(data.series[0]?.points).toHaveLength(1);
});

test('loading, failure, and measured-empty remain distinct without synthetic points', () => {
  expect(
    buildHealthRecordsMonthChart('sleep', window).data.coverage.status,
  ).toBe('loading');
  expect(
    buildHealthRecordsMonthChart('sleep', window, undefined, true).data.coverage
      .status,
  ).toBe('error');
  expect(
    buildHealthRecordsMonthChart('sleep', window, { kind: 'sleep', rows: [] })
      .data.coverage.status,
  ).toBe('empty');
});

test('monthly derived heart line keeps adjacent local days and a second sensor separate', () => {
  const chart = buildHealthRecordsMonthChart('resting_heart_rate', window, {
    kind: 'quantity',
    rows: [
      {
        ...row,
        concept: 'resting_heart_rate',
        effectiveAt: '2026-10-24T00:00:00Z',
        min: 62.25,
        max: 62.25,
        mean: 62.25,
        sampleCount: 2,
        sum: 124.5,
      },
      {
        ...row,
        concept: 'resting_heart_rate',
        effectiveAt: '2026-10-25T00:00:00Z',
        min: 88.75,
        max: 88.75,
        mean: 88.75,
        sampleCount: 1,
        sum: 88.75,
      },
      {
        ...row,
        concept: 'resting_heart_rate',
        effectiveAt: '2026-10-25T00:00:00Z',
        source: source('other'),
        min: 107,
        max: 107,
        mean: 107,
        sampleCount: 1,
        sum: 107,
      },
    ],
  });
  expect(chart.kind).toBe('line');
  const { data } = chart;
  expect(data.presentation).toBe('whole-bpm-derived-records');
  const [first, second] = data.series;
  expect(first?.id).not.toBe(second?.id);
  expect(first?.points.map(point => point.x)).toEqual([
    '2026-10-24',
    '2026-10-25',
  ]);
  const measured = first!.points[0]!;
  expect(measured.range).toEqual({
    minimum: 62.25,
    maximum: 62.25,
    samples: 2,
  });
  expect(measured.value).toBe(62.25);
  expect(measured).not.toHaveProperty('period');
  expect(first?.points[1]).toMatchObject({
    value: 88.75,
    range: { minimum: 88.75, maximum: 88.75, samples: 1 },
  });
  expect(formatChartPosition(measured.x, 'day')).toContain('2026-10-24');
  expect(
    formatChartPointValue(
      data.metric,
      measured,
      'count/min',
      data.presentation,
    ),
  ).toContain('62');
  expect(second?.points[0]?.range).toEqual({
    minimum: 107,
    maximum: 107,
    samples: 1,
  });
  expect(
    data.series.flatMap(item => item.points).every(p => p.value !== null),
  ).toBe(true);
});

test('the full-month workout duration chart uses bars and actual daily totals', () => {
  const { kind, data } = buildHealthRecordsMonthChart('workouts', window, {
    kind: 'quantity',
    rows: [
      { ...row, concept: 'workout_duration', unit: 'min', mean: 31, sum: 248 },
    ],
  });
  expect(kind).toBe('bar');
  expect(data.xWindow).toEqual(window);
  expect(data.series[0]?.points).toEqual([
    expect.objectContaining({ x: '2026-11-01', value: 248 }),
  ]);
  expect(data.series[0]?.points[0]?.range).toBeUndefined();
});

test('sparse and missing sleep stay on the time line with no invented observations', () => {
  expect(buildHealthRecordsMonthChart('sleep', window).kind).toBe('line');
  const { kind, data } = buildHealthRecordsMonthChart('sleep', window, {
    kind: 'sleep',
    rows: [{ effectiveAt: row.effectiveAt, source: row.source, minutes: 420 }],
  });
  expect(kind).toBe('line');
  expect(data.xWindow).toEqual(window);
  expect(data.series[0]?.points).toEqual([
    expect.objectContaining({ x: row.effectiveAt, value: 420 }),
  ]);
});
