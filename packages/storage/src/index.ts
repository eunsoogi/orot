export { STORAGE_TABLES, isRecordKind, parseRecord } from './contracts';
export type { RecordKind, RecordMap } from './contracts';
export { CURRENT_SCHEMA_VERSION, runMigrations } from './migrations';
export { resolveDatabaseKey } from './key';
export type { RandomByteSource, SecureKeyStore } from './key';
export { openEncryptedStorage } from './open';
export type { OpenEncryptedStorageOptions } from './open';
export { createRecordRepository } from './repository';
export type { RecordRepository, RecordWriter } from './repository';
export { createAppointmentRepository } from './appointments';
export type { Appointment } from '@orot/domain';
export type {
  AppointmentChanges,
  AppointmentRepository,
  AppointmentRepositoryOptions,
  ManualAppointmentInput,
} from './appointments';
export { createSymptomRepository } from './symptoms';
export type { SymptomQuery, SymptomRepository } from './symptoms';
export {
  CreateSymptomEntryInputSchema,
  EditSymptomEntryInputSchema,
  SymptomEntryFilterSchema,
  SymptomEntrySchema,
  SymptomEntryStatusSchema,
  createSymptomEntry,
  editSymptomEntry,
  filterSymptomEntries,
  resolveSymptomEntry,
} from '@orot/domain';
export type {
  CreateSymptomEntryInput,
  EditSymptomEntryInput,
  SymptomEntry,
  SymptomEntryFilter,
  SymptomEntryStatus,
} from '@orot/domain';
export type {
  EvidenceSpanRepository,
  HashedSourceRecord,
  LocatedEvidenceSpan,
  SourceRecordRepository,
} from './sourceEvidence';
export type { SqlDatabase, SqlExecutor, SqlResult, SqlTransaction, SqlValue } from './sql';
