import { parseRecord, STORAGE_TABLES } from './contracts';
import type { RecordKind, RecordMap } from './contracts';
import type { SqlExecutor } from './sql';

/** Specialized repositories enforce append-only transcripts and official answer edit/version rules. */
export function assertWritableRecordKind(kind: RecordKind): void {
  if (kind === 'transcript_segment') {
    throw new Error('Transcript revisions must be appended through the transcript repository.');
  }
  if (kind === 'visit_question_record') {
    throw new Error('Official visit records must be saved through their specialized repository.');
  }
}

export function decodeStoredRecord<K extends RecordKind>(kind: K, payload: unknown): RecordMap[K] {
  if (typeof payload !== 'string') throw new Error('A stored record is invalid.');
  try {
    return parseRecord(kind, JSON.parse(payload) as unknown);
  } catch {
    throw new Error('A stored record is invalid.');
  }
}

function values<K extends RecordKind>(kind: K, input: RecordMap[K]) {
  const record = parseRecord(kind, input);
  return {
    record,
    table: STORAGE_TABLES[kind].table,
    parameters: [
      record.id,
      record.effectiveAt ?? null,
      record.recordedAt ?? null,
      record.ingestedAt,
      JSON.stringify(record),
    ],
  };
}

export async function readStoredRecord<K extends RecordKind>(
  executor: SqlExecutor,
  kind: K,
  id: string,
): Promise<RecordMap[K] | null> {
  const result = await executor.execute(
    'SELECT payload_json FROM ' + STORAGE_TABLES[kind].table + ' WHERE id = ? LIMIT 1',
    [id],
  );
  return result.rows.length === 0 ? null : decodeStoredRecord(kind, result.rows[0].payload_json);
}

export async function listStoredRecords<K extends RecordKind>(
  executor: SqlExecutor,
  kind: K,
): Promise<RecordMap[K][]> {
  const result = await executor.execute(
    'SELECT payload_json FROM ' + STORAGE_TABLES[kind].table + ' ORDER BY id',
  );
  return result.rows.map((row) => decodeStoredRecord(kind, row.payload_json));
}

export async function insertStoredRecord<K extends RecordKind>(
  executor: SqlExecutor,
  kind: K,
  input: RecordMap[K],
): Promise<void> {
  const { table, parameters } = values(kind, input);
  await executor.execute(
    'INSERT INTO ' +
      table +
      ' (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
    parameters,
  );
}

export async function updateStoredRecord<K extends RecordKind>(
  executor: SqlExecutor,
  kind: K,
  input: RecordMap[K],
): Promise<boolean> {
  const { table, record } = values(kind, input);
  const result = await executor.execute(
    'UPDATE ' +
      table +
      ' SET effective_at = ?, recorded_at = ?, ingested_at = ?, payload_json = ? WHERE id = ?',
    [
      record.effectiveAt ?? null,
      record.recordedAt ?? null,
      record.ingestedAt,
      JSON.stringify(record),
      record.id,
    ],
  );
  return (result.rowsAffected ?? 0) > 0;
}

export async function upsertStoredRecord<K extends RecordKind>(
  executor: SqlExecutor,
  kind: K,
  input: RecordMap[K],
): Promise<void> {
  const { table, parameters } = values(kind, input);
  await executor.execute(
    'INSERT INTO ' +
      table +
      ' (id, effective_at, recorded_at, ingested_at, payload_json) ' +
      'VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ' +
      'effective_at = excluded.effective_at, recorded_at = excluded.recorded_at, ' +
      'ingested_at = excluded.ingested_at, payload_json = excluded.payload_json',
    parameters,
  );
}

export async function deleteStoredRecord(
  executor: SqlExecutor,
  kind: RecordKind,
  id: string,
): Promise<boolean> {
  const result = await executor.execute(
    'DELETE FROM ' + STORAGE_TABLES[kind].table + ' WHERE id = ?',
    [id],
  );
  return (result.rowsAffected ?? 0) > 0;
}
