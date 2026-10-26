export {
  ProvenanceOriginSchema,
  ProvenanceSourceSchema,
  ProvenanceSchema,
  RecordIdSchema,
  RecordMetadataSchema,
  ImportedRecordMetadataSchema,
  ObservationIntervalSchema,
  ReviewStateSchema,
  TimestampSchema,
  compareTimestamps,
} from './common';
export type {
  Provenance,
  ProvenanceSource,
  RecordId,
  RecordMetadata,
  ImportedRecordMetadata,
  ObservationInterval,
  ReviewState,
  Timestamp,
} from './common';
export {
  EncounterSchema,
  EvidenceSpanSchema,
  EvidenceSpanLocatorSchema,
  HealthObservationSchema,
  ObservationValueSchema,
  SourceContentHashSchema,
  SourceRecordSchema,
  SymptomEntrySchema,
  SymptomEntryStatusSchema,
} from './records';
export type {
  Encounter,
  EvidenceSpan,
  EvidenceSpanLocator,
  HealthObservation,
  ObservationValue,
  QuantitySourceRepresentation,
  SourceContentHash,
  SourceRecord,
  SymptomEntry,
  SymptomEntryStatus,
} from './records';
export {
  CreateSymptomEntryInputSchema,
  EditSymptomEntryInputSchema,
  SymptomEntryFilterSchema,
  createSymptomEntry,
  editSymptomEntry,
  filterSymptomEntries,
  resolveSymptomEntry,
} from './symptoms';
export type {
  CreateSymptomEntryInput,
  EditSymptomEntryInput,
  SymptomEntryFilter,
} from './symptoms';
export {
  CurrentMedicationConfirmationSchema,
  DoseObservationStatusSchema,
  DoseEventSchema,
  MedicationDefinitionSchema,
  MedicationAssertionSchema,
  PrescriptionAssertionSchema,
} from './medications';
export type {
  CurrentMedicationConfirmation,
  DoseObservationStatus,
  DoseEvent,
  MedicationDefinition,
  MedicationAssertion,
  PrescriptionAssertion,
} from './medications';
export {
  AppointmentCreateInputSchema,
  CalendarAppointmentSnapshotSchema,
  AppointmentSchema,
  AppointmentStatusSchema,
  AppointmentUpdateInputSchema,
  cancelAppointment,
  createAppointment,
  updateAppointment,
  VisitBriefSchema,
} from './visits';
export { VisitQuestionSchema, VisitQuestionCreateSchema } from './visitQuestions';
export type {
  CalendarAppointmentSnapshot,
  Appointment,
  AppointmentStatus,
  AppointmentUpdateInput,
  VisitBrief,
} from './visits';
export type { VisitQuestion, VisitQuestionCreate } from './visitQuestions';
export { VisitQuestionHealthContextSourceSchema } from './visitQuestionHealthContext';
export type { VisitQuestionHealthContextSource } from './visitQuestionHealthContext';
export {
  createTranscriptCorrection,
  TranscriptAudioRangeSchema,
  TranscriptEvidenceSegmentSchema,
} from './transcripts';
export type { TranscriptAudioRange, TranscriptEvidenceSegment } from './transcripts';
