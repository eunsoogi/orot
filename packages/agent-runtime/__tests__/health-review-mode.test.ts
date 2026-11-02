import { runHealthReviewGraph } from '../src/health-review/graph';
import { isHealthReviewObservationEligible } from '../src/health-review/contracts';
import type { HealthReviewSafety } from '../src/health-review/contracts';
import { bloodPressureMissing, healthReviewModeFixture } from './health-review-mode.fixture';

it('allows observation only for the exact symptom and policy combination', () => {
  const noSymptoms = {
    symptomAssessment: { status: 'no_new_or_concerning_symptoms' },
  };
  const cases: {
    name: string;
    safetyInput: unknown;
    safety: HealthReviewSafety;
    expected: boolean;
  }[] = [
    {
      name: 'unknown symptoms',
      safetyInput: { symptomAssessment: { status: 'unknown' } },
      safety: bloodPressureMissing,
      expected: false,
    },
    {
      name: 'warning symptoms',
      safetyInput: {
        symptomAssessment: { status: 'warning_signs', signs: ['chest_pain'] },
      },
      safety: bloodPressureMissing,
      expected: false,
    },
    {
      name: 'exact blood-pressure gap',
      safetyInput: noSymptoms,
      safety: bloodPressureMissing,
      expected: true,
    },
    {
      name: 'additional missing input',
      safetyInput: noSymptoms,
      safety: {
        ...bloodPressureMissing,
        missingInputs: ['blood_pressure_reading', 'age'],
      },
      expected: false,
    },
    {
      name: 'duplicate missing input',
      safetyInput: noSymptoms,
      safety: {
        ...bloodPressureMissing,
        missingInputs: ['blood_pressure_reading', 'blood_pressure_reading'],
      },
      expected: false,
    },
    {
      name: 'additional required action',
      safetyInput: noSymptoms,
      safety: {
        ...bloodPressureMissing,
        requiredActions: ['provide_required_information', 'contact_clinician_promptly'],
      },
      expected: false,
    },
    {
      name: 'non-insufficient category',
      safetyInput: noSymptoms,
      safety: { ...bloodPressureMissing, category: 'no_triggered_action' },
      expected: false,
    },
  ];
  for (const value of cases) {
    expect(
      isHealthReviewObservationEligible('record_observation', value.safetyInput, value.safety),
    ).toBe(value.expected);
  }
});

it('keeps existing callers strict by default when blood pressure is missing', async () => {
  const { options, collect, explain } = healthReviewModeFixture();
  const result = await runHealthReviewGraph(options);

  expect(result.status).toBe('needs_clarification');
  if (result.status !== 'needs_clarification') throw new Error('Missing strict interrupt');
  expect(result.pending.mode).toBe('strict');
  expect(result.pending.safety).toEqual(bloodPressureMissing);
  expect(collect).not.toHaveBeenCalled();
  expect(explain).not.toHaveBeenCalled();
});

it('reviews records in the explicit observation mode while preserving the unknown safety decision', async () => {
  const { options, collect, explain } = healthReviewModeFixture();
  const result = await runHealthReviewGraph({ ...options, mode: 'record_observation' });

  expect(result).toMatchObject({ status: 'review', safety: bloodPressureMissing });
  expect(collect).toHaveBeenCalledTimes(1);
  expect(explain).toHaveBeenCalledTimes(1);
});

it.each([
  ['unknown symptoms', { symptomAssessment: { status: 'unknown' } }],
  ['warning symptoms', { symptomAssessment: { status: 'warning_signs', signs: ['chest_pain'] } }],
])('keeps observation stopped for %s', async (_name, safetyInput) => {
  const { options, collect, explain, assessSafety } = healthReviewModeFixture();
  const result = await runHealthReviewGraph({
    ...options,
    safetyInput,
    mode: 'record_observation',
  });

  expect(result.status).toBe('needs_clarification');
  expect(assessSafety).toHaveBeenCalledWith(safetyInput, expect.any(AbortSignal));
  expect(collect).not.toHaveBeenCalled();
  expect(explain).not.toHaveBeenCalled();
});
