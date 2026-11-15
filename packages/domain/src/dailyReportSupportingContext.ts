import { compareTimestamps } from './common';

/** Linked medication metadata supplies identity, not a new same-day observation.
 * Every binding must point to an admitted dose; generic historical records and
 * future metadata cannot use this exception to bypass report time boundaries. */
export function validDailyReportSupportingContext(
  record: {
    source: string;
    supportingRecordFor?: readonly string[];
    occurrence: { startInclusive: string };
    ingestedAt: string;
  },
  records: readonly { source: string; recordId: string }[],
  cutoff: string,
): boolean {
  const ids = record.supportingRecordFor;
  return Boolean(
    ids?.length &&
    ['medication_definition', 'medication_assertion'].includes(record.source) &&
    new Set(ids).size === ids.length &&
    ids.every((id) =>
      records.some((item) => item.source === 'dose_event' && item.recordId === id),
    ) &&
    compareTimestamps(record.occurrence.startInclusive, cutoff) <= 0 &&
    compareTimestamps(record.ingestedAt, cutoff) <= 0,
  );
}
