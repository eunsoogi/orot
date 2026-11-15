import type { JsonValue } from '@orot/model-runtime';
import { t } from '../i18n';

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

// These UI explanations do not participate in wire decisions or appointment saves.
const reasons = {
  medical: t('medicalAppointments.classification.medical'),
  non_medical: t('medicalAppointments.classification.non_medical'),
  uncertain: t('medicalAppointments.classification.uncertain'),
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
