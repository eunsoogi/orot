import type { ChartRow } from './model';
import type { ChartAxis, ChartTimeWindow } from './types';

const daysMs = 32 * 24 * 60 * 60 * 1000;

export function chartWindowLimit(
  window: ChartTimeWindow,
  axis: ChartAxis = 'time',
) {
  const first = Date.parse(window.fromInclusive),
    last = Date.parse(window.toInclusive);
  if (
    !Number.isFinite(first) ||
    !Number.isFinite(last) ||
    last < first ||
    last - first > daysMs
  )
    return null;
  if (axis === 'time') return { first, last };
  const localMidnight = (instant: number) => {
    const local = new Date(instant);
    return Date.UTC(local.getFullYear(), local.getMonth(), local.getDate());
  };
  return { first: localMidnight(first), last: localMidnight(last) };
}

/** The rendering library domains are inferred from rows. Bare position rows
 * reserve axes only; they never enter ChartData, measured statistics, or selection. */
export function placeChartWindow(
  rows: readonly ChartRow[],
  window: ChartTimeWindow | undefined,
  axis: ChartAxis,
): ChartRow[] {
  const limits = window && rows.length ? chartWindowLimit(window) : null;
  if (!limits) return [...rows];
  const map = new Map(rows.map(row => [row.x, row]));
  const anchor = (position: number | string) => {
    if (!map.has(position)) map.set(position, { x: position });
  };
  if (axis === 'time') {
    anchor(limits.first);
    anchor(limits.last);
  } else {
    const day = new Date(limits.first);
    day.setHours(0, 0, 0, 0);
    for (let step = 0; step < 34 && day.getTime() <= limits.last; step += 1) {
      anchor(
        [
          day.getFullYear(),
          String(day.getMonth() + 1).padStart(2, '0'),
          String(day.getDate()).padStart(2, '0'),
        ].join('-'),
      );
      day.setDate(day.getDate() + 1);
    }
  }
  return [...map.values()].sort((a, b) => (a.x < b.x ? -1 : a.x > b.x ? 1 : 0));
}
