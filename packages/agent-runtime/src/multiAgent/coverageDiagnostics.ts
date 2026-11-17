import type { EvidenceBatch, TaskResponderContract } from './contracts';
import { hasBlockingCoverage } from './coveragePolicy';

/** Closed structural tokens only. No source identities, values, counts or raw gaps leave this boundary. */
const gapCodes = {
  topic_result_limit_reached: 'coverage_gap_topic_limit',
  period_detail_exceeds_payload_limit_choose_fewer_topics_or_summary: 'coverage_gap_payload',
  period_context_requires_unrestricted_personal_record_scope_use_scoped_raw_search:
    'coverage_gap_scope',
  quantity_sensor_series_limit_reached: 'coverage_gap_reader_limit',
  medication_catalog_limit_reached: 'coverage_gap_reader_limit',
  unsupported_sleep_categories_excluded_from_duration: 'coverage_gap_sleep',
  'Local reviewed memory was unavailable for this search.': 'coverage_gap_memory',
  '일부 로컬 기억을 안전하게 확인할 수 없어 검색에서 제외했어요.': 'coverage_gap_memory',
  'Public web search timed out; no external evidence was retrieved.': 'coverage_gap_web_timeout',
  'Public web search was unavailable offline; no external evidence was retrieved.':
    'coverage_gap_web_offline',
  'Public web search was unavailable; no external evidence was retrieved.':
    'coverage_gap_web_unavailable',
} as const;
const sourceCodes = {
  personal_record: 'coverage_personal',
  reviewed_memory: 'coverage_memory',
  generated_artifact: 'coverage_artifact',
  external_medical: 'coverage_external',
} as const;
type SourceCode = (typeof sourceCodes)[keyof typeof sourceCodes];
export type CoverageDiagnosticCode =
  | 'coverage_empty_items'
  | 'coverage_empty_scope'
  | 'coverage_conflict'
  | 'coverage_gap_other'
  | (typeof gapCodes)[keyof typeof gapCodes]
  | `${SourceCode}_${'gap' | 'truncated_blocking' | 'truncated_allowed' | 'ranked' | 'paged' | 'unspecified'}`;
export type CoverageDiagnosticObserver = (code: CoverageDiagnosticCode) => void;

/** Observes an already-blocked result. The existing policy decides which truncations are allowed. */
export function reportCoverageDiagnostics(
  batch: EvidenceBatch,
  task: Pick<
    TaskResponderContract<unknown>,
    'allowBoundedExternalEvidence' | 'allowRankedLocalEvidence' | 'allowPagedGeneratedArtifacts'
  >,
  observer?: CoverageDiagnosticObserver,
): void {
  if (!observer) return;
  const codes = new Set<CoverageDiagnosticCode>();
  if (!batch.items.length) codes.add('coverage_empty_items');
  if (!batch.coverage.length) codes.add('coverage_empty_scope');
  if (batch.conflicts.length) codes.add('coverage_conflict');
  for (const coverage of batch.coverage) {
    const source = sourceCodes[coverage.sourceKind];
    codes.add(
      `${source}_${coverage.selectionMethod === 'ranked_retrieval' ? 'ranked' : coverage.selectionMethod === 'paged_retrieval' ? 'paged' : 'unspecified'}`,
    );
    if (coverage.gaps.length) codes.add(`${source}_gap`);
    for (const gap of coverage.gaps) {
      codes.add(
        Object.prototype.hasOwnProperty.call(gapCodes, gap)
          ? gapCodes[gap as keyof typeof gapCodes]
          : 'coverage_gap_other',
      );
    }
    if (coverage.truncated) {
      // Strip gaps/conflicts for this diagnostic-only question; never change the actual batch.
      const blocked = hasBlockingCoverage(
        {
          items: batch.items.length ? batch.items : [{} as EvidenceBatch['items'][number]],
          coverage: [{ ...coverage, gaps: [] }],
          conflicts: [],
        },
        task.allowBoundedExternalEvidence,
        task.allowRankedLocalEvidence,
        task.allowPagedGeneratedArtifacts,
      );
      codes.add(`${source}_${blocked ? 'truncated_blocking' : 'truncated_allowed'}`);
    }
  }
  for (const code of codes) {
    try {
      observer(code);
    } catch {
      /* Diagnostics cannot change the terminal result. */
    }
  }
}
