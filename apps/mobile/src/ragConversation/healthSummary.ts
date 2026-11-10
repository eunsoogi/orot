import type { DiseaseHypothesisAnalysis } from '../diseaseHypotheses/types';
import type { HealthContextWindow } from '../healthEvidence/healthContext/types';
import { parseHealthContextScope } from '../healthEvidence/healthContext/scope';

export interface HealthSummaryRequest {
  readonly question: string;
  readonly window?: HealthContextWindow;
}

/** A reference is presentation metadata, not proof that the summary exists. */
export interface HealthSummaryReference {
  readonly summaryId: string;
  readonly window: HealthContextWindow;
}

export interface HealthSummaryResult {
  readonly reference: HealthSummaryReference;
  readonly analysis: DiseaseHypothesisAnalysis;
}

/** Reject malformed or medication-only windows without inventing a replacement period. */
export function parseHealthSummaryWindow(
  value: unknown,
): HealthContextWindow | undefined {
  const scope = parseHealthContextScope({
    kind: 'health_context_period',
    version: 1,
    topic: 'medications',
    window: value,
  });
  return scope && !scope.window.doseHistory ? scope.window : undefined;
}

export function parseHealthSummaryReference(
  value: unknown,
): HealthSummaryReference | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  const window = parseHealthSummaryWindow(record.window);
  if (
    Object.keys(record).some(key => !['summaryId', 'window'].includes(key)) ||
    typeof record.summaryId !== 'string' ||
    !record.summaryId ||
    record.summaryId.length > 256 ||
    !window
  )
    return undefined;
  return { summaryId: record.summaryId, window };
}
