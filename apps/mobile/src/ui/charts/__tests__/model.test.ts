import { chartRows, lineSegments } from '../model';
import type { ChartData } from '../types';

const fixture: ChartData = {
  metric: 'bloodPressure',
  coverage: { requested: 'week', displayed: 'week', status: 'partial' },
  series: [
    {
      id: 'systolic',
      style: 'primary',
      label: '수축기',
      unit: 'mmHg',
      points: [
        { x: '2026-01-01T00:00:00Z', value: 120, source: 'synthetic' },
        { x: '2026-01-01T01:00:00Z', value: null, source: 'synthetic' },
        {
          x: '2026-01-01T04:00:00Z',
          value: 0,
          source: 'synthetic',
          partial: true,
        },
      ],
    },
    {
      id: 'diastolic',
      style: 'secondary',
      label: '이완기',
      unit: 'mmHg',
      points: [
        { x: '2026-01-01T00:00:00Z', value: 80, source: 'synthetic' },
        { x: '2026-01-01T01:00:00Z', value: null, source: 'synthetic' },
        { x: '2026-01-01T04:00:00Z', value: 55, source: 'synthetic' },
      ],
    },
  ],
};

it('keeps irregular times, measured zero and missing values in separate series', () => {
  const rows = chartRows(fixture, 'time');
  expect(rows.map(row => row.x)).toEqual([
    Date.parse('2026-01-01T00:00:00Z'),
    Date.parse('2026-01-01T01:00:00Z'),
    Date.parse('2026-01-01T04:00:00Z'),
  ]);
  expect(rows[1]).toMatchObject({ systolic: null, diastolic: null });
  expect(rows[2]).toMatchObject({ systolic: 0, diastolic: 55 });
});

it('rejects mixed units', () => {
  expect(() =>
    chartRows(
      {
        ...fixture,
        series: [fixture.series[0]!, { ...fixture.series[1]!, unit: 'bpm' }],
      },
      'time',
    ),
  ).toThrow('different units');
});

it('splits explicit nulls without splitting at another series observation', () => {
  const input = {
    ...fixture,
    series: [
      fixture.series[0]!,
      {
        ...fixture.series[1]!,
        points: [
          fixture.series[1]!.points[0]!,
          { x: '2026-01-01T02:00:00Z', value: 82, source: 'synthetic' },
          fixture.series[1]!.points[2]!,
        ],
      },
    ],
  };
  const result = lineSegments(input);
  expect(result.segments.map(segment => segment.seriesId)).toEqual([
    'systolic',
    'systolic',
    'diastolic',
  ]);
  expect(
    result.rows.map(row => [
      row.segment_0 ?? null,
      row.segment_1 ?? null,
      row.segment_2 ?? null,
    ]),
  ).toEqual([
    [120, null, 80],
    [null, null, null],
    [null, null, 82],
    [null, 0, 55],
  ]);
});

it('preserves a single daily zero', () => {
  const one = {
    ...fixture,
    series: [
      {
        ...fixture.series[0]!,
        points: [{ x: '2026-01-01', value: 0, source: 'synthetic' }],
      },
    ],
  };
  expect(chartRows(one, 'day')).toEqual([{ x: '2026-01-01', systolic: 0 }]);
});

it('keeps simultaneous observations as distinct marks', () => {
  const sameTime = {
    ...fixture,
    series: [
      {
        ...fixture.series[0]!,
        points: [
          { x: '2026-01-01T00:00:00Z', value: 120, source: 'one' },
          { x: '2026-01-01T00:00:00Z', value: 125, source: 'two' },
        ],
      },
    ],
  };
  const result = lineSegments(sameTime);
  expect(result.segments).toHaveLength(2);
  expect(result.rows[0]).toMatchObject({ segment_0: 120, segment_1: 125 });
});
