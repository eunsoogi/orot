import {
  AppointmentSchema,
  CurrentMedicationConfirmationSchema,
  DoseEventSchema,
  EncounterSchema,
  EvidenceSpanSchema,
  HealthObservationSchema,
  PrescriptionAssertionSchema,
  SourceRecordSchema,
  SymptomEntrySchema,
  VisitBriefSchema,
  VisitQuestionSchema,
} from '../src';

export const metadata = (id: string, overrides = {}) => ({
  id,
  effectiveAt: '2026-02-03T09:00:00-05:00',
  recordedAt: '2026-02-03T09:05:00-05:00',
  ingestedAt: '2026-02-03T09:10:00-05:00',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  ...overrides,
});

export const validContracts = [
  [
    'SourceRecord',
    SourceRecordSchema,
    {
      ...metadata('source-1', {
        provenance: { origin: 'clinician_recorded', sourceRecordIds: [] },
      }),
      sourceKind: 'clinician_note',
      title: 'Synthetic visit note',
    },
  ],
  [
    'EvidenceSpan',
    EvidenceSpanSchema,
    {
      ...metadata('evidence-1', {
        provenance: { origin: 'imported', sourceRecordIds: ['source-1'] },
      }),
      sourceRecordId: 'source-1',
      text: 'Synthetic blood pressure result.',
      pageNumber: 1,
    },
  ],
  ['Encounter', EncounterSchema, { ...metadata('encounter-1'), encounterKind: 'outpatient' }],
  [
    'HealthObservation',
    HealthObservationSchema,
    {
      ...metadata('observation-1'),
      observationKind: 'measurement',
      concept: 'blood pressure',
      value: { kind: 'quantity', amount: 120, unit: 'mmHg' },
    },
  ],
  [
    'MedicationAssertion prescription',
    PrescriptionAssertionSchema,
    {
      ...metadata('prescription-1', {
        provenance: { origin: 'imported', sourceRecordIds: ['source-1'] },
      }),
      assertionKind: 'prescribed',
      medicationName: 'Sample medication',
      prescriberId: 'clinician-1',
    },
  ],
  [
    'MedicationAssertion current confirmation',
    CurrentMedicationConfirmationSchema,
    {
      ...metadata('confirmation-1'),
      assertionKind: 'current_medication_confirmation',
      medicationName: 'Sample medication',
      confirmedByUserId: 'user-1',
    },
  ],
  [
    'DoseEvent',
    DoseEventSchema,
    {
      ...metadata('dose-1'),
      eventKind: 'taken',
      medicationAssertionId: 'confirmation-1',
      dose: { amount: 1, unit: 'tablet' },
    },
  ],
  [
    'SymptomEntry',
    SymptomEntrySchema,
    {
      ...metadata('symptom-1'),
      description: 'Synthetic mild headache',
      severity: 2,
    },
  ],
  [
    'Appointment',
    AppointmentSchema,
    {
      ...metadata('appointment-1', {
        effectiveAt: '2027-03-01T10:00:00-05:00',
      }),
      status: 'scheduled',
      reason: 'Routine follow-up',
    },
  ],
  [
    'VisitQuestion',
    VisitQuestionSchema,
    {
      ...metadata('question-1'),
      questionText: 'What should I monitor?',
      priority: 'routine',
      evidenceSpanIds: [],
    },
  ],
  [
    'VisitBrief',
    VisitBriefSchema,
    {
      ...metadata('brief-1', {
        provenance: { origin: 'derived', sourceRecordIds: ['source-1'] },
      }),
      encounterId: 'encounter-1',
      summary: 'Synthetic summary for discussion.',
      questionIds: ['question-1'],
      evidenceSpanIds: ['evidence-1'],
      medicationAssertionIds: ['prescription-1'],
    },
  ],
];
