import {
  AppointmentSchema,
  DoseEventSchema,
  EncounterSchema,
  EvidenceSpanSchema,
  HealthObservationSchema,
  MedicationDefinitionSchema,
  MedicationAssertionSchema,
  SourceRecordSchema,
  SymptomEntrySchema,
  TranscriptEvidenceSegmentSchema,
  VisitBriefSchema,
  VisitQuestionSchema,
  VisitQuestionRecordSchema,
} from '@orot/domain';
import type {
  Appointment,
  CurrentMedicationConfirmation,
  DoseEvent,
  Encounter,
  EvidenceSpan,
  HealthObservation,
  MedicationDefinition,
  MedicationAssertion,
  PrescriptionAssertion,
  SourceRecord,
  SymptomEntry,
  TranscriptEvidenceSegment,
  VisitBrief,
  VisitQuestion,
  VisitQuestionRecord,
} from '@orot/domain';

export const STORAGE_TABLES = {
  source_record: { table: 'source_records', schema: SourceRecordSchema, nullableSourceTimes: true },
  evidence_span: { table: 'evidence_spans', schema: EvidenceSpanSchema, nullableSourceTimes: true },
  encounter: { table: 'encounters', schema: EncounterSchema },
  health_observation: {
    table: 'health_observations',
    schema: HealthObservationSchema,
    nullableRecordedAt: true,
  },
  symptom_entry: { table: 'symptom_entries', schema: SymptomEntrySchema },
  medication_definition: {
    table: 'medication_definitions',
    schema: MedicationDefinitionSchema,
    nullableSourceTimes: true,
  },
  medication_assertion: { table: 'medication_assertions', schema: MedicationAssertionSchema },
  dose_event: { table: 'dose_events', schema: DoseEventSchema, nullableRecordedAt: true },
  appointment: { table: 'appointments', schema: AppointmentSchema },
  visit_question: { table: 'visit_questions', schema: VisitQuestionSchema },
  visit_question_record: { table: 'visit_question_records', schema: VisitQuestionRecordSchema },
  visit_brief: { table: 'visit_briefs', schema: VisitBriefSchema },
  transcript_segment: {
    table: 'transcript_segments',
    schema: TranscriptEvidenceSegmentSchema,
  },
} as const;

export type RecordKind = keyof typeof STORAGE_TABLES;

export interface RecordMap {
  source_record: SourceRecord;
  evidence_span: EvidenceSpan;
  encounter: Encounter;
  health_observation: HealthObservation;
  symptom_entry: SymptomEntry;
  medication_definition: MedicationDefinition;
  medication_assertion: MedicationAssertion | PrescriptionAssertion | CurrentMedicationConfirmation;
  dose_event: DoseEvent;
  appointment: Appointment;
  visit_question: VisitQuestion;
  visit_question_record: VisitQuestionRecord;
  visit_brief: VisitBrief;
  transcript_segment: TranscriptEvidenceSegment;
}

export function isRecordKind(value: string): value is RecordKind {
  return Object.hasOwn(STORAGE_TABLES, value);
}

export function parseRecord<K extends RecordKind>(kind: K, value: unknown): RecordMap[K] {
  return STORAGE_TABLES[kind].schema.parse(value) as RecordMap[K];
}

export interface SyncCheckpoint {
  readonly key: string;
  readonly value: string;
  readonly updatedAt: string;
}
