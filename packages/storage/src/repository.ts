import { parseRecord, STORAGE_TABLES } from './contracts';
import type { RecordKind, RecordMap } from './contracts';
import type { SqlDatabase, SqlExecutor, SqlTransaction } from './sql';

export interface RecordWriter {
  put<K extends RecordKind>(kind: K, record: RecordMap[K]): Promise<void>;
  delete<K extends RecordKind>(kind: K, id: string): Promise<boolean>;
}

export interface RecordRepository extends RecordWriter {
  get<K extends RecordKind>(kind: K, id: string): Promise<RecordMap[K] | null>;
  transaction<T>(operation: (writer: RecordWriter) => Promise<T>): Promise<T>;
}

function createWriter(executor: SqlExecutor): RecordWriter {
  return {
    async put<K extends RecordKind>(kind: K, input: RecordMap[K]) {
      const record = parseRecord(kind, input);
      const table = STORAGE_TABLES[kind].table;
      await executor.execute(
        'INSERT INTO ' + table + ' (id, effective_at, recorded_at, ingested_at, payload_json) ' +
          'VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ' +
          'effective_at = excluded.effective_at, recorded_at = excluded.recorded_at, ' +
          'ingested_at = excluded.ingested_at, payload_json = excluded.payload_json',
        [record.id, record.effectiveAt, record.recordedAt, record.ingestedAt, JSON.stringify(record)],
      );
    },
    async delete<K extends RecordKind>(kind: K, id: string) {
      const result = await executor.execute(
        'DELETE FROM ' + STORAGE_TABLES[kind].table + ' WHERE id = ?',
        [id],
      );
      return (result.rowsAffected ?? 0) > 0;
    },
  };
}

function decodeRecord<K extends RecordKind>(kind: K, payload: unknown): RecordMap[K] {
  if (typeof payload !== 'string') {
    throw new Error('A stored record is invalid.');
  }
  try {
    return parseRecord(kind, JSON.parse(payload) as unknown);
  } catch {
    throw new Error('A stored record is invalid.');
  }
}

export function createRecordRepository(database: SqlDatabase): RecordRepository {
  const writer = createWriter(database);
  return {
    ...writer,
    async get<K extends RecordKind>(kind: K, id: string) {
      const result = await database.execute(
        'SELECT payload_json FROM ' + STORAGE_TABLES[kind].table + ' WHERE id = ? LIMIT 1',
        [id],
      );
      return result.rows.length === 0 ? null : decodeRecord(kind, result.rows[0].payload_json);
    },
    async transaction<T>(operation: (transactionWriter: RecordWriter) => Promise<T>) {
      let value!: T;
      await database.transaction(async transaction => {
        value = await operation(createWriter(transaction as SqlTransaction));
      });
      return value;
    },
    async put<K extends RecordKind>(kind: K, record: RecordMap[K]) {
      await database.transaction(async transaction => {
        await createWriter(transaction as SqlTransaction).put(kind, record);
      });
    },
    async delete<K extends RecordKind>(kind: K, id: string) {
      let deleted = false;
      await database.transaction(async transaction => {
        deleted = await createWriter(transaction as SqlTransaction).delete(kind, id);
      });
      return deleted;
    },
  };
}
