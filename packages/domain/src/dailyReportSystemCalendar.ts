import { z } from 'zod';
import { TimestampSchema } from './common';

/** Only a bounded revision binding is retained, never raw event titles or identifiers. */
export const DailyReportSystemCalendarSchema = z.strictObject({
  fromInclusive: TimestampSchema,
  toExclusive: TimestampSchema,
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  recordId: z.string().min(1),
});
export type DailyReportSystemCalendar = z.infer<typeof DailyReportSystemCalendarSchema>;

/** The single external source must match the report day and its explicit native binding. */
export function validDailyReportSystemCalendar(
  binding: DailyReportSystemCalendar | undefined,
  interval: { fromInclusive: string; toExclusive: string },
  records: readonly { source: string; recordId: string; revision: string }[],
): boolean {
  const external = records.filter((record) => record.source === 'system_calendar');
  if (!binding) return external.length === 0;
  return (
    binding.fromInclusive === interval.fromInclusive &&
    binding.toExclusive === interval.toExclusive &&
    external.length === 1 &&
    external[0]?.recordId === binding.recordId &&
    external[0]?.revision === binding.revision
  );
}
