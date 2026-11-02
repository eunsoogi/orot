import { SafetyPolicyInputSchema } from '@orot/domain';
import type { SafetyPolicyInput } from '@orot/domain';

type HealthReviewWarningSign = Extract<
  SafetyPolicyInput['symptomAssessment'],
  { status: 'warning_signs' }
>['signs'][number];

/** Free text remains app-owned and never becomes a policy symptom enum. */
export interface HealthReviewSafetyDraft {
  population: NonNullable<SafetyPolicyInput['population']>;
  symptoms: 'unknown' | 'no_new_or_concerning_symptoms' | 'warning_signs';
  signs: HealthReviewWarningSign[];
  otherSelected?: boolean;
  otherText?: string;
  upcomingVisit: 'unknown' | 'yes' | 'no';
}
export const emptyHealthReviewSafety = (): HealthReviewSafetyDraft => ({
  population: 'unknown',
  symptoms: 'unknown',
  signs: [],
  otherSelected: false,
  otherText: '',
  upcomingVisit: 'unknown',
});

/** This form authors no pressure reading or currentness claim; timestamps alone cannot establish current context. */
export function healthReviewSafetyInput(
  draft: HealthReviewSafetyDraft,
): SafetyPolicyInput {
  return SafetyPolicyInputSchema.parse({
    requestType: 'health_review',
    population: draft.population,
    readingContext: 'unknown',
    symptomAssessment:
      draft.symptoms === 'warning_signs' && draft.signs.length > 0
        ? { status: draft.symptoms, signs: draft.signs }
        : {
            status:
              draft.symptoms === 'warning_signs' ? 'unknown' : draft.symptoms,
          },
    ...(draft.upcomingVisit === 'unknown'
      ? {}
      : { hasUpcomingVisit: draft.upcomingVisit === 'yes' }),
  });
}

/** Validation does not participate in the deterministic warning assessment. */
export function validHealthReviewOther(
  draft: HealthReviewSafetyDraft,
): boolean {
  if (
    draft.symptoms === 'warning_signs' &&
    !draft.signs.length &&
    !draft.otherSelected
  )
    return false;
  if (draft.symptoms !== 'warning_signs' || !draft.otherSelected) return true;
  const text = draft.otherText ?? '';
  return text.trim().length > 0 && text.length <= 1000;
}
