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
} from './records';
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
  VisitQuestionSchema,
} from './visits';
export type {
  CalendarAppointmentSnapshot,
  Appointment,
  AppointmentStatus,
  AppointmentUpdateInput,
  VisitBrief,
  VisitQuestion,
} from './visits';
export {
  createTranscriptCorrection,
  TranscriptAudioRangeSchema,
  TranscriptEvidenceSegmentSchema,
} from './transcripts';
export type { TranscriptAudioRange, TranscriptEvidenceSegment } from './transcripts';
