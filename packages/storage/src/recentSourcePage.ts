import { RecordIdSchema, TimestampSchema } from '@orot/domain';
import { localQueryTimestampKey, localQueryTimestampKeyExpression } from './localQueryTimestamp';
import { SOURCE_DELETION_TOMBSTONES_TABLE } from './sourceDeletionReferences';
import type { SqlExecutor } from './sql';

const PAGE_SIZE = 20;
const sourceKind = "json_extract(payload_json, '$.sourceKind')";
const sourceTime = `CASE ${sourceKind} WHEN 'audio_recording' THEN recorded_at ELSE ingested_at END`;
const sourceTypes = `${sourceKind} IN ('audio_recording','medical_document')`;
const isoTime = `CASE WHEN (${sourceTime}) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*' THEN (${sourceTime}) END`;
// The timestamp key ends outside its fractional-digit alphabet. Appending the
// unique source ID gives SQLite a complete seek key, including within a timestamp tie.
const sourceKey = `(${localQueryTimestampKeyExpression('(' + isoTime + ')')}) || id`;
const eligible = `${sourceTypes} AND julianday((${isoTime})) IS NOT NULL AND json_extract(payload_json, '$.id')=id`;

/** Add only a metadata seek index. It updates with the normal writer and needs no feed-time backfill. */
export async function createRecentSourcePageIndex(sql: SqlExecutor): Promise<void> {
  await sql.execute(
    `CREATE INDEX IF NOT EXISTS source_records_recent_page_idx
     ON source_records (${sourceKey}) WHERE ${sourceTypes}`,
  );
}

export interface RecentSourceRow {
  readonly id: string;
  readonly kind: 'audio_recording' | 'medical_document';
  readonly createdAt: string;
  readonly title?: string;
}
export type RecentSourceCursor = Pick<RecentSourceRow, 'createdAt' | 'id'>;

/** Read only committed source metadata. Original files, OCR, transcripts and reconciliation stay in their existing owners. */
export async function listRecentSourcePage(
  sql: SqlExecutor,
  before?: RecentSourceCursor,
): Promise<readonly RecentSourceRow[]> {
  const seek = before
    ? localQueryTimestampKey(TimestampSchema.parse(before.createdAt)) +
      RecordIdSchema.parse(before.id)
    : null;
  // The protected opener installs this index before handing out a repository.
  // Require the bounded plan instead of silently falling back to a table scan.
  const result = await sql.execute(
    `SELECT id,${sourceKind} AS kind,${sourceTime} AS createdAt,json_extract(payload_json, '$.title') AS title
     FROM source_records INDEXED BY source_records_recent_page_idx WHERE ${eligible}
       ${seek ? `AND (${sourceKey}) < ?` : ''}
       AND NOT EXISTS (SELECT 1 FROM ${SOURCE_DELETION_TOMBSTONES_TABLE} WHERE source_id=source_records.id)
     ORDER BY (${sourceKey}) DESC LIMIT ${PAGE_SIZE}`,
    seek ? [seek] : [],
  );
  return result.rows.map((row) => {
    if (row.kind !== 'audio_recording' && row.kind !== 'medical_document') {
      throw new Error('The recent source kind is invalid.');
    }
    return {
      id: RecordIdSchema.parse(row.id),
      kind: row.kind,
      createdAt: TimestampSchema.parse(row.createdAt),
      ...(typeof row.title === 'string' && row.title.trim() ? { title: row.title } : {}),
    };
  });
}
