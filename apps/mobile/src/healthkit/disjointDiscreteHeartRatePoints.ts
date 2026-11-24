import type { ChartPoint } from '../ui/charts/types';

type Point = ChartPoint & { value: number; endAt?: string };

/** Containers can overlap. Prefer their original scalar estimates over claiming
 * underlying readings are independent when multiple same-source intervals intersect. */
export function disjointDiscreteHeartRatePoints(
  points: readonly Point[],
): Point[] {
  if (!points.some(point => point.range)) return [...points];
  const ordered = [...points].sort((a, b) => Date.parse(a.x) - Date.parse(b.x));
  let latestEnd = -Infinity;
  return ordered.map((point, index) => {
    const start = Date.parse(point.x);
    const end = Date.parse(point.endAt ?? point.x);
    const next = ordered[index + 1];
    const overlaps = latestEnd >= start || (next && Date.parse(next.x) <= end);
    latestEnd = Math.max(latestEnd, end);
    if (!point.range || !overlaps) return point;
    return {
      x: point.x,
      value: point.value,
      source: point.source,
      endAt: point.endAt,
    };
  });
}
