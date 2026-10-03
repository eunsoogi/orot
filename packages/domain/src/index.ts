export {
  ProvenanceOriginSchema,
  ProvenanceSchema,
  RecordIdSchema,
  RecordMetadataSchema,
  ReviewStateSchema,
  TimestampSchema,
} from './common';
export type { Provenance, RecordId, RecordMetadata, ReviewState, Timestamp } from './common';
export {
  EncounterSchema,
  EvidenceSpanSchema,
  EvidenceSpanLocatorSchema,
  HealthObservationSchema,
  ObservationValueSchema,
  SourceContentHashSchema,
  SourceRecordSchema,
  SymptomEntrySchema,
} from './records';
export type {
  Encounter,
  EvidenceSpan,
  EvidenceSpanLocator,
  HealthObservation,
  ObservationValue,
  SourceContentHash,
  SourceRecord,
  SymptomEntry,
} from './records';
export {
  CurrentMedicationConfirmationSchema,
  DoseEventSchema,
  MedicationAssertionSchema,
  PrescriptionAssertionSchema,
} from './medications';
export type {
  CurrentMedicationConfirmation,
  DoseEvent,
  MedicationAssertion,
  PrescriptionAssertion,
} from './medications';
export { AppointmentSchema, VisitBriefSchema, VisitQuestionSchema } from './visits';
export type { Appointment, VisitBrief, VisitQuestion } from './visits';
