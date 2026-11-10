import { readHealthObservationPage } from './healthObservationPages';
import { readHealthMedicationPage } from './healthMedicationPages';
import type { HealthMedicationPage, HealthMedicationPageRequest } from './healthMedicationPages';
import type { HealthObservationCursor, HealthObservationPage } from './healthObservationPages';
import type { HealthObservationPageFilter } from './healthObservationPageFilter';
import { RecordIdSchema } from '@orot/domain';
import { STORAGE_TABLES } from './contracts';
import type { RecordKind, RecordMap, SyncCheckpoint } from './contracts';
import {
  deleteStoredRecord,
  listStoredRecords,
  readStoredRecord,
  upsertStoredRecord,
  assertWritableRecordKind,
} from './recordPersistence';
import { createSourceEvidenceRepositories } from './sourceEvidence';
import { createManualHistoryRepository } from './manualHistory';
import type { EvidenceSpanRepository, SourceRecordRepository } from './sourceEvidence';
import type { ManualHistoryRepository } from './manualHistory';
import { createTranscriptEvidenceRepository } from './transcriptEvidence';
import type { TranscriptEvidenceRepository } from './transcriptEvidence';
import {
  hasStoredRecordId as readStoredRecordIdPresence,
  listAllLocalDeletionReferences as readAllLocalDeletionReferences,
  readSourceDeletionSnapshot,
  SOURCE_DELETION_TOMBSTONES_TABLE,
} from './sourceDeletionReferences';
import type { SqlDatabase, SqlExecutor, SqlTransaction } from './sql';
import { clearResearchArtifacts } from './researchDeletion';
import { readSyncCheckpoint } from './syncCheckpointRead';

export interface DeletedLocalDataReferences {
  readonly sourceRecordIds: readonly string[];
}

export interface RecordWriter {
  put<K extends RecordKind>(kind: K, record: RecordMap[K]): Promise<void>;
  delete<K extends RecordKind>(kind: K, id: string): Promise<boolean>;
  get<K extends RecordKind>(kind: K, id: string): Promise<RecordMap[K] | null>;
  list<K extends RecordKind>(kind: K): Promise<RecordMap[K][]>;
  putSyncCheckpoint(checkpoint: SyncCheckpoint): Promise<void>;
}

export interface RecordRepository extends RecordWriter {
  listHealthMedicationPage(request: HealthMedicationPageRequest): Promise<HealthMedicationPage>;
  listHealthObservationPage(
    cursor?: HealthObservationCursor | null,
    limit?: number,
    filter?: HealthObservationPageFilter,
  ): Promise<HealthObservationPage>;
  sourceRecords: SourceRecordRepository;
  evidenceSpans: EvidenceSpanRepository;
  manualHistory: ManualHistoryRepository;
  transcripts: TranscriptEvidenceRepository;
  get<K extends RecordKind>(kind: K, id: string): Promise<RecordMap[K] | null>;
  getSyncCheckpoint(key: string): Promise<SyncCheckpoint | null>;
  /** SQL preconditions share the typed writer's transaction; callers must not open a nested transaction. */
  transaction<T>(operation: (writer: RecordWriter, sql?: SqlExecutor) => Promise<T>): Promise<T>;
  deleteAllLocalData(
    withinDeletionTransaction?: (
      transaction: SqlExecutor,
      sourceRecordIds: readonly string[],
      localRecordIds: readonly string[],
    ) => Promise<void>,
  ): Promise<DeletedLocalDataReferences>;
  listAllLocalDeletionReferences(): Promise<readonly string[]>;
  hasStoredRecordId(recordId: string): Promise<boolean>;
  listSourceDeletionReferences(sourceRecordId: string): Promise<readonly string[]>;
  listTypedSourceDeletionReferences(
    sourceRecordId: string,
  ): Promise<readonly { kind: string; id: string }[]>;
  listDeletedSourceReferenceIds(referenceIds: readonly string[]): Promise<readonly string[]>;
}

function createWriter(executor: SqlTransaction): RecordWriter {
  return {
    async put(kind, record) {
      assertWritableRecordKind(kind);
      await upsertStoredRecord(executor, kind, record);
    },
    async delete(kind, id) {
      if (kind === 'transcript_segment') {
        throw new Error('Transcript revisions cannot be deleted independently of their recording.');
      }
      return deleteStoredRecord(executor, kind, id);
    },
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
  const transcripts = createTranscriptEvidenceRepository(database);
  return {
    ...sourceEvidenceRepositories,
    manualHistory: createManualHistoryRepository(database),
    listHealthMedicationPage: (request) => readHealthMedicationPage(database, request),
    listHealthObservationPage: (cursor, limit, filter) =>
      readHealthObservationPage(database, cursor, limit, filter),
    transcripts,
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
    async transaction<T>(
      operation: (transactionWriter: RecordWriter, sql?: SqlExecutor) => Promise<T>,
    ) {
      let value!: T;
      await database.transaction(async (transaction) => {
        value = await operation(createWriter(transaction), transaction);
      });
      return value;
    },
    async deleteAllLocalData(withinDeletionTransaction) {
      let deleted: DeletedLocalDataReferences = { sourceRecordIds: [] };
      await database.transaction(async (transaction) => {
        await clearResearchArtifacts(transaction);
        // Fence conversations begun before this wipe, even when no source records exist.
        const conversationStore = await transaction.execute(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
          ['conversation_artifact_generation'],
        );
        if (conversationStore.rows.length) {
          await transaction.execute(
            'UPDATE conversation_artifact_generation SET generation = generation + 1 WHERE singleton = 1',
          );
          await transaction.execute('DELETE FROM conversation_artifact_sessions');
          await transaction.execute('DELETE FROM conversation_artifacts');
        }
        const sources = await listStoredRecords(transaction, 'source_record');
        const sourceRecordIds = sources.map((source) => source.id);
        const localRecordIds = await readAllLocalDeletionReferences(transaction);
        // RAG receives every local identity so even unlinked structured rows stay fenced.
        await withinDeletionTransaction?.(transaction, sourceRecordIds, localRecordIds);
        if (localRecordIds.length > 0) {
          await transaction.execute(
            `INSERT OR IGNORE INTO ${SOURCE_DELETION_TOMBSTONES_TABLE} (source_id) SELECT value FROM json_each(?)`,
            [JSON.stringify(localRecordIds)],
          );
        }
        // Source cascades remove append-only transcripts only after their recording row is gone.
        await transaction.execute('DELETE FROM source_records');
        for (const kind of Object.keys(STORAGE_TABLES) as RecordKind[]) {
          if (kind !== 'source_record') {
            await transaction.execute('DELETE FROM ' + STORAGE_TABLES[kind].table);
          }
        }
        await transaction.execute('DELETE FROM healthkit_sync_checkpoints');
        // The all-local wipe also removes retained question revision identities.
        await transaction.execute('DELETE FROM visit_question_revisions');
        await transaction.execute('DELETE FROM transcript_artifact_staleness');
        const checkpoints = await transaction.execute(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?)",
          ['langgraph_checkpoint_writes', 'langgraph_checkpoints', 'symptom_summary_runs'],
        );
        for (const row of checkpoints.rows) {
          if (
            row.name === 'langgraph_checkpoint_writes' ||
            row.name === 'langgraph_checkpoints' ||
            row.name === 'symptom_summary_runs'
          ) {
            await transaction.execute('DELETE FROM ' + row.name);
          }
        }
        deleted = { sourceRecordIds };
      });
      return deleted;
    },
    async listAllLocalDeletionReferences() {
      // Snapshot IDs in one transaction; deletion callers fence memory before clearing this store.
      let references: readonly string[] = [];
      await database.transaction(async (transaction) => {
        references = await readAllLocalDeletionReferences(transaction);
      });
      return references;
    },
    hasStoredRecordId(recordId) {
      return readStoredRecordIdPresence(database, recordId);
    },
    async listSourceDeletionReferences(sourceRecordId) {
      const references = await readSourceDeletionSnapshot(database, sourceRecordId);
      return [...new Set(references.map((reference) => reference.id))].sort();
    },
    async listTypedSourceDeletionReferences(sourceRecordId) {
      return readSourceDeletionSnapshot(database, sourceRecordId);
    },
    async listDeletedSourceReferenceIds(referenceIds) {
      // Checkpoint resume must reject deleted identities without loading their former content.
      const normalizedIds = [
        ...new Set(referenceIds.map((referenceId) => RecordIdSchema.parse(referenceId))),
      ].sort();
      if (normalizedIds.length === 0) return [];
      const result = await database.execute(
        `SELECT removed.source_id
         FROM ${SOURCE_DELETION_TOMBSTONES_TABLE} AS removed
         JOIN json_each(?) AS requested ON requested.value = removed.source_id
         ORDER BY removed.source_id`,
        [JSON.stringify(normalizedIds)],
      );
      return result.rows.map((row) => {
        if (typeof row.source_id !== 'string') {
          throw new Error('A deleted source reference ID is invalid.');
        }
        return RecordIdSchema.parse(row.source_id);
      });
    },
  };
}
