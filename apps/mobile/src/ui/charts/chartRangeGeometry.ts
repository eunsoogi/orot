import { chartWindowLimit } from './chartWindowPositions';
import type {
  ChartAxis,
  ChartPoint,
  ChartSeries,
  ChartTimeWindow,
} from './types';

const pad = 8;
const footer = 19;

export function validChartRangePoint(point: ChartPoint): point is ChartPoint & {
  value: number;
  range: NonNullable<ChartPoint['range']>;
} {
  const range = point.range;
  return (
    point.value !== null &&
    range !== undefined &&
    Number.isFinite(point.value) &&
    Number.isFinite(range.minimum) &&
    Number.isFinite(range.maximum) &&
    Number.isSafeInteger(range.samples) &&
    range.samples > 0 &&
    range.minimum <= point.value &&
    point.value <= range.maximum &&
    (range.samples !== 1 || range.minimum === range.maximum)
  );
}

/** Plot only real extrema. Null buckets reserve their time position without a glyph. */
export function chartRangeGeometry(
  series: readonly ChartSeries[],
  width: number,
  height: number,
  axis: ChartAxis,
  axisLabelWidth = 0,
  xWindow?: ChartTimeWindow,
) {
  const time = (point: ChartPoint) =>
    Date.parse(axis === 'day' ? `${point.x}T00:00:00Z` : point.x);
  const entries = series
    .flatMap((entry, index) =>
      entry.points.map(point => ({ point, entry, index, time: time(point) })),
    )
    .filter(item => Number.isFinite(item.time));
  const measured = entries.flatMap(item =>
    validChartRangePoint(item.point) ? [{ ...item, point: item.point }] : [],
  );
  if (!measured.length || width <= 2 * pad || height <= footer + 2 * pad)
    return null;
  const min = Math.min(...measured.map(item => item.point.range.minimum));
  const max = Math.max(...measured.map(item => item.point.range.maximum));
  const span = max - min;
  if (!Number.isFinite(span)) return null;
  const bounds = xWindow && chartWindowLimit(xWindow, axis);
  const first = bounds?.first ?? Math.min(...entries.map(item => item.time));
  const last = bounds?.last ?? Math.max(...entries.map(item => item.time));
  const plotHeight = height - footer - 2 * pad;
  const y = (value: number) =>
    pad + plotHeight * (min === max ? 0.5 : (max - value) / span);
  const plotWidth = width - 2 * pad - axisLabelWidth;
  const grouped = new Map<number, number>();
  if (axis === 'day') {
    for (const item of measured) {
      grouped.set(item.time, (grouped.get(item.time) ?? 0) + 1);
    }
  }
  const groupSize = Math.max(1, ...grouped.values());
  const days = [...grouped.keys()].sort((a, b) => a - b);
  const minGap = days
    .slice(1)
    .reduce(
      (gap, day, index) => Math.min(gap, day - days[index]!),
      last - first,
    );
  const availableGroupWidth =
    first === last
      ? plotWidth * 0.5
      : (plotWidth * minGap) / (last - first + minGap);
  const spacing =
    groupSize > 1 ? Math.min(22, availableGroupWidth / groupSize) : 0;
  const inset = ((groupSize - 1) * spacing) / 2;
  const x = (value: number) =>
    pad +
    inset +
    (plotWidth - 2 * inset) *
      (first === last ? 0.5 : (value - first) / (last - first));
  const nextInGroup = new Map<number, number>();
  const stroke = Math.min(
    9,
    Math.max(2, plotWidth / Math.max(entries.length, 1) / 2),
  );
  return {
    marks: measured.map(({ point, entry, index, time: at }) => {
      const offset = nextInGroup.get(at) ?? 0;
      nextInGroup.set(at, offset + 1);
      return {
        series: entry,
        index,
        x: x(at) + (offset - ((grouped.get(at) ?? 1) - 1) / 2) * spacing,
        high: y(point.range.maximum),
        low: y(point.range.minimum),
        mean: y(point.value),
        sourceX: point.x,
        stroke: spacing ? Math.min(stroke, Math.max(1, spacing / 2)) : stroke,
      };
    }),
    ticks: first === last ? [first] : [first, last],
    valueTicks: (min === max ? [min] : [min, max]).map(value => ({
      value,
      y: y(value),
    })),
    first,
    last,
  };
}
