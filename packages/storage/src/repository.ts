import type { RecordKind, RecordMap } from './contracts';
import {
  deleteStoredRecord,
  readStoredRecord,
  upsertStoredRecord,
} from './recordPersistence';
import { createSourceEvidenceRepositories } from './sourceEvidence';
import { createManualHistoryRepository } from './manualHistory';
import type { EvidenceSpanRepository, SourceRecordRepository } from './sourceEvidence';
import type { ManualHistoryRepository } from './manualHistory';
import type { SqlDatabase, SqlTransaction } from './sql';

export interface RecordWriter {
  put<K extends RecordKind>(kind: K, record: RecordMap[K]): Promise<void>;
  delete<K extends RecordKind>(kind: K, id: string): Promise<boolean>;
}

export interface RecordRepository extends RecordWriter {
  sourceRecords: SourceRecordRepository;
  evidenceSpans: EvidenceSpanRepository;
  manualHistory: ManualHistoryRepository;
  get<K extends RecordKind>(kind: K, id: string): Promise<RecordMap[K] | null>;
  transaction<T>(operation: (writer: RecordWriter) => Promise<T>): Promise<T>;
}

function createWriter(executor: SqlTransaction): RecordWriter {
  return {
    put: (kind, record) => upsertStoredRecord(executor, kind, record),
    delete: (kind, id) => deleteStoredRecord(executor, kind, id),
  };
}

export function createRecordRepository(database: SqlDatabase): RecordRepository {
  const sourceEvidenceRepositories = createSourceEvidenceRepositories(database);
  return {
    ...sourceEvidenceRepositories,
    manualHistory: createManualHistoryRepository(database),
    async put<K extends RecordKind>(kind: K, record: RecordMap[K]) {
      await database.transaction(async transaction => {
        await createWriter(transaction).put(kind, record);
      });
    },
    async delete<K extends RecordKind>(kind: K, id: string) {
      let deleted = false;
      await database.transaction(async transaction => {
        deleted = await createWriter(transaction).delete(kind, id);
      });
      return deleted;
    },
    get: (kind, id) => readStoredRecord(database, kind, id),
    async transaction<T>(operation: (transactionWriter: RecordWriter) => Promise<T>) {
      let value!: T;
      await database.transaction(async transaction => {
        value = await operation(createWriter(transaction));
      });
      return value;
    },
  };
}
