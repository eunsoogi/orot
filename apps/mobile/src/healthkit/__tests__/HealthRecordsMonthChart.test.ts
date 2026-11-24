import {
  formatChartPointPosition,
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

test('bar domain slots have x only, measured zero would remain distinct and source steps are not averaged', () => {
  const { kind, data } = buildHealthRecordsMonthChart('steps', window, {
    kind: 'quantity',
    rows: [{ ...row, concept: 'step_count', unit: 'count', sum: 536 }],
  });
  expect(kind).toBe('bar');
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

test('monthly derived heart range groups actual consecutive days without merging a second sensor', () => {
  const { data } = buildHealthRecordsMonthChart('resting_heart_rate', window, {
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
  expect(data.presentation).toBe('whole-bpm-derived-records');
  const [first, second] = data.series;
  expect(first?.id).not.toBe(second?.id);
  expect(first?.points).toHaveLength(1);
  const measured = first!.points[0]!;
  expect(measured.range).toEqual({
    minimum: 62.25,
    maximum: 88.75,
    samples: 3,
  });
  expect(measured.value).toBeCloseTo((124.5 + 88.75) / 3);
  expect(measured.period).toEqual({ start: '2026-10-24', end: '2026-10-26' });
  expect(formatChartPointPosition(measured, 'day')).toContain('2026-10-24');
  expect(
    formatChartPointValue(
      data.metric,
      measured,
      'count/min',
      data.presentation,
    ),
  ).toMatch(/62.*89.*71/);
  expect(second?.points[0]?.range).toEqual({
    minimum: 107,
    maximum: 107,
    samples: 1,
  });
  expect(
    data.series.flatMap(item => item.points).every(p => p.value !== null),
  ).toBe(true);
});
