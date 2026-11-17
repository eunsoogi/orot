import { localQueryTimestampKey } from '@orot/storage';
import type { HealthContextDay } from './types';

/** Assign each interval's first overlapping civil day with a sorted sweep, then walk
 * only actual overlapping days. Ordinals refer to the supplied DST-aware calendar;
 * no fixed 24-hour assumption, interval/day cap or timestamp rounding is introduced. */
export const sleepIntervalCalendarSql = `calendar_events AS (
  SELECT o.start, o.finish, o.stage,
    max(o.start, (SELECT min(from_at) FROM days)) AS at, 1 AS sample,
    NULL AS day_index, NULL AS day_to
  FROM observations o WHERE o.finish > o.start
  UNION ALL
  SELECT NULL, NULL, NULL, from_at, 0, day_index, to_at FROM days
), calendar_sweep AS (
  SELECT *, max(day_index) OVER calendar_order AS assigned_day,
    max(day_to) OVER calendar_order AS assigned_to
  FROM calendar_events
  WINDOW calendar_order AS (ORDER BY at, sample ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
), interval_days(day_index, start, finish, stage) AS (
  SELECT assigned_day, start, finish, stage FROM calendar_sweep
    WHERE sample = 1 AND assigned_day IS NOT NULL AND at < assigned_to
  UNION ALL
  SELECT i.day_index + 1, i.start, i.finish, i.stage FROM interval_days i
    JOIN days d ON d.day_index = i.day_index + 1 WHERE i.finish > d.from_at
), samples AS MATERIALIZED (
  SELECT d.date, max(i.start, d.from_at) * 86400 AS start,
    min(i.finish, d.to_at) * 86400 AS finish, i.stage
  FROM interval_days i JOIN days d ON d.day_index = i.day_index
)`;

export const sleepIntervalDayJoinSql = `samples AS MATERIALIZED (
  SELECT d.date, max(o.start, d.from_at) * 86400 AS start,
    min(o.finish, d.to_at) * 86400 AS finish, o.stage
  FROM observations o JOIN days d ON o.start < d.to_at AND o.finish > d.from_at
)`;

/** Production civil calendars are contiguous. Preserve the public reader's previous
 * overlap/gap semantics for other supplied calendars rather than silently dropping intervals. */
export function sleepCalendarConnector(days: readonly HealthContextDay[]) {
  let previous: string | undefined;
  for (const day of days) {
    const from = localQueryTimestampKey(day.fromInclusive);
    const to = localQueryTimestampKey(day.toExclusive);
    if (from >= to || (previous !== undefined && previous !== from))
      return sleepIntervalDayJoinSql;
    previous = to;
  }
  return sleepIntervalCalendarSql;
}
