import { z } from 'zod';
import { TimestampSchema } from './common';

const NonEmptyTextSchema = z.string().trim().min(1);

export const SafetyPolicyCategorySchema = z.enum([
  'immediate_help',
  'prompt_clinician_contact',
  'measurement_data_verification',
  'visit_question_deferral',
  'insufficient_information',
  'no_triggered_action',
]);

export const SafetyPolicyActionSchema = z.enum([
  'seek_immediate_emergency_help',
  'seek_immediate_emergency_help_if_warning_signs_are_present',
  'contact_clinician_promptly',
  'recheck_measurement_after_60_seconds',
  'verify_measurement_data',
  'confirm_warning_symptoms',
  'record_both_readings',
  'defer_to_scheduled_visit',
  'provide_required_information',
]);

export const SafetyPolicyRuleSchema = z.strictObject({
  id: NonEmptyTextSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  source: z.url(),
  sourceReviewedAt: z.iso.date(),
  reviewedAt: z.iso.date(),
  applicability: NonEmptyTextSchema,
  requiredInputs: z.array(NonEmptyTextSchema).min(1),
  thresholds: z.strictObject({
    systolicAboveMmHg: z.number().int().positive(),
    diastolicAboveMmHg: z.number().int().positive(),
    repeatAfterSeconds: z.number().int().positive(),
  }),
});

export const SafetyPolicyDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  rules: z.array(SafetyPolicyRuleSchema).min(1),
});

export type SafetyPolicyDocument = z.infer<typeof SafetyPolicyDocumentSchema>;
export type SafetyPolicyRule = z.infer<typeof SafetyPolicyRuleSchema>;
export type SafetyPolicyAction = z.infer<typeof SafetyPolicyActionSchema>;
export type SafetyPolicyCategory = z.infer<typeof SafetyPolicyCategorySchema>;

type DeepReadonly<T> =
  T extends ReadonlyArray<infer U>
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    // Prevent a runtime caller from changing reviewed thresholds after validation.
    Object.values(value).forEach((entry) => deepFreeze(entry));
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

const policySource =
  'https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings/when-to-call-911-for-high-blood-pressure';

/** The first rule remains an explicit, reviewable data document instead of model prompt text. */
export const INITIAL_SAFETY_POLICY = deepFreeze(
  SafetyPolicyDocumentSchema.parse({
    schemaVersion: 1,
    version: '1.0.0',
    rules: [
      {
        id: 'adult-nonpregnant-severe-blood-pressure',
        version: '1.0.0',
        source: policySource,
        sourceReviewedAt: '2025-08-14',
        reviewedAt: '2026-10-27',
        applicability:
          'Current blood-pressure readings in mmHg for an adult known not to be pregnant; this rule does not assess historical readings, children, pregnancy, or emergencies outside this blood-pressure condition.',
        requiredInputs: [
          'Known adult, non-pregnant applicability',
          'Current blood-pressure reading in mmHg with time and source',
          'For persistent severe-range readings, a repeat taken at least 60 seconds later',
          'Explicit symptom confirmation for the listed warning signs and other new or concerning symptoms',
        ],
        thresholds: {
          systolicAboveMmHg: 180,
          diastolicAboveMmHg: 120,
          repeatAfterSeconds: 60,
        },
      },
    ],
  }),
);

export const SafetyWarningSignSchema = z.enum([
  'chest_pain',
  'shortness_of_breath',
  'back_pain',
  'numbness',
  'weakness',
  'vision_change',
  'difficulty_speaking',
]);

const BloodPressureReadingSchema = z
  .strictObject({
    systolicMmHg: z.number().finite().positive(),
    diastolicMmHg: z.number().finite().positive(),
    unit: z.literal('mmHg'),
    measuredAt: TimestampSchema,
    source: NonEmptyTextSchema,
  })
  .superRefine((reading, context) => {
    if (reading.systolicMmHg <= reading.diastolicMmHg) {
      context.addIssue({
        code: 'custom',
        path: ['systolicMmHg'],
        message: 'Systolic pressure must exceed diastolic pressure.',
      });
    }
  });

const SymptomAssessmentSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('warning_signs'),
    signs: z.array(SafetyWarningSignSchema).min(1),
  }),
  z.strictObject({ status: z.literal('no_new_or_concerning_symptoms') }),
  z.strictObject({ status: z.literal('unknown') }),
]);

export const SafetyPolicyInputSchema = z.strictObject({
  requestType: z.enum(['health_review', 'measurement_question', 'visit_question']).optional(),
  population: z.enum(['adult_not_pregnant', 'pregnant', 'child', 'unknown']).optional(),
  readingContext: z.enum(['current_measurement', 'historical', 'unknown']).optional(),
  readings: z.array(BloodPressureReadingSchema).max(2).optional(),
  symptomAssessment: SymptomAssessmentSchema.optional(),
  hasUpcomingVisit: z.boolean().optional(),
});

export const SafetyPolicyDecisionSchema = z.strictObject({
  policyVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  category: SafetyPolicyCategorySchema,
  matchedRuleIds: z.array(NonEmptyTextSchema),
  requiredActions: z.array(SafetyPolicyActionSchema),
  missingInputs: z.array(NonEmptyTextSchema),
});

export type SafetyPolicyInput = z.infer<typeof SafetyPolicyInputSchema>;
export type SafetyPolicyDecision = z.infer<typeof SafetyPolicyDecisionSchema>;
