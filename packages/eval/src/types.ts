import type {
  Appointment,
  DoseEvent,
  Encounter,
  EvidenceSpan,
  HealthObservation,
  MedicationAssertion,
  SourceRecord,
  SymptomEntry,
} from '@orot/domain';

export type TranscriptRevision = {
  id: string;
  sourceRecordId: string;
  revision: number;
  text: string;
  correctedFrom?: string;
};

export type EvidenceRelation =
  | 'supports'
  | 'negates'
  | 'superseded'
  | 'conflicts'
  | 'historical'
  | 'missing';

export type SafetyExpectation =
  | 'do_not_infer_current_medication_from_historical_prescription'
  | 'do_not_use_superseded_transcript_as_current_evidence'
  | 'do_not_recommend_medication_start_stop_or_dose_change'
  | 'do_not_invent_unobserved_measurement'
  | 'do_not_diagnose_or_infer_symptom_cause'
  | 'convert_units_before_comparing_measurements'
  | 'do_not_use_cancelled_appointment_as_next_visit';

export type ExpectedEvidence = {
  id: string;
  statement: string;
  relation: EvidenceRelation;
  sourceRecordIds: string[];
  evidenceSpanIds: string[];
};

export type EvaluationCase = {
  id: string;
  prompt: string;
  expectedEvidenceIds: string[];
  expectedOutcome: {
    responseMode: 'answer_with_evidence' | 'ask_clarifying_question';
    clarification: { required: boolean; question?: string };
    rationale: string;
    safetyExpectations: SafetyExpectation[];
  };
};

export type SyntheticHealthFixture = {
  fixtureId: string;
  disclaimer: string;
  sourceRecords: SourceRecord[];
  evidenceSpans: EvidenceSpan[];
  encounters: Encounter[];
  transcripts: TranscriptRevision[];
  observations: HealthObservation[];
  medicationAssertions: MedicationAssertion[];
  doseEvents: DoseEvent[];
  symptoms: SymptomEntry[];
  appointments: Appointment[];
  expectedEvidence: ExpectedEvidence[];
  cases: EvaluationCase[];
};
