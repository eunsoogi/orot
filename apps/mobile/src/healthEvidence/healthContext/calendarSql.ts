import { localQueryTimestampKey } from '@orot/storage';
import type { HealthContextDay } from './types';

/** One bound JSON value keeps calendar length independent of SQLite's variable
 * limit. Values remain bound, and timestamp keys preserve sub-millisecond edges. */
export const healthContextCalendarSql =
  "SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]') FROM json_each(?)";

export function healthContextCalendarParameter(
  days: readonly HealthContextDay[],
  timestamps: 'key' | 'instant' = 'key',
): string {
  if (!days.length) throw new RangeError('Invalid health context days.');
  const encode =
    timestamps === 'key' ? localQueryTimestampKey : (value: string) => value;
  return JSON.stringify(
    days.map(day => [
      day.date,
      encode(day.fromInclusive),
      encode(day.toExclusive),
    ]),
  );
}
