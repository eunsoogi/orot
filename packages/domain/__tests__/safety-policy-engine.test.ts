import {
  INITIAL_SAFETY_POLICY,
  SafetyPolicyDocumentSchema,
  SafetyPolicyEngine,
  preserveSafetyPolicyActions,
} from '../src';

const engine = new SafetyPolicyEngine();
const warningSigns = [
  'chest_pain',
  'shortness_of_breath',
  'back_pain',
  'numbness',
  'weakness',
  'vision_change',
  'difficulty_speaking',
] as const;

function reading(
  systolicMmHg: number,
  diastolicMmHg: number,
  minute = 0,
  overrides: Record<string, unknown> = {},
) {
  return {
    systolicMmHg,
    diastolicMmHg,
    unit: 'mmHg',
    measuredAt: `2026-10-27T08:${String(minute).padStart(2, '0')}:00Z`,
    source: 'synthetic-home-monitor',
    ...overrides,
  };
}

function context(
  readings = [reading(181, 121)],
  symptomAssessment: unknown = { status: 'no_new_or_concerning_symptoms' },
) {
  return {
    population: 'adult_not_pregnant',
    readingContext: 'current_measurement',
    readings,
    symptomAssessment,
  };
}

describe('versioned local safety policy', () => {
  it('publishes a validated rule with source, review dates, applicability, and required inputs', () => {
    expect(SafetyPolicyDocumentSchema.safeParse(INITIAL_SAFETY_POLICY).success).toBe(true);
    expect(INITIAL_SAFETY_POLICY.version).toBe('1.0.0');
    expect(INITIAL_SAFETY_POLICY.rules).toEqual([
      expect.objectContaining({
        id: 'adult-nonpregnant-severe-blood-pressure',
        sourceReviewedAt: '2025-08-14',
        reviewedAt: '2026-10-27',
        thresholds: {
          systolicAboveMmHg: 180,
          diastolicAboveMmHg: 120,
          repeatAfterSeconds: 60,
        },
        requiredInputs: expect.arrayContaining([
          'Known adult, non-pregnant applicability',
          'Current blood-pressure reading in mmHg with time and source',
        ]),
      }),
    ]);
  });

  it.each([
    [181, 80],
    [150, 121],
  ])('asks to verify a single severe-range reading (%i/%i)', (systolic, diastolic) => {
    const result = engine.evaluate(context([reading(systolic, diastolic)]));

    expect(result.category).toBe('measurement_data_verification');
    expect(result.requiredActions).toContain('recheck_measurement_after_60_seconds');
  });

  it('uses a strict greater-than threshold and does not label the boundary as a trigger', () => {
    const result = engine.evaluate(context([reading(180, 120)]));

    expect(result.category).toBe('no_triggered_action');
    expect(result.matchedRuleIds).toEqual([]);
    expect(result.requiredActions).toEqual([]);
  });

  it.each(warningSigns)(
    'selects immediate-help guidance when a severe reading includes confirmed %s',
    (sign) => {
      const result = engine.evaluate(
        context([reading(181, 121)], { status: 'warning_signs', signs: [sign] }),
      );

      expect(result.category).toBe('immediate_help');
      expect(result.requiredActions).toEqual(['seek_immediate_emergency_help']);
    },
  );

  it('contacts a clinician when a repeat remains severe after at least one minute and no concerning symptoms are confirmed', () => {
    const result = engine.evaluate(context([reading(181, 121, 0), reading(182, 122, 1)]));

    expect(result.category).toBe('prompt_clinician_contact');
    expect(result.requiredActions).toEqual(['contact_clinician_promptly']);
  });

  it('requests a later repeat when two severe readings are less than a minute apart', () => {
    const result = engine.evaluate(context([reading(181, 121, 0), reading(182, 122, 0)]));

    expect(result.category).toBe('measurement_data_verification');
    expect(result.requiredActions).toEqual(['recheck_measurement_after_60_seconds']);
  });

  it('keeps clinician contact and asks for symptom confirmation when a repeated reading is severe but symptoms are unknown', () => {
    const result = engine.evaluate(
      context([reading(181, 121, 0), reading(182, 122, 1)], { status: 'unknown' }),
    );

    expect(result.category).toBe('insufficient_information');
    expect(result.requiredActions).toEqual([
      'contact_clinician_promptly',
      'confirm_warning_symptoms',
      'seek_immediate_emergency_help_if_warning_signs_are_present',
    ]);
    expect(result.missingInputs).toEqual(['explicit_symptom_assessment']);
  });

  it('does not mistake an earlier normal reading for a persistent severe reading', () => {
    // A clinician-contact recommendation requires two severe readings, not merely two readings.
    const result = engine.evaluate(
      context([reading(120, 80, 0), reading(181, 121, 1)], { status: 'unknown' }),
    );

    expect(result.category).toBe('insufficient_information');
    expect(result.requiredActions).toEqual([
      'confirm_warning_symptoms',
      'seek_immediate_emergency_help_if_warning_signs_are_present',
    ]);
  });

  it('asks for another reading when a severe result follows a normal reading', () => {
    const result = engine.evaluate(context([reading(120, 80, 0), reading(181, 121, 1)]));

    expect(result.category).toBe('measurement_data_verification');
    expect(result.requiredActions).toEqual(['recheck_measurement_after_60_seconds']);
  });

  it.each([
    { unit: 'kPa' },
    { source: '' },
    { measuredAt: 'not-a-timestamp' },
    { systolicMmHg: 80, diastolicMmHg: 90 },
  ])('routes incomplete or inconsistent measurement data to verification', (invalidField) => {
    const result = engine.evaluate(context([reading(181, 121, 0, invalidField)]));

    expect(result.category).toBe('measurement_data_verification');
    expect(result.requiredActions).toEqual(['verify_measurement_data']);
  });

  it('does not evaluate historical readings as current urgent conditions', () => {
    const result = engine.evaluate({
      ...context([reading(181, 121)]),
      readingContext: 'historical',
    });

    expect(result.category).toBe('insufficient_information');
    expect(result.matchedRuleIds).toEqual([]);
    expect(result.missingInputs).toEqual(['current_measurement_context']);
  });

  it('does not infer the rule population when pregnancy or age applicability is unknown', () => {
    const result = engine.evaluate({
      ...context([reading(181, 121)]),
      population: 'unknown',
    });

    expect(result.category).toBe('insufficient_information');
    expect(result.requiredActions).toContain('contact_clinician_promptly');
    expect(result.missingInputs).toEqual(['adult_non_pregnant_applicability']);
  });

  it('defers only a visit question with a scheduled visit', () => {
    const deferred = engine.evaluate({
      requestType: 'visit_question',
      hasUpcomingVisit: true,
      symptomAssessment: { status: 'no_new_or_concerning_symptoms' },
    });
    const missingVisit = engine.evaluate({
      requestType: 'visit_question',
      symptomAssessment: { status: 'no_new_or_concerning_symptoms' },
    });

    expect(deferred.category).toBe('visit_question_deferral');
    expect(deferred.requiredActions).toEqual(['defer_to_scheduled_visit']);
    expect(missingVisit.category).toBe('insufficient_information');
  });

  it('rejects free-text symptom input and does not return source identifiers', () => {
    const result = engine.evaluate({
      ...context([reading(181, 121, 0, { source: 'synthetic-private-source-id' })]),
      symptomAssessment: 'chest pain',
    });

    expect(result.category).toBe('measurement_data_verification');
    expect(JSON.stringify(result)).not.toContain('synthetic-private-source-id');
  });

  it('keeps local actions and classification when generated explanation proposes a lower action', () => {
    const policyDecision = engine.evaluate(
      context([reading(181, 121)], { status: 'warning_signs', signs: ['chest_pain'] }),
    );
    const combined = preserveSafetyPolicyActions(policyDecision, {
      category: 'visit_question_deferral',
      message: 'Synthetic explanation.',
      requiredActions: ['defer_to_scheduled_visit'] as const,
    });

    expect(combined.safetyPolicy.category).toBe('immediate_help');
    expect(combined.category).toBe('immediate_help');
    expect(combined.requiredActions).toEqual(['seek_immediate_emergency_help']);
  });
});
