import type { JsonValue } from '@orot/model-runtime';

export const classificationDecisions = [
  'medical_low',
  'medical_medium',
  'medical_high',
  'non_medical_low',
  'non_medical_medium',
  'non_medical_high',
  'uncertain_low',
  'uncertain_medium',
  'uncertain_high',
] as const;

const reasons = {
  medical: '의료 방문·검사 일정',
  non_medical: '일반 생활 일정',
  uncertain: '제목만으로 판단 어려움',
};

/** Expands the bounded wire decision; the model need not regenerate fixed UI explanations. */
export function expandClassificationDecisions(value: JsonValue): JsonValue {
  if (!isObject(value) || !Array.isArray(value.classifications)) return value;
  return {
    classifications: value.classifications.map(item => {
      if (
        !isObject(item) ||
        Object.keys(item).length !== 2 ||
        typeof item.candidateId !== 'string' ||
        typeof item.decision !== 'string' ||
        !classificationDecisions.some(decision => decision === item.decision)
      )
        return null;
      // Split only a validated enum; non_medical contains an underscore of its own.
      const boundary = item.decision.lastIndexOf('_');
      const classification = item.decision.slice(
        0,
        boundary,
      ) as keyof typeof reasons;
      return {
        candidateId: item.candidateId,
        classification,
        uncertainty: item.decision.slice(boundary + 1),
        reason: reasons[classification],
      };
    }),
  };
}

function isObject(
  value: JsonValue,
): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
