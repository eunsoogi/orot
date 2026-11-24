import { validChartRangePoint } from './chartRangeGeometry';
import type { ChartPoint, ChartSeries } from './types';

const dayMs = 86_400_000;
const dayPattern = /^\d{4}-\d{2}-\d{2}$/u;

function day(value: string) {
  return dayPattern.test(value) ? Date.parse(value + 'T00:00:00Z') : NaN;
}

function isoDay(value: number) {
  return new Date(value).toISOString().slice(0, 10);
}

/** Each input series has already proven one source/unit and exact daily stats.
 * Display-only: retain daily ranges when meaningful and never join sources. */
export function summarizeSparseHeartRates(
  series: readonly ChartSeries[],
): readonly ChartSeries[] {
  const dailyPoints = series.flatMap(item => item.points);
  const observed = dailyPoints.filter(validChartRangePoint);
  if (
    observed.length < 2 ||
    observed.some(point => point.range.minimum < point.range.maximum)
  )
    return series;
  if (
    dailyPoints.some(
      point =>
        !Number.isFinite(day(point.x)) ||
        (point.value !== null && !validChartRangePoint(point)),
    )
  )
    return series;

  const days = dailyPoints.map(point => day(point.x));
  const first = Math.min(...days);
  const last = Math.max(...days);
  const length = (last - first) / dayMs + 1;
  if (length < 2 || length > 366) return series; // This is a bounded day chart.
  const count = Math.ceil(length / 3);
  const bins = Array.from({ length: count }, (_, i) => ({
    start: first + Math.floor((i * length) / count) * dayMs,
    end: first + (Math.floor(((i + 1) * length) / count) - 1) * dayMs,
  }));
  const projected = series.map(item => {
    const points: ChartPoint[] = bins.map(bin => {
      let samples = 0;
      let mean = 0;
      let minimum = Infinity;
      let maximum = -Infinity;
      let partial = false;
      const sources = new Set<string>();
      for (const point of item.points) {
        if (day(point.x) < bin.start || day(point.x) > bin.end) continue;
        partial ||= point.partial === true;
        if (!validChartRangePoint(point)) continue;
        const next = samples + point.range.samples;
        mean += (point.value - mean) * (point.range.samples / next);
        samples = next;
        minimum = Math.min(minimum, point.range.minimum);
        maximum = Math.max(maximum, point.range.maximum);
        sources.add(point.source);
      }
      const start = isoDay(bin.start);
      const end = isoDay(bin.end);
      return {
        x: end,
        period: { start, end },
        value: samples ? Math.min(maximum, Math.max(minimum, mean)) : null,
        ...(samples ? { range: { minimum, maximum, samples } } : {}),
        source: [...sources].join(' · '),
        ...(partial ? { partial: true } : {}),
      };
    });
    return { ...item, points };
  });
  // Do not rebase a chart when contiguous intervals still contain no real span.
  return projected.some(item =>
    item.points.some(
      point => point.range && point.range.minimum < point.range.maximum,
    ),
  )
    ? projected
    : series;
}
