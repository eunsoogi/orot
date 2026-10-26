import { compareTimestamps } from './common';
import {
  INITIAL_SAFETY_POLICY,
  SafetyPolicyDecisionSchema,
  SafetyPolicyInputSchema,
} from './safetyPolicySchemas';
import type {
  SafetyPolicyAction,
  SafetyPolicyCategory,
  SafetyPolicyDecision,
  SafetyPolicyInput,
} from './safetyPolicySchemas';

const severeBloodPressureRule = INITIAL_SAFETY_POLICY.rules[0]!;

function decision(
  category: SafetyPolicyCategory,
  requiredActions: SafetyPolicyAction[] = [],
  missingInputs: string[] = [],
  matchedRule = false,
): SafetyPolicyDecision {
  return SafetyPolicyDecisionSchema.parse({
    policyVersion: INITIAL_SAFETY_POLICY.version,
    category,
    matchedRuleIds: matchedRule ? [severeBloodPressureRule.id] : [],
    requiredActions,
    missingInputs,
  });
}

type SafetyPolicyReading = NonNullable<SafetyPolicyInput['readings']>[number];

function isSevereRange(reading: SafetyPolicyReading): boolean {
  return (
    reading.systolicMmHg > severeBloodPressureRule.thresholds.systolicAboveMmHg ||
    reading.diastolicMmHg > severeBloodPressureRule.thresholds.diastolicAboveMmHg
  );
}

function isVisitQuestion(input: SafetyPolicyInput): boolean {
  return input.requestType === 'visit_question';
}

function deferOrRequestVisit(
  input: SafetyPolicyInput,
  hasCurrentReading = false,
): SafetyPolicyDecision {
  if (input.symptomAssessment?.status !== 'no_new_or_concerning_symptoms') {
    return decision(
      'insufficient_information',
      ['provide_required_information'],
      ['explicit_symptom_assessment'],
    );
  }
  if (isVisitQuestion(input) && input.hasUpcomingVisit === true) {
    return decision('visit_question_deferral', ['defer_to_scheduled_visit']);
  }
  if (isVisitQuestion(input)) {
    return decision(
      'insufficient_information',
      ['provide_required_information'],
      ['scheduled_visit'],
    );
  }
  return hasCurrentReading
    ? decision('no_triggered_action')
    : decision(
        'insufficient_information',
        ['provide_required_information'],
        ['blood_pressure_reading'],
      );
}

function orderedReadings(readings: SafetyPolicyReading[]): SafetyPolicyReading[] {
  return [...readings].sort((left, right) => compareTimestamps(left.measuredAt, right.measuredAt));
}

function hasPersistentSevereReadings(readings: SafetyPolicyReading[]): boolean {
  const ordered = orderedReadings(readings);
  const minimumRepeatIntervalMs = severeBloodPressureRule.thresholds.repeatAfterSeconds * 1000;

  // A prior normal or early reading cannot satisfy the persistent severe-reading condition.
  return (
    ordered.length === 2 &&
    isSevereRange(ordered[0]!) &&
    isSevereRange(ordered[1]!) &&
    Date.parse(ordered[1]!.measuredAt) - Date.parse(ordered[0]!.measuredAt) >=
      minimumRepeatIntervalMs
  );
}

function rejectedInput(input: unknown): SafetyPolicyDecision {
  const hasReadings = typeof input === 'object' && input !== null && 'readings' in input;
  return hasReadings
    ? decision(
        'measurement_data_verification',
        ['verify_measurement_data'],
        ['valid_mmHg_reading_with_time_and_source'],
      )
    : decision('insufficient_information', ['provide_required_information'], ['safety_context']);
}

/** Applies the reviewed local rule before any model explanation is added. */
export class SafetyPolicyEngine {
  evaluate(value: unknown): SafetyPolicyDecision {
    const parsed = SafetyPolicyInputSchema.safeParse(value);
    if (!parsed.success) return rejectedInput(value);

    const input = parsed.data;
    if (!input.readings?.length) return deferOrRequestVisit(input);

    const severeReadings = input.readings.filter(isSevereRange);
    if (input.population !== 'adult_not_pregnant') {
      return decision(
        'insufficient_information',
        severeReadings.length
          ? ['contact_clinician_promptly', 'provide_required_information']
          : ['provide_required_information'],
        ['adult_non_pregnant_applicability'],
      );
    }
    if (input.readingContext !== 'current_measurement') {
      return decision(
        'insufficient_information',
        ['provide_required_information'],
        ['current_measurement_context'],
      );
    }

    if (!severeReadings.length) return deferOrRequestVisit(input, true);

    if (input.symptomAssessment?.status === 'warning_signs') {
      return decision('immediate_help', ['seek_immediate_emergency_help'], [], true);
    }
    if (!input.symptomAssessment || input.symptomAssessment.status === 'unknown') {
      return decision(
        'insufficient_information',
        [
          ...(hasPersistentSevereReadings(input.readings)
            ? ['contact_clinician_promptly' as const]
            : []),
          'confirm_warning_symptoms',
          'seek_immediate_emergency_help_if_warning_signs_are_present',
        ],
        ['explicit_symptom_assessment'],
        true,
      );
    }

    const ordered = orderedReadings(input.readings);
    if (!isSevereRange(ordered[input.readings.length - 1]!)) {
      return decision('measurement_data_verification', ['record_both_readings'], [], true);
    }

    if (!hasPersistentSevereReadings(input.readings)) {
      return decision(
        'measurement_data_verification',
        ['recheck_measurement_after_60_seconds'],
        [],
        true,
      );
    }

    return decision('prompt_clinician_contact', ['contact_clinician_promptly'], [], true);
  }
}

/** Keeps local actions and classification authoritative when adding generated explanation. */
export function preserveSafetyPolicyActions<
  T extends {
    category?: SafetyPolicyCategory;
    requiredActions?: readonly SafetyPolicyAction[];
  },
>(
  policyDecision: SafetyPolicyDecision,
  explanation: T,
): Omit<T, 'category' | 'requiredActions'> & {
  category: SafetyPolicyCategory;
  safetyPolicy: SafetyPolicyDecision;
  requiredActions: SafetyPolicyAction[];
} {
  const hasPolicyActions = policyDecision.requiredActions.length > 0;
  const requiredActions = hasPolicyActions
    ? [...policyDecision.requiredActions]
    : [...new Set(explanation.requiredActions ?? [])];
  return {
    ...explanation,
    category: hasPolicyActions
      ? policyDecision.category
      : (explanation.category ?? policyDecision.category),
    safetyPolicy: policyDecision,
    requiredActions,
  } as Omit<T, 'category' | 'requiredActions'> & {
    category: SafetyPolicyCategory;
    safetyPolicy: SafetyPolicyDecision;
    requiredActions: SafetyPolicyAction[];
  };
}
