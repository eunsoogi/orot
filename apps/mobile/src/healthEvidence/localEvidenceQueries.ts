import type { RecordKind, RecordMap, SqlExecutor } from '@orot/storage';
import { parseRecord, STORAGE_TABLES } from '@orot/storage';

export const DEFAULT_HEALTH_EVIDENCE_ROWS_PER_KIND = 100;
export const MAX_HEALTH_EVIDENCE_ROWS_PER_KIND = 100;
export const DEFAULT_HEALTH_EVIDENCE_TOTAL_ROWS = 400;
export const MAX_HEALTH_EVIDENCE_TOTAL_ROWS = 400;
export const MAX_HEALTH_EVIDENCE_RECORD_BYTES = 16 * 1024;

export type LocalHealthEvidenceRecord = {
  [K in RecordKind]: { readonly kind: K; readonly record: RecordMap[K] };
}[RecordKind];

export interface HealthEvidenceQueryOptions {
  readonly rowsPerKind?: number;
  readonly totalRows?: number;
  readonly signal?: AbortSignal;
}

export type HealthEvidenceRecordFilter =
  | { readonly kind: 'all' }
  | { readonly kind: 'id'; readonly value: string }
  | { readonly kind: 'source'; readonly value: string };

export const HEALTH_EVIDENCE_RECORD_KINDS = Object.keys(
  STORAGE_TABLES,
) as RecordKind[];

export function checkHealthEvidenceAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('The local evidence query was cancelled.');
    error.name = 'AbortError';
    throw error;
  }
}

export function parseHealthEvidenceLimits(
  options: HealthEvidenceQueryOptions = {},
) {
  const rowsPerKind =
    options.rowsPerKind ?? DEFAULT_HEALTH_EVIDENCE_ROWS_PER_KIND;
  const totalRows = options.totalRows ?? DEFAULT_HEALTH_EVIDENCE_TOTAL_ROWS;
  if (
    !Number.isSafeInteger(rowsPerKind) ||
    rowsPerKind < 1 ||
    rowsPerKind > MAX_HEALTH_EVIDENCE_ROWS_PER_KIND ||
    !Number.isSafeInteger(totalRows) ||
    totalRows < 1 ||
    totalRows > MAX_HEALTH_EVIDENCE_TOTAL_ROWS
  ) {
    throw new Error(
      'The local evidence query limit is outside its supported range.',
    );
  }
  return { rowsPerKind, totalRows };
}

export async function queryHealthEvidenceRows<K extends RecordKind>(
  executor: SqlExecutor,
  kind: K,
  filter: HealthEvidenceRecordFilter,
  limit: number,
  signal?: AbortSignal,
): Promise<Array<Record<string, unknown>>> {
  checkHealthEvidenceAbort(signal);
  const condition = filterCondition(kind, filter);
  const result = await executor.execute(
    `SELECT id,
      CASE WHEN length(CAST(payload_json AS BLOB)) <= ? THEN payload_json ELSE NULL END AS payload_json,
      length(CAST(payload_json AS BLOB)) AS payload_bytes
     FROM ${STORAGE_TABLES[kind].table} WHERE ${condition.sql} ORDER BY id LIMIT ?`,
    [MAX_HEALTH_EVIDENCE_RECORD_BYTES, ...condition.parameters, limit],
  );
  // SQLite calls are not interruptible through SqlDatabase; discard their result after cancellation.
  checkHealthEvidenceAbort(signal);
  return result.rows;
}

export function decodeHealthEvidenceRecord<K extends RecordKind>(
  kind: K,
  row: Record<string, unknown>,
): LocalHealthEvidenceRecord {
  if (
    typeof row.id !== 'string' ||
    typeof row.payload_json !== 'string' ||
    typeof row.payload_bytes !== 'number' ||
    !Number.isSafeInteger(row.payload_bytes) ||
    row.payload_bytes < 0 ||
    row.payload_bytes > MAX_HEALTH_EVIDENCE_RECORD_BYTES
  ) {
    throw new Error(`A stored ${kind} record could not be read safely.`);
  }
  let record: RecordMap[K];
  try {
    record = parseRecord(kind, JSON.parse(row.payload_json) as unknown);
  } catch {
    throw new Error(`A stored ${kind} record is invalid.`);
  }
  if (record.id !== row.id) {
    throw new Error(`A stored ${kind} record has a mismatched ID.`);
  }
  return { kind, record } as LocalHealthEvidenceRecord;
}

export function appendHealthEvidenceRows<K extends RecordKind>(
  kind: K,
  rows: readonly Record<string, unknown>[],
  rowLimit: number,
  records: LocalHealthEvidenceRecord[],
  truncatedKinds: Set<RecordKind>,
): void {
  if (rows.length > rowLimit) truncatedKinds.add(kind);
  for (const row of rows.slice(0, rowLimit)) {
    if (
      typeof row.payload_bytes === 'number' &&
      row.payload_bytes > MAX_HEALTH_EVIDENCE_RECORD_BYTES
    ) {
      truncatedKinds.add(kind);
      continue;
    }
    records.push(decodeHealthEvidenceRecord(kind, row));
  }
}

function filterCondition(
  recordKind: RecordKind,
  filter: HealthEvidenceRecordFilter,
): { readonly sql: string; readonly parameters: readonly string[] } {
  if (filter.kind === 'all') return { sql: '1 = 1', parameters: [] };
  if (filter.kind === 'id') {
    return { sql: 'id = ?', parameters: [filter.value] };
  }
  if (recordKind === 'evidence_span') {
    return {
      sql: "json_extract(payload_json, '$.sourceRecordId') = ?",
      parameters: [filter.value],
    };
  }
  if (recordKind === 'transcript_segment') {
    return {
      sql: "json_extract(payload_json, '$.recordingSourceId') = ?",
      parameters: [filter.value],
    };
  }
  if (recordKind === 'source_record') {
    // The exact source is read separately; linked source rows must not duplicate it.
    return {
      sql: "id <> ? AND EXISTS (SELECT 1 FROM json_each(payload_json, '$.provenance.sourceRecordIds') WHERE value = ?)",
      parameters: [filter.value, filter.value],
    };
  }
  // Other records keep source linkage in provenance.sourceRecordIds.
  return {
    sql: "EXISTS (SELECT 1 FROM json_each(payload_json, '$.provenance.sourceRecordIds') WHERE value = ?)",
    parameters: [filter.value],
  };
}
