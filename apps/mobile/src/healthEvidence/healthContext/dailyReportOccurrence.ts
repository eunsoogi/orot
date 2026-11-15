import { compareTimestamps } from '@orot/domain';
import type { DailyReportSourceRecord } from '@orot/domain';
import type { LocalHealthEvidenceRecord } from '../localEvidenceQueries';
import type { DailyReportCalendarWindow } from './dailyReportWindow';

/** Preserve original onset/resolution. An old active status is recorded context,
 * not a new measurement or proof the person is still experiencing the symptom.
 * Legacy rows with no explicit status do not gain the open-ended exception. */
export function dailyReportOccurrence(
  value: LocalHealthEvidenceRecord,
  payload: Record<string, unknown>,
  calendar: DailyReportCalendarWindow,
): Pick<DailyReportSourceRecord, 'occurrence' | 'contextRole'> | null {
  const symptom = value.kind === 'symptom_entry';
  const start =
    symptom && typeof payload.startedAt === 'string'
      ? payload.startedAt
      : value.record.effectiveAt;
  if (typeof start !== 'string')
    throw new Error('Daily report record lacks onset.');
  const end = symptom ? payload.resolvedAt : payload.endedAt;
  if (
    typeof end === 'string' &&
    compareTimestamps(end, calendar.effectiveCutoff) > 0
  )
    return null;
  const ongoing =
    symptom &&
    payload.status === 'active' &&
    !end &&
    compareTimestamps(start, calendar.interval.fromInclusive) < 0;
  return {
    occurrence: {
      startInclusive: start,
      ...(typeof end === 'string' && compareTimestamps(end, start) > 0
        ? { endExclusive: end }
        : {}),
    },
    ...(ongoing ? { contextRole: 'ongoing_symptom' as const } : {}),
  };
}
