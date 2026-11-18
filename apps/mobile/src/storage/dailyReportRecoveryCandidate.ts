import type { DailyReportSave } from './dailyReportStorageTypes';
import {
  validateDailyReportSave,
  parseDailyReportLineage,
} from './dailyReportLineage';

// Matches the original record families produced by dailyReportSnapshot/history/medication context.
// Derived-memory or arbitrary artifact ancestry is deliberately not a recovery authority.
export const dailyRecoveryKinds = new Set([
  'health_observation',
  'symptom_entry',
  'dose_event',
  'appointment',
  'medication_definition',
  'medication_assertion',
]);
export function parseDailyRecoveryCandidate(
  value: unknown,
): DailyReportSave | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<DailyReportSave>;
  if (
    typeof row.runId !== 'string' ||
    !row.mode ||
    (row.mode.kind !== 'initial' &&
      (row.mode.kind !== 'revise' ||
        !(
          row.mode.expectedRunId === null ||
          typeof row.mode.expectedRunId === 'string'
        ))) ||
    !Array.isArray(row.lineage)
  )
    return null;
  try {
    const checked = validateDailyReportSave(row as DailyReportSave);
    if (
      !checked ||
      row.lineage.some(item => !dailyRecoveryKinds.has(item.kind))
    )
      return null;
    const lineage = parseDailyReportLineage(checked.context, row.lineage);
    if (!lineage) return null;
    // Persist normalized validator output only; unknown/raw fields are never copied.
    return {
      runId: row.runId,
      context: checked.context,
      result: { status: 'completed', report: checked.report },
      lineage,
      mode:
        row.mode.kind === 'initial'
          ? { kind: 'initial' }
          : { kind: 'revise', expectedRunId: row.mode.expectedRunId },
    };
  } catch {
    return null;
  }
}
