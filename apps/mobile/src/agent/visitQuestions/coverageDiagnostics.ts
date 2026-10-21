import { providerDiagnostic } from '../../providers/diagnostics';
import type { VisitQuestionEvidenceBatch } from './taskContract';

const knownGaps = {
  'Local reviewed memory was unavailable for this search.':
    'task_coverage_memory',
  unsupported_sleep_categories_excluded_from_duration: 'task_coverage_sleep',
  quantity_sensor_series_limit_reached: 'task_coverage_reader_limit',
  medication_catalog_limit_reached: 'task_coverage_reader_limit',
  period_detail_exceeds_payload_limit_choose_fewer_topics_or_summary:
    'task_coverage_payload',
  topic_result_limit_reached: 'task_coverage_topic_limit',
} as const;

/** Observe coverage gates without logging source IDs, counts, private gap text or changing acceptance. */
export function reportVisitQuestionCoverage(batch: VisitQuestionEvidenceBatch) {
  const codes = new Set<
    | (typeof knownGaps)[keyof typeof knownGaps]
    | 'task_coverage_gap'
    | 'task_coverage_empty'
    | 'task_coverage_conflict'
    | 'task_coverage_truncated'
  >();
  if (!batch.items.length || !batch.coverage.length)
    codes.add('task_coverage_empty');
  if (batch.conflicts.length) codes.add('task_coverage_conflict');
  for (const coverage of batch.coverage) {
    if (coverage.truncated) codes.add('task_coverage_truncated');
    if (coverage.gaps.length) codes.add('task_coverage_gap');
    for (const gap of coverage.gaps) {
      if (Object.hasOwn(knownGaps, gap))
        codes.add(knownGaps[gap as keyof typeof knownGaps]);
    }
  }
  for (const code of codes) providerDiagnostic('visit', 'validation', code);
}
