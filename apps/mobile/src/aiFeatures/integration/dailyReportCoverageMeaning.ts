import type { DailyReportSourceCoverage } from '@orot/domain';

const ordinaryLimitations = new Set([
  'source_sync_unknown',
  'recorded_behavior_not_complete_history',
  'observed_days_not_complete_history',
  'ongoing_symptom_context',
  'confirmed_appointments_only',
  'planned_events_not_attendance',
]);

/** Display meaning only: absent sync metadata is not failure, and a bounded history
 * is not evidence of dropped records. Unknown/new limit codes stay conservative.
 * The protected source coverage, consent scope and original limitation codes never change. */
export function dailyReportCoverageMeaning(item: DailyReportSourceCoverage) {
  if (
    item.status === 'failed' ||
    item.limitationCodes.includes('source_query_failed')
  )
    return 'failed';
  if (
    item.status === 'stale' ||
    item.limitationCodes.includes('source_data_stale')
  )
    return 'stale';
  if (
    item.syncStatus === 'retryable' ||
    item.limitationCodes.some(code => !ordinaryLimitations.has(code))
  )
    return 'partial';
  const historical =
    item.source === 'personal_baseline' || item.source === 'behavior_history';
  const explicitScope = item.limitationCodes.includes(
    item.source === 'personal_baseline'
      ? 'observed_days_not_complete_history'
      : 'recorded_behavior_not_complete_history',
  );
  if (item.status === 'partial' && historical && explicitScope)
    return 'recorded_scope';
  return item.status;
}

/** Shared by legacy cards and conversation report text; never suppress a real limit/failure. */
export function isDailyReportCoverageWarning(item: DailyReportSourceCoverage) {
  return ['partial', 'stale', 'failed'].includes(
    dailyReportCoverageMeaning(item),
  );
}
