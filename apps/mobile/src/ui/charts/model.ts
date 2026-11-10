import type { ChartData } from './types';

export type ChartRow = {
  x: number | string;
  [key: string]: number | string | null;
};

/** Fail closed when the renderer cannot preserve the supplied series faithfully. */
export function chartRows(data: ChartData, axis: 'time' | 'day'): ChartRow[] {
  if (new Set(data.series.map(item => item.unit)).size > 1) {
    throw new Error('A plot cannot combine different units');
  }
  if (new Set(data.series.map(item => item.id)).size !== data.series.length) {
    throw new Error('Series identifiers must be unique');
  }
  if (data.series.some(item => !item.id || item.id === 'x')) {
    throw new Error('Invalid series identifier');
  }
  const rows = new Map<string | number, ChartRow>();
  for (const series of data.series) {
    const seen = new Set<string | number>();
    for (const point of series.points) {
      const x = axis === 'time' ? Date.parse(point.x) : point.x;
      if (
        (axis === 'time' && !Number.isFinite(x)) ||
        (axis === 'day' && !/^\d{4}-\d{2}-\d{2}$/.test(point.x))
      ) {
        throw new Error('Invalid chart position');
      }
      if (point.value !== null && !Number.isFinite(point.value))
        throw new Error('Invalid chart value');
      if (seen.has(x) && axis === 'day')
        throw new Error('Duplicate daily bucket');
      seen.add(x);
      const row = rows.get(x) ?? { x };
      row[series.id] = point.value;
      rows.set(x, row);
    }
  }
  const result = [...rows.values()].sort((a, b) =>
    a.x < b.x ? -1 : a.x > b.x ? 1 : 0,
  );
  return result;
}

/** Split only at explicit missing observations; unrelated series times are not gaps. */
export function lineSegments(data: ChartData) {
  const rows: ChartRow[] = chartRows(data, 'time').map(row => ({ x: row.x }));
  const positions = new Map(rows.map(row => [row.x, row]));
  const segments: { id: string; seriesId: string }[] = [];
  for (const series of data.series) {
    let current: string | undefined;
    let previousTime: number | undefined;
    const points = [...series.points].sort(
      (a, b) => Date.parse(a.x) - Date.parse(b.x),
    );
    for (const point of points) {
      const time = Date.parse(point.x);
      // Simultaneous measurements remain separate marks, without a vertical invented connection.
      if (time === previousTime) current = undefined;
      previousTime = time;
      if (point.value === null) {
        current = undefined;
        continue;
      }
      if (!current) {
        current = `segment_${segments.length}`;
        segments.push({ id: current, seriesId: series.id });
      }
      const row = positions.get(time);
      if (row) row[current] = point.value;
    }
  }
  return { rows, segments };
}
