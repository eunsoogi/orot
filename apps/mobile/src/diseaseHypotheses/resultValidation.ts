import type { JsonValue } from '@orot/model-runtime';
import type {
  EvidenceBatch,
  EvidenceItem,
  EvidenceReference,
  TaskResponderInput,
  TaskResultValidation,
} from '@orot/agent-runtime';
import type { DiseaseHypothesisAnalysis } from './types';
import {
  clinicalClaimIssue,
  type ClinicalClaimIssue,
} from './clinicalClaimGuard';
export { canPreviewDiseaseHypothesisSummary } from './clinicalClaimGuard';

export { diseaseHypothesisSchema } from './diseaseResultSchema';

/** Closed categories identify validation boundaries without exposing model or record content. */
export type DiseaseValidationCode =
  'fields' | 'citations' | 'certainty' | 'section_count';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object')
    return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      key =>
        `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`,
    )
    .join(',')}}`;
}

export function referenceOnly(item: EvidenceItem): EvidenceReference {
  const {
    sourceKind,
    sourceId,
    sourceRevision,
    evidenceId,
    evidenceRevision,
    locator,
    effectiveTime,
    unit,
    reviewState,
  } = item;
  return {
    sourceKind,
    sourceId,
    sourceRevision,
    evidenceId,
    evidenceRevision,
    locator,
    effectiveTime,
    ...(unit === undefined ? {} : { unit }),
    reviewState,
  };
}

function referenceFor(
  value: unknown,
  evidence: EvidenceBatch,
): EvidenceReference | undefined {
  if (typeof value === 'string') {
    const matches = evidence.items.filter(item => item.evidenceId === value);
    return matches.length === 1 ? referenceOnly(matches[0]!) : undefined;
  }
  if (!isObject(value)) return undefined;
  const serialized = stableJson(value);
  const match = evidence.items.find(
    item => stableJson(referenceOnly(item)) === serialized,
  );
  // Do not copy evidence content into result citations or source-navigation payloads.
  return match ? referenceOnly(match) : undefined;
}

function referencesFor(
  value: unknown,
  evidence: EvidenceBatch,
): readonly EvidenceReference[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const references = value.map(item => referenceFor(item, evidence));
  if (references.some(reference => !reference)) return undefined;
  const resolved = references as EvidenceReference[];
  return new Set(resolved.map(stableJson)).size === resolved.length
    ? resolved
    : undefined;
}

function readHypothesis(
  value: unknown,
  evidence: EvidenceBatch,
  allowEmptyUncertainty = false,
  onInvalid?: (code: DiseaseValidationCode) => void,
  onClinicalClaim?: (issue: ClinicalClaimIssue) => void,
): DiseaseHypothesisAnalysis['hypotheses'][number] | undefined {
  if (!isObject(value)) {
    onInvalid?.('fields');
    return undefined;
  }
  const keys = [
    'title',
    'summary',
    'supportingEvidence',
    'contraryEvidence',
    'uncertainty',
    'missingData',
  ];
  if (Object.keys(value).some(key => !keys.includes(key))) {
    onInvalid?.('fields');
    return undefined;
  }
  if (
    typeof value.title !== 'string' ||
    value.title.trim().length === 0 ||
    value.title.length > 120 ||
    typeof value.summary !== 'string' ||
    value.summary.trim().length === 0 ||
    value.summary.length > 1200 ||
    typeof value.uncertainty !== 'string' ||
    (!allowEmptyUncertainty && value.uncertainty.trim().length === 0) ||
    value.uncertainty.length > 500 ||
    !Array.isArray(value.missingData) ||
    value.missingData.some(
      item => typeof item !== 'string' || !item.trim() || item.length > 160,
    )
  ) {
    onInvalid?.('fields');
    return undefined;
  }
  const supportingEvidence = referencesFor(value.supportingEvidence, evidence);
  const contraryEvidence = referencesFor(value.contraryEvidence, evidence);
  if (!supportingEvidence?.length || !contraryEvidence) {
    onInvalid?.('citations');
    return undefined;
  }
  const hypothesis = {
    title: value.title,
    summary: value.summary,
    supportingEvidence,
    contraryEvidence,
    uncertainty: value.uncertainty,
    missingData: value.missingData,
  };
  const claimIssue = clinicalClaimIssue(hypothesis);
  if (claimIssue) {
    onInvalid?.('certainty');
    onClinicalClaim?.(claimIssue);
    return undefined;
  }
  return hypothesis;
}

export function validateDiseaseHypothesisResult(
  value: JsonValue,
  input: TaskResponderInput,
  options: {
    readonly allowEmptyUncertainty?: boolean;
    // Factual topic summaries may use eight sections; disease assessment keeps the default of three.
    readonly maxSections?: 3 | 8;
    readonly onInvalid?: (code: DiseaseValidationCode) => void;
    readonly onClinicalClaim?: (issue: ClinicalClaimIssue) => void;
  } = {},
): TaskResultValidation<DiseaseHypothesisAnalysis> {
  if (
    !isObject(value) ||
    Object.keys(value).some(key => key !== 'hypotheses')
  ) {
    options.onInvalid?.('fields');
    return { status: 'invalid', reason: 'Expected a hypotheses array.' };
  }
  const hypotheses = value.hypotheses;
  if (
    !Array.isArray(hypotheses) ||
    hypotheses.length < 1 ||
    hypotheses.length > (options.maxSections ?? 3)
  ) {
    options.onInvalid?.('section_count');
    return {
      status: 'invalid',
      reason: 'Expected a bounded non-empty sections array.',
    };
  }
  const parsed = hypotheses.map(item =>
    readHypothesis(
      item,
      input.evidence,
      options.allowEmptyUncertainty,
      options.onInvalid,
      options.onClinicalClaim,
    ),
  );
  if (parsed.some(item => !item)) {
    return {
      status: 'invalid',
      reason: 'A hypothesis had unsupported or incomplete citations.',
    };
  }
  return {
    status: 'valid',
    value: { hypotheses: parsed as DiseaseHypothesisAnalysis['hypotheses'] },
  };
}

export function containsEvidenceReference(
  available: readonly EvidenceReference[],
  target: EvidenceReference,
): boolean {
  return available.some(
    reference => stableJson(reference) === stableJson(target),
  );
}
