import type { JsonObject, JsonValue } from '@orot/model-runtime';
import type {
  EvidenceBatch,
  EvidenceItem,
  EvidenceReference,
  TaskResponderInput,
  TaskResultValidation,
} from '@orot/agent-runtime';
import type { DiseaseHypothesisAnalysis } from './types';

// Model output is accepted only when every citation resolves to this turn's current evidence batch.
const referenceSchema: JsonObject = {
  type: 'object',
  required: [
    'sourceKind',
    'sourceId',
    'sourceRevision',
    'evidenceId',
    'evidenceRevision',
    'locator',
    'effectiveTime',
    'reviewState',
  ],
  properties: {
    sourceKind: {
      enum: ['personal_record', 'reviewed_memory', 'external_medical'],
    },
    sourceId: { type: 'string' },
    sourceRevision: { type: 'string' },
    evidenceId: { type: 'string' },
    evidenceRevision: { type: 'string' },
    locator: {},
    effectiveTime: { type: ['string', 'null'] },
    reviewState: { enum: ['reviewed', 'unreviewed', 'unknown'] },
    unit: { type: 'string' },
  },
  additionalProperties: false,
};

export const diseaseHypothesisSchema: JsonObject = {
  type: 'object',
  required: [
    'title',
    'summary',
    'supportingEvidence',
    'contraryEvidence',
    'uncertainty',
    'missingData',
  ],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 },
    summary: { type: 'string', minLength: 1, maxLength: 1200 },
    supportingEvidence: { type: 'array', minItems: 1, items: referenceSchema },
    contraryEvidence: { type: 'array', items: referenceSchema },
    uncertainty: { type: 'string', minLength: 1, maxLength: 500 },
    missingData: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 160 },
    },
  },
  additionalProperties: false,
};

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

// Prompt wording is advisory, so reject common certainty claims before displaying model text.
const definitiveClaimPatterns = [
  /\b(?:confirmed|definitive(?:ly)?|definitely|certainly|unquestionably)\b/iu,
  /\b(?:you|the patient)\s+(?:(?:definitely|certainly)\s+)?(?:have|has)\b/iu,
  /\bdiagnosed with\b/iu,
  /\b(?:there is|there's)\s+no (?:clinical )?uncertainty\b/iu,
  /(?:확진|확실히|분명히|명백히|틀림없이|진단(?:받았|받으셨|되었|된|이다|입니다|이에요|이야))/u,
  /(?:불확실(?:성|한 점)(?:이)?|모호함)(?:은|는|이)?\s*(?:없|전혀 없)/u,
];

// Remove only these explicit disclaimers; any added diagnosis claim stays checked.
function withoutUncertaintyDisclaimers(text: string): string {
  return text
    .replace(/현재 자료만으로는 확진할 수 없어요\.?/gu, ' ')
    .replace(
      /\bno definitive diagnosis can be made from these records\.?/giu,
      ' ',
    );
}

function containsDefinitiveClinicalClaim(
  hypothesis: DiseaseHypothesisAnalysis['hypotheses'][number],
): boolean {
  return [
    hypothesis.title,
    hypothesis.summary,
    hypothesis.uncertainty,
    ...hypothesis.missingData,
  ].some(text =>
    definitiveClaimPatterns.some(pattern =>
      pattern.test(withoutUncertaintyDisclaimers(text)),
    ),
  );
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
): DiseaseHypothesisAnalysis['hypotheses'][number] | undefined {
  if (!isObject(value)) return undefined;
  const keys = [
    'title',
    'summary',
    'supportingEvidence',
    'contraryEvidence',
    'uncertainty',
    'missingData',
  ];
  if (Object.keys(value).some(key => !keys.includes(key))) return undefined;
  if (
    typeof value.title !== 'string' ||
    value.title.trim().length === 0 ||
    value.title.length > 120 ||
    typeof value.summary !== 'string' ||
    value.summary.trim().length === 0 ||
    value.summary.length > 1200 ||
    typeof value.uncertainty !== 'string' ||
    value.uncertainty.trim().length === 0 ||
    value.uncertainty.length > 500 ||
    !Array.isArray(value.missingData) ||
    value.missingData.some(
      item => typeof item !== 'string' || !item.trim() || item.length > 160,
    )
  )
    return undefined;
  const supportingEvidence = referencesFor(value.supportingEvidence, evidence);
  const contraryEvidence = referencesFor(value.contraryEvidence, evidence);
  if (!supportingEvidence?.length || !contraryEvidence) return undefined;
  const hypothesis = {
    title: value.title,
    summary: value.summary,
    supportingEvidence,
    contraryEvidence,
    uncertainty: value.uncertainty,
    missingData: value.missingData,
  };
  return containsDefinitiveClinicalClaim(hypothesis) ? undefined : hypothesis;
}

export function validateDiseaseHypothesisResult(
  value: JsonValue,
  input: TaskResponderInput,
): TaskResultValidation<DiseaseHypothesisAnalysis> {
  if (
    !isObject(value) ||
    Object.keys(value).some(key => key !== 'hypotheses')
  ) {
    return { status: 'invalid', reason: 'Expected a hypotheses array.' };
  }
  const hypotheses = value.hypotheses;
  if (
    !Array.isArray(hypotheses) ||
    hypotheses.length < 1 ||
    hypotheses.length > 3
  ) {
    return { status: 'invalid', reason: 'Expected one to three hypotheses.' };
  }
  const parsed = hypotheses.map(item => readHypothesis(item, input.evidence));
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
