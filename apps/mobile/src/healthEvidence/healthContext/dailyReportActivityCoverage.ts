import type { DailyReportSourceCoverage } from '@orot/domain';
import type { LocalHealthEvidenceRecord } from '../localEvidenceQueries';

/** A completed local observation query can prove an empty record set, not
 * device synchronization or real-world inactivity. Candidate workout rows
 * suppress zero even if their legacy activity metadata is incomplete. */
export function emptyDailyActivityCoverage(
  values: readonly LocalHealthEvidenceRecord[],
  lastSuccessfulAt: string,
): DailyReportSourceCoverage[] {
  const concepts = new Set(
    values.flatMap(item =>
      item.kind === 'health_observation' ? [item.record.concept] : [],
    ),
  );
  const sources = [
    ...(!concepts.has('workout_duration') ? ['local_workout_records'] : []),
    ...(!concepts.has('sleep') &&
    !concepts.has('HKCategoryTypeIdentifierSleepAnalysis')
      ? ['local_sleep_records']
      : []),
  ];
  return sources.map(source => ({
    source,
    status: 'empty',
    lastSuccessfulAt,
    limitationCodes: [],
  }));
}
