import type { ChartData, ChartPoint } from './types';

/** Window observations rather than decimating them, so every original value remains reachable. */
export function chartWindows(
  data: ChartData,
  axis: 'time' | 'day',
  limit = 100,
): ChartData[] {
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error('Invalid chart window size');
  const entries = data.series.flatMap((series, seriesIndex) =>
    series.points.map((point, pointIndex) => ({
      seriesIndex,
      pointIndex,
      point,
    })),
  );
  entries.sort((a, b) => {
    const left = axis === 'time' ? Date.parse(a.point.x) : a.point.x;
    const right = axis === 'time' ? Date.parse(b.point.x) : b.point.x;
    return left < right
      ? -1
      : left > right
        ? 1
        : a.seriesIndex - b.seriesIndex || a.pointIndex - b.pointIndex;
  });
  if (entries.length === 0) return [data];
  const batches: (typeof entries)[] = [];
  let batch: typeof entries = [];
  for (let start = 0; start < entries.length;) {
    const position =
      axis === 'time'
        ? Date.parse(entries[start]!.point.x)
        : entries[start]!.point.x;
    let end = start + 1;
    while (
      end < entries.length &&
      (axis === 'time'
        ? Date.parse(entries[end]!.point.x)
        : entries[end]!.point.x) === position
    )
      end += 1;
    const group = entries.slice(start, end);
    if (batch.length && batch.length + group.length > limit) {
      batches.push(batch);
      batch = [];
    }
    while (group.length > limit) batches.push(group.splice(0, limit));
    batch.push(...group);
    start = end;
  }
  if (batch.length) batches.push(batch);
  return batches.map(windowEntries => {
    const points: ChartPoint[][] = data.series.map(() => []);
    for (const entry of windowEntries)
      points[entry.seriesIndex]!.push(entry.point);
    return {
      ...data,
      series: data.series.map((series, index) => ({
        ...series,
        points: points[index]!,
      })),
    };
  });
}
