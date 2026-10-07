import { RecordIdSchema } from '@orot/domain';
import { STORAGE_TABLES } from './contracts';
import type { RecordKind } from './contracts';
import type { SqlExecutor } from './sql';

export const SOURCE_DELETION_TOMBSTONES_TABLE = 'source_deletion_tombstones';

/** Shares the source-cascade predicate with the pre-delete identity snapshot. */
export function sourceDeletionDependencyPredicate(
  kind: RecordKind,
  table: string,
  sourceIdExpression: string,
): string {
  const dependencies = [
    `EXISTS (SELECT 1 FROM json_each(${table}.payload_json, '$.provenance.sourceRecordIds') AS linked_source WHERE linked_source.value = ${sourceIdExpression})`,
  ];
  if (kind === 'visit_question' || kind === 'visit_brief') {
    dependencies.push(
      `EXISTS (
        SELECT 1 FROM json_each(${table}.payload_json, '$.evidenceSpanIds') AS cited_span
        JOIN evidence_spans AS source_span ON source_span.id = cited_span.value
        WHERE json_extract(source_span.payload_json, '$.sourceRecordId') = ${sourceIdExpression}
      )`,
    );
  }
  return `(${dependencies.join(' OR ')})`;
}

/** Returns every identity the SQL source cascade removes so memory can fence the same references. */
export async function listSourceDeletionReferences(
  executor: SqlExecutor,
  sourceRecordId: string,
): Promise<readonly string[]> {
  const sourceId = RecordIdSchema.parse(sourceRecordId);
  const references = new Set<string>([sourceId]);
  const spans = await executor.execute(
    "SELECT id FROM evidence_spans WHERE json_extract(payload_json, '$.sourceRecordId') = ?",
    [sourceId],
  );
  for (const row of spans.rows) {
    if (typeof row.id !== 'string') throw new Error('A source evidence span ID is invalid.');
    references.add(RecordIdSchema.parse(row.id));
  }

  const transcripts = await executor.execute(
    "SELECT id, json_extract(payload_json, '$.transcriptId') AS transcript_id FROM transcript_segments WHERE json_extract(payload_json, '$.recordingSourceId') = ?",
    [sourceId],
  );
  for (const row of transcripts.rows) {
    if (typeof row.id !== 'string' || typeof row.transcript_id !== 'string') {
      throw new Error('A transcript deletion reference is invalid.');
    }
    references.add(RecordIdSchema.parse(row.id));
    references.add(RecordIdSchema.parse(row.transcript_id));
  }

  for (const kind of Object.keys(STORAGE_TABLES) as RecordKind[]) {
    if (kind === 'source_record' || kind === 'evidence_span' || kind === 'transcript_segment')
      continue;
    const table = STORAGE_TABLES[kind].table;
    const predicate = sourceDeletionDependencyPredicate(kind, table, '?');
    const rows = await executor.execute(
      `SELECT ${table}.id FROM ${table} WHERE ${predicate}`,
      kind === 'visit_question' || kind === 'visit_brief' ? [sourceId, sourceId] : [sourceId],
    );
    for (const row of rows.rows) {
      if (typeof row.id !== 'string') throw new Error('A dependent record ID is invalid.');
      references.add(RecordIdSchema.parse(row.id));
    }
  }

  return [...references].sort();
}

/** Builds the SQL predicate that prevents a deleted identity from entering a record again. */
export function removedRecordReferencePredicate(
  kind: RecordKind,
  payloadExpression: string,
  recordIdExpression: string,
): string {
  const references = [
    `EXISTS (SELECT 1 FROM ${SOURCE_DELETION_TOMBSTONES_TABLE} WHERE source_id = ${recordIdExpression})`,
  ];
  if (kind === 'evidence_span') {
    references.push(
      `EXISTS (SELECT 1 FROM ${SOURCE_DELETION_TOMBSTONES_TABLE} WHERE source_id = json_extract(${payloadExpression}, '$.sourceRecordId'))`,
    );
  } else if (kind === 'transcript_segment') {
    for (const path of ['$.recordingSourceId', '$.transcriptId', '$.supersedesId']) {
      references.push(
        `EXISTS (SELECT 1 FROM ${SOURCE_DELETION_TOMBSTONES_TABLE} WHERE source_id = json_extract(${payloadExpression}, '${path}'))`,
      );
    }
  }
  if (kind !== 'source_record') {
    for (const path of ['$.provenance.sourceRecordIds', '$.evidenceSpanIds']) {
      references.push(
        `EXISTS (
          SELECT 1 FROM json_each(${payloadExpression}, '${path}') AS reference
          JOIN ${SOURCE_DELETION_TOMBSTONES_TABLE} AS removed ON removed.source_id = reference.value
        )`,
      );
    }
  }
  return `(${references.join(' OR ')})`;
}
