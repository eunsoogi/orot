import { SafetyPolicyInputSchema } from '@orot/domain';
import type { SafetyPolicyInput } from '@orot/domain';

export interface SafetyReadingDraft {
  systolic: string;
  diastolic: string;
  measuredAt: string;
  source: string;
}
export interface HealthReviewSafetyDraft {
  population: NonNullable<SafetyPolicyInput['population']>;
  readingContext: NonNullable<SafetyPolicyInput['readingContext']>;
  symptoms: 'unknown' | 'no_new_or_concerning_symptoms' | 'warning_signs';
  signs: string[];
  upcomingVisit: 'unknown' | 'yes' | 'no';
  readings: SafetyReadingDraft[];
}
export const emptySafetyReading = (): SafetyReadingDraft => ({
  systolic: '',
  diastolic: '',
  measuredAt: '',
  source: '',
});
export const emptyHealthReviewSafety = (): HealthReviewSafetyDraft => ({
  population: 'unknown',
  readingContext: 'unknown',
  symptoms: 'unknown',
  signs: [],
  upcomingVisit: 'unknown',
  readings: [emptySafetyReading()],
});

/** Omitted readings stay absent. Partial input is an error instead of a fabricated normal measurement. */
export function healthReviewSafetyInput(
  draft: HealthReviewSafetyDraft,
): SafetyPolicyInput {
  const readings = draft.readings
    .filter(row => Object.values(row).some(value => value.trim()))
    .map(row => ({
      systolicMmHg: row.systolic.trim() ? Number(row.systolic) : NaN,
      diastolicMmHg: row.diastolic.trim() ? Number(row.diastolic) : NaN,
      unit: 'mmHg',
      measuredAt: row.measuredAt.trim(),
      source: row.source.trim(),
    }));
  return SafetyPolicyInputSchema.parse({
    requestType: 'health_review',
    population: draft.population,
    readingContext: draft.readingContext,
    ...(readings.length ? { readings } : {}),
    symptomAssessment:
      draft.symptoms === 'warning_signs'
        ? { status: draft.symptoms, signs: draft.signs }
        : { status: draft.symptoms },
    ...(draft.upcomingVisit === 'unknown'
      ? {}
      : { hasUpcomingVisit: draft.upcomingVisit === 'yes' }),
  });
}
