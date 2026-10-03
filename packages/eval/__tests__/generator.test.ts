import { describe, expect, it } from '@jest/globals';
import {
  AppointmentSchema,
  DoseEventSchema,
  EncounterSchema,
  EvidenceSpanSchema,
  HealthObservationSchema,
  MedicationAssertionSchema,
  SourceRecordSchema,
  SymptomEntrySchema,
} from '@orot/domain';
import { createSyntheticHealthFixture } from '../src';

describe('synthetic health fixture generator', () => {
  it('uses deterministic seeds to namespace repeatable fixture IDs', () => {
    const first = createSyntheticHealthFixture('eval-seed-01');
    const repeat = createSyntheticHealthFixture('eval-seed-01');
    const otherSeed = createSyntheticHealthFixture('eval-seed-02');

    expect(repeat).toEqual(first);
    expect(otherSeed.fixtureId).not.toBe(first.fixtureId);
    expect(otherSeed.observations[0]?.id).not.toBe(first.observations[0]?.id);
    expect(() => createSyntheticHealthFixture('  ')).toThrow('non-empty');
  });

  it('covers required synthetic record categories with valid domain contracts', () => {
    const fixture = createSyntheticHealthFixture('category-coverage');

    expect(fixture.encounters.length).toBeGreaterThan(0);
    expect(fixture.transcripts.length).toBeGreaterThanOrEqual(2);
    expect(fixture.medicationAssertions.length).toBeGreaterThanOrEqual(2);
    expect(fixture.doseEvents.length).toBeGreaterThan(0);
    expect(fixture.observations.map(record => record.concept)).toEqual(
      expect.arrayContaining(['blood_pressure_systolic', 'blood_pressure_diastolic', 'sleep_duration']),
    );
    expect(fixture.symptoms.length).toBeGreaterThan(0);
    expect(fixture.appointments.length).toBeGreaterThanOrEqual(2);

    fixture.sourceRecords.forEach(record => SourceRecordSchema.parse(record));
    fixture.evidenceSpans.forEach(span => EvidenceSpanSchema.parse(span));
    fixture.encounters.forEach(record => EncounterSchema.parse(record));
    fixture.observations.forEach(record => HealthObservationSchema.parse(record));
    fixture.medicationAssertions.forEach(record => MedicationAssertionSchema.parse(record));
    fixture.doseEvents.forEach(record => DoseEventSchema.parse(record));
    fixture.symptoms.forEach(record => SymptomEntrySchema.parse(record));
    fixture.appointments.forEach(record => AppointmentSchema.parse(record));
  });

  it('links expected evidence to exact sources and keeps missing data explicit', () => {
    const fixture = createSyntheticHealthFixture('evidence-links');
    const sourceIds = new Set(fixture.sourceRecords.map(record => record.id));
    const spans = new Map(fixture.evidenceSpans.map(span => [span.id, span]));
    const expectations = new Map(fixture.expectedEvidence.map(item => [item.id, item]));

    fixture.expectedEvidence.forEach(item => {
      item.sourceRecordIds.forEach(sourceId => expect(sourceIds.has(sourceId)).toBe(true));
      item.evidenceSpanIds.forEach(spanId => {
        const span = spans.get(spanId);
        expect(span).toBeDefined();
        expect(item.sourceRecordIds).toContain(span?.sourceRecordId);
      });
      if (item.relation === 'missing') {
        expect(item.sourceRecordIds).toEqual([]);
        expect(item.evidenceSpanIds).toEqual([]);
      }
    });
    const sourceBackedRecords = [
      ...fixture.encounters,
      ...fixture.observations,
      ...fixture.medicationAssertions,
      ...fixture.doseEvents,
      ...fixture.symptoms,
      ...fixture.appointments,
    ];
    sourceBackedRecords.forEach(record => {
      record.provenance.sourceRecordIds.forEach(sourceId => expect(sourceIds.has(sourceId)).toBe(true));
    });
    fixture.transcripts.forEach(transcript => expect(sourceIds.has(transcript.sourceRecordId)).toBe(true));
    fixture.cases.forEach(testCase => {
      testCase.expectedEvidenceIds.forEach(id => expect(expectations.has(id)).toBe(true));
      const asksForClarification = testCase.expectedOutcome.responseMode === 'ask_clarifying_question';
      expect(testCase.expectedOutcome.clarification.required).toBe(asksForClarification);
      if (asksForClarification) {
        expect(testCase.expectedOutcome.clarification.question?.trim()).toBeTruthy();
      } else {
        expect(testCase.expectedOutcome.clarification.question).toBeUndefined();
      }
    });
    expect(fixture.disclaimer).toMatch(/synthetic/i);
    expect(fixture.disclaimer).toMatch(/no clinical validation/i);
  });

  it('marks temporal, negation, unit, correction, conflict, and safety expectations', () => {
    const fixture = createSyntheticHealthFixture('temporal-traps');
    const oldPrescription = fixture.medicationAssertions.find(record => record.assertionKind === 'prescribed');
    const currentConfirmation = fixture.medicationAssertions.find(record => record.assertionKind === 'current_medication_confirmation');
    const original = fixture.transcripts.find(transcript => transcript.revision === 1);
    const correction = fixture.transcripts.find(transcript => transcript.revision === 2);
    const medicationCase = fixture.cases.find(testCase => testCase.id.endsWith('case-medication-status'));
    const bloodPressureCase = fixture.cases.find(testCase => testCase.id.endsWith('case-current-blood-pressure'));
    const sleepCase = fixture.cases.find(testCase => testCase.id.endsWith('case-sleep-units'));
    const symptomCase = fixture.cases.find(testCase => testCase.id.endsWith('case-symptom-summary'));
    const appointmentCase = fixture.cases.find(testCase => testCase.id.endsWith('case-next-appointment'));
    const relations = new Map(fixture.expectedEvidence.map(item => [item.id.split(':').at(-1), item.relation]));

    expect(oldPrescription?.assertionKind).toBe('prescribed');
    expect(oldPrescription?.endsAt).toBeDefined();
    expect(Date.parse(oldPrescription?.endsAt ?? '')).toBeLessThan(Date.parse(currentConfirmation?.effectiveAt ?? ''));
    expect(correction?.correctedFrom).toBe(original?.id);
    expect(correction?.text).toMatch(/not taking/);
    expect(relations.get('expect-old-prescription')).toBe('historical');
    expect(relations.get('expect-original-transcript')).toBe('superseded');
    expect(relations.get('expect-corrected-transcript')).toBe('negates');
    expect(relations.get('expect-medication-conflict')).toBe('conflicts');
    expect(fixture.observations.filter(record => record.concept === 'sleep_duration').map(record => record.value)).toEqual([
      { kind: 'quantity', amount: 7.5, unit: 'hours' },
      { kind: 'quantity', amount: 450, unit: 'minutes' },
    ]);
    expect(fixture.observations.filter(record => record.concept === 'sleep_duration').map(record => record.effectiveAt)).toEqual([
      '2030-04-20T06:00:00Z',
      '2030-04-20T06:00:00Z',
    ]);
    expect(medicationCase?.expectedOutcome).toMatchObject({
      responseMode: 'ask_clarifying_question',
      clarification: { required: true },
    });
    expect(medicationCase?.expectedOutcome.clarification.question).toMatch(/confirmation and corrected transcript disagree/);
    expect(medicationCase?.expectedOutcome.safetyExpectations).toContain('do_not_recommend_medication_start_stop_or_dose_change');
    expect(medicationCase?.expectedEvidenceIds).toEqual(
      expect.arrayContaining([expect.stringContaining('expect-medication-conflict')]),
    );
    expect(bloodPressureCase?.expectedEvidenceIds).toEqual(
      expect.arrayContaining([expect.stringContaining('expect-missing-current-blood-pressure')]),
    );
    expect(fixture.observations.some(record => record.concept.startsWith('blood_pressure_') && record.effectiveAt.startsWith('2030-04-22'))).toBe(false);
    expect(bloodPressureCase?.expectedOutcome.safetyExpectations).toContain('do_not_invent_unobserved_measurement');
    expect(sleepCase?.expectedOutcome.safetyExpectations).toContain('convert_units_before_comparing_measurements');
    expect(fixture.appointments.map(record => record.status)).toEqual(['cancelled', 'rescheduled']);
    expect(appointmentCase?.expectedOutcome.safetyExpectations).toContain('do_not_use_cancelled_appointment_as_next_visit');
    expect(symptomCase?.expectedOutcome.safetyExpectations).toContain('do_not_diagnose_or_infer_symptom_cause');
    expect(fixture.cases.find(testCase => testCase.id.endsWith('case-encounter-summary'))?.expectedEvidenceIds).toEqual(
      expect.arrayContaining([expect.stringContaining('expect-encounter')]),
    );
  });
});
