import { formatChartTick } from './format';
import type { ChartSeries } from './types';

/** Make interval endpoints visible, thinning rather than falling back to an ambiguous day label. */
export function groupedRangeTicks(
  series: readonly ChartSeries[],
  plotWidth: number,
  fontSize: number,
  first: number,
  last: number,
) {
  const periods = new Map(
    series.flatMap(item =>
      item.points.flatMap(point =>
        point.period ? [[point.x, point.period] as const] : [],
      ),
    ),
  );
  if (!periods.size) return undefined;
  const halfLabel = fontSize * 3.8;
  if (plotWidth < 2 * halfLabel) return [];
  const inside = (x: number) =>
    Math.max(halfLabel, Math.min(plotWidth - halfLabel, x));
  const candidates = [...periods]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, period]) => {
      const at = Date.parse(date + 'T00:00:00Z');
      const x =
        first === last
          ? plotWidth / 2
          : 8 + (plotWidth - 16) * ((at - first) / (last - first));
      return {
        label:
          formatChartTick(period.start, 'day') +
          '–' +
          formatChartTick(period.end, 'day'),
        x: inside(x),
      };
    });
  const selected: typeof candidates = [];
  for (const tick of candidates) {
    if (!selected.length || tick.x - selected.at(-1)!.x >= 2 * halfLabel)
      selected.push(tick);
    else if (
      tick === candidates.at(-1) &&
      selected.length > 1 &&
      tick.x - selected.at(-2)!.x >= 2 * halfLabel
    )
      selected[selected.length - 1] = tick;
  }
  return selected;
}
