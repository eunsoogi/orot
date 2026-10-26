import { SafetyPolicyEngine } from '../src';

const engine = new SafetyPolicyEngine();

function severeReading(measuredAt: string) {
  return {
    systolicMmHg: 181,
    diastolicMmHg: 121,
    unit: 'mmHg',
    measuredAt,
    source: 'synthetic-home-monitor',
  };
}

describe('safety policy repeat interval precision', () => {
  it.each([
    [
      '59.9999 seconds apart',
      '2026-10-27T08:00:00.0001Z',
      '2026-10-27T08:01:00.0000Z',
      'measurement_data_verification',
      'recheck_measurement_after_60_seconds',
    ],
    [
      'exactly 60 seconds apart',
      '2026-10-27T08:00:00.0000Z',
      '2026-10-27T08:01:00.0000Z',
      'prompt_clinician_contact',
      'contact_clinician_promptly',
    ],
    [
      '60.0001 seconds apart',
      '2026-10-27T08:00:00.0000Z',
      '2026-10-27T08:01:00.0001Z',
      'prompt_clinician_contact',
      'contact_clinician_promptly',
    ],
  ] as const)(
    'classifies two severe readings %s',
    (_description, firstMeasuredAt, secondMeasuredAt, category, requiredAction) => {
      const result = engine.evaluate({
        population: 'adult_not_pregnant',
        readingContext: 'current_measurement',
        readings: [severeReading(firstMeasuredAt), severeReading(secondMeasuredAt)],
        symptomAssessment: { status: 'no_new_or_concerning_symptoms' },
      });

      expect(result.category).toBe(category);
      expect(result.requiredActions).toEqual([requiredAction]);
    },
  );
});
