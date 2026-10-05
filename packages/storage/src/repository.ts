import type { RecordKind, RecordMap, SyncCheckpoint } from './contracts';
import {
  deleteStoredRecord,
  listStoredRecords,
  readStoredRecord,
  upsertStoredRecord,
} from './recordPersistence';
import { createSourceEvidenceRepositories } from './sourceEvidence';
import type { EvidenceSpanRepository, SourceRecordRepository } from './sourceEvidence';
import type { SqlDatabase, SqlTransaction } from './sql';

export interface RecordWriter {
  put<K extends RecordKind>(kind: K, record: RecordMap[K]): Promise<void>;
  delete<K extends RecordKind>(kind: K, id: string): Promise<boolean>;
  get<K extends RecordKind>(kind: K, id: string): Promise<RecordMap[K] | null>;
  list<K extends RecordKind>(kind: K): Promise<RecordMap[K][]>;
  putSyncCheckpoint(checkpoint: SyncCheckpoint): Promise<void>;
}

export interface RecordRepository extends RecordWriter {
  sourceRecords: SourceRecordRepository;
  evidenceSpans: EvidenceSpanRepository;
  get<K extends RecordKind>(kind: K, id: string): Promise<RecordMap[K] | null>;
  getSyncCheckpoint(key: string): Promise<SyncCheckpoint | null>;
  transaction<T>(operation: (writer: RecordWriter) => Promise<T>): Promise<T>;
}

async function readSyncCheckpoint(
  executor: SqlTransaction | SqlDatabase,
  key: string,
): Promise<SyncCheckpoint | null> {
  const result = await executor.execute(
    'SELECT checkpoint_key, value, updated_at FROM healthkit_sync_checkpoints WHERE checkpoint_key = ? LIMIT 1',
    [key],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (
    typeof row.checkpoint_key !== 'string' ||
    typeof row.value !== 'string' ||
    typeof row.updated_at !== 'string'
  ) {
    throw new Error('A stored HealthKit sync checkpoint is invalid.');
  }
  return { key: row.checkpoint_key, value: row.value, updatedAt: row.updated_at };
}

function createWriter(executor: SqlTransaction): RecordWriter {
  return {
    put: (kind, record) => upsertStoredRecord(executor, kind, record),
    delete: (kind, id) => deleteStoredRecord(executor, kind, id),
    get: (kind, id) => readStoredRecord(executor, kind, id),
    list: (kind) => listStoredRecords(executor, kind),
    async putSyncCheckpoint(checkpoint) {
      await executor.execute(
        'INSERT INTO healthkit_sync_checkpoints (checkpoint_key, value, updated_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(checkpoint_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        [checkpoint.key, checkpoint.value, checkpoint.updatedAt],
      );
    },
  };
}

export function createRecordRepository(database: SqlDatabase): RecordRepository {
  const sourceEvidenceRepositories = createSourceEvidenceRepositories(database);
  return {
    ...sourceEvidenceRepositories,
    async put<K extends RecordKind>(kind: K, record: RecordMap[K]) {
      await database.transaction(async (transaction) => {
        await createWriter(transaction).put(kind, record);
      });
    },
    async delete<K extends RecordKind>(kind: K, id: string) {
      let deleted = false;
      await database.transaction(async (transaction) => {
        deleted = await createWriter(transaction).delete(kind, id);
      });
      return deleted;
    },
    get: (kind, id) => readStoredRecord(database, kind, id),
    list: (kind) => listStoredRecords(database, kind),
    getSyncCheckpoint: (key) => readSyncCheckpoint(database, key),
    async putSyncCheckpoint(checkpoint) {
      await database.transaction(async (transaction) => {
        await createWriter(transaction).putSyncCheckpoint(checkpoint);
      });
    },
    async transaction<T>(operation: (transactionWriter: RecordWriter) => Promise<T>) {
      let value!: T;
      await database.transaction(async (transaction) => {
        value = await operation(createWriter(transaction));
      });
      return value;
    },
  };
}
