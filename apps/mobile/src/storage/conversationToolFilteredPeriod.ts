import type { EvidenceReference } from '@orot/agent-runtime';
import type { SqlExecutor } from '@orot/storage';
import type { HealthContextScope } from '../healthEvidence/healthContext/scope';
import { healthContextRevision } from '../healthEvidence/healthContext/scope';
import type {
  HealthContextReport,
  HealthContextWindow,
} from '../healthEvidence/healthContext/types';
import { readHealthContextReport } from '../healthEvidence/healthContext/reader';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import { assertPeriodNotRemoved } from './conversationPeriodRemoval';
import {
  findToolMedicationAnchor,
  readToolMedicationAnchor,
} from './conversationToolMedicationAnchor';

export interface FilteredToolPeriod {
  readonly kind: 'filtered_medication_period';
  readonly reference: EvidenceReference;
  readonly scope: HealthContextScope;
  readonly anchorKey: string | null;
  readonly revision: string;
  readonly mutationGeneration: number;
  readonly deletionGeneration: number;
}

/** Keep period and page, while excluding the model-provided medication name. */
function redactedWindow(window: HealthContextWindow): HealthContextWindow {
  const selection = window.doseHistory;
  if (!selection) throw new Error('Filtered medication period is invalid.');
  return {
    fromInclusive: window.fromInclusive,
    toExclusive: window.toExclusive,
    timeZone: window.timeZone,
    doseHistory: { page: selection.page, pageSize: selection.pageSize },
  };
}

function reportRevision(report: HealthContextReport): string {
  return fingerprint({
    window: redactedWindow(report.window),
    days: report.days,
    quantities: report.quantities,
    medications: report.medications,
    doseHistory: report.doseHistory,
    sleep: report.sleep,
    symptoms: report.symptoms,
    limitations: report.limitations,
  });
}

/** Validate the original source in the transaction, then retain only a record identity and redacted snapshot. */
export async function captureFilteredToolPeriod(
  tx: SqlExecutor,
  reference: EvidenceReference,
  scope: HealthContextScope,
  report: HealthContextReport,
): Promise<FilteredToolPeriod> {
  const filter = scope.window.doseHistory?.medicationName;
  if (
    scope.topic !== 'medications' ||
    reference.sourceKind !== 'personal_record' ||
    !filter
  )
    throw new Error('Filtered medication period is invalid.');
  const revision = healthContextRevision(scope, report);
  if (
    reference.sourceRevision !== revision ||
    reference.evidenceRevision !== revision
  )
    throw new RetainedSourceInvalidError('The tool source identity changed.');
  await assertPeriodNotRemoved(tx, {
    kind: 'health_context_period',
    reference,
    scope,
    revision: '',
    deletionGeneration: report.deletionGeneration,
  });
  const current = await readHealthContextReport(tx, scope.window, [
    'medications',
  ]);
  if (
    current.mutationGeneration !== report.mutationGeneration ||
    current.deletionGeneration !== report.deletionGeneration ||
    healthContextRevision(scope, current) !== revision
  )
    throw new RetainedSourceInvalidError(
      'The tool source changed before saving.',
    );
  const projected = {
    sourceKind: reference.sourceKind,
    sourceId: reference.sourceId,
    sourceRevision: reference.sourceRevision,
    evidenceId: reference.evidenceId,
    evidenceRevision: reference.evidenceRevision,
    locator: null,
    effectiveTime: null,
    reviewState: 'unknown' as const,
  };
  return {
    kind: 'filtered_medication_period',
    reference: projected,
    scope: {
      kind: 'health_context_period',
      version: 1,
      topic: 'medications',
      window: redactedWindow(scope.window),
    },
    anchorKey: await findToolMedicationAnchor(tx, scope.window, filter),
    revision: reportRevision(current),
    mutationGeneration: current.mutationGeneration,
    deletionGeneration: current.deletionGeneration,
  };
}

/** Rebuild the same selected result without recovering the discarded model input. */
export async function readFilteredToolPeriod(
  tx: SqlExecutor,
  source: FilteredToolPeriod,
  requireGeneration: boolean,
) {
  await assertPeriodNotRemoved(tx, {
    kind: 'health_context_period',
    reference: source.reference,
    scope: source.scope,
    revision: '',
    deletionGeneration: source.deletionGeneration,
  });
  let filter = source.anchorKey
    ? await readToolMedicationAnchor(tx, source.scope.window, source.anchorKey)
    : null;
  if (source.anchorKey && !filter)
    throw new RetainedSourceInvalidError('The tool source was removed.');
  if (!filter) {
    filter = '__orot_unmatched_filter__';
    for (
      let index = 0;
      await findToolMedicationAnchor(tx, source.scope.window, filter);
      index++
    ) {
      if (index >= 8)
        throw new Error('Cannot verify empty medication selection.');
      filter = `__orot_unmatched_filter_${index}__`;
    }
  }
  const window = {
    ...source.scope.window,
    doseHistory: {
      ...source.scope.window.doseHistory!,
      medicationName: filter,
    },
  };
  const report = await readHealthContextReport(tx, window, ['medications']);
  if (
    (requireGeneration &&
      (report.mutationGeneration !== source.mutationGeneration ||
        report.deletionGeneration !== source.deletionGeneration)) ||
    reportRevision(report) !== source.revision
  )
    throw new RetainedSourceInvalidError('The tool source changed.');
  return {
    scope: source.scope,
    report: { ...report, window: redactedWindow(report.window) },
    filterRedacted: true as const,
  };
}
