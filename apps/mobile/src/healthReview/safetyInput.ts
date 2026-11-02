import { SafetyPolicyInputSchema } from '@orot/domain';
import type { SafetyPolicyInput } from '@orot/domain';

type HealthReviewWarningSign = Extract<
  SafetyPolicyInput['symptomAssessment'],
  { status: 'warning_signs' }
>['signs'][number];

/** The form keeps its fixed safety inputs separate from future free-text symptom narratives. */
export interface HealthReviewSafetyDraft {
  population: NonNullable<SafetyPolicyInput['population']>;
  symptoms: 'unknown' | 'no_new_or_concerning_symptoms' | 'warning_signs';
  signs: HealthReviewWarningSign[];
  upcomingVisit: 'unknown' | 'yes' | 'no';
}
export const emptyHealthReviewSafety = (): HealthReviewSafetyDraft => ({
  population: 'unknown',
  symptoms: 'unknown',
  signs: [],
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
      draft.symptoms === 'warning_signs'
        ? { status: draft.symptoms, signs: draft.signs }
        : { status: draft.symptoms },
    ...(draft.upcomingVisit === 'unknown'
      ? {}
      : { hasUpcomingVisit: draft.upcomingVisit === 'yes' }),
  });
}
