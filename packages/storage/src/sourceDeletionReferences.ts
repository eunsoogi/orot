import { RecordIdSchema } from '@orot/domain';
import { STORAGE_TABLES } from './contracts';
import type { RecordKind } from './contracts';
import type { SqlDatabase, SqlExecutor } from './sql';
import {
  timeOwnedSqlTransaction,
  type OwnedSqlPhase,
  type SqlTimingObserver,
} from './ownedSqlTiming';

import { readTrustedOrderedPeriodIndexes } from './periodProvenanceIndexes';
import { sourceSnapshotHealthCandidates } from './sourceSnapshotHealthCandidates';

type References = readonly { kind: string; id: string }[];

export interface TypedSourceDeletionReader {
  listTypedSourceDeletionReferences(
    sourceRecordId: string,
    observe?: SqlTimingObserver<OwnedSqlPhase>,
  ): Promise<References>;
}

export const SOURCE_DELETION_TOMBSTONES_TABLE = 'source_deletion_tombstones';

// Query-local sets are bound to a single exact source. Keep SQL row IDs and JSON
// bundle values distinct so each retains its original SQLite comparison affinity.
const snapshotSource = '(SELECT id FROM deletion_target)';
const snapshotTranscriptSets = `WITH deletion_target(id) AS (SELECT ?),
  target_transcripts AS MATERIALIZED (
    SELECT id, json_extract(payload_json, '$.transcriptId') AS family
    FROM transcript_segments
    WHERE json_extract(payload_json, '$.recordingSourceId') = ${snapshotSource}
  )`;

/** Read both deletion projections from a consistent database snapshot. */
export async function readSourceDeletionSnapshot(
  database: SqlDatabase,
  sourceId: string,
  observe?: SqlTimingObserver<OwnedSqlPhase>,
) {
  let references: References = [];
  await timeOwnedSqlTransaction(
    database,
    async (tx) => {
      const id = RecordIdSchema.parse(sourceId);
      references = await materializeTypedReferences(
        tx,
        id,
        await readTrustedOrderedPeriodIndexes(tx),
      );
    },
    observe,
  );
  return references;
}

/** Reads record identities only so all-local deletion can fence without loading saved payloads. */
export async function listAllLocalDeletionReferences(
  executor: SqlExecutor,
): Promise<readonly string[]> {
  const references = new Set<string>();
  for (const definition of Object.values(STORAGE_TABLES)) {
    const result = await executor.execute(`SELECT id FROM ${definition.table}`);
    for (const row of result.rows) {
      if (typeof row.id !== 'string') throw new Error('A local record ID is invalid.');
      references.add(RecordIdSchema.parse(row.id));
    }
  }
  // Transcript bundle IDs are stable citations even though only segment rows have SQL IDs.
  const transcripts = await executor.execute(
    "SELECT DISTINCT json_extract(payload_json, '$.transcriptId') AS transcript_id FROM transcript_segments WHERE json_extract(payload_json, '$.transcriptId') IS NOT NULL",
  );
  for (const row of transcripts.rows) {
    if (typeof row.transcript_id !== 'string') {
      throw new Error('A transcript bundle deletion reference is invalid.');
    }
    references.add(RecordIdSchema.parse(row.transcript_id));
  }
  return [...references].sort();
}

/** Checks row identity across record kinds without loading their health or transcript payloads. */
export async function hasStoredRecordId(executor: SqlExecutor, recordId: string): Promise<boolean> {
  const id = RecordIdSchema.parse(recordId);
  const tables = Object.values(STORAGE_TABLES).map(({ table }) => table);
  const selects = tables.map((table) => `SELECT id FROM ${table} WHERE id = ?`);
  const result = await executor.execute(
    `SELECT id FROM (${selects.join(' UNION ALL ')}) AS local_records LIMIT 1`,
    tables.map(() => id),
  );
  return result.rows.length > 0;
}

/** Shares the source, transcript, and citation cascade with the pre-delete identity snapshot. */
export function sourceDeletionDependencyPredicate(
  kind: RecordKind,
  table: string,
  sourceIdExpression: string,
  snapshot = false,
): string {
  const dependencies = [
    `EXISTS (SELECT 1 FROM json_each(${table}.payload_json, '$.provenance.sourceRecordIds') AS linked_source WHERE linked_source.value = ${sourceIdExpression})`,
    snapshot
      ? `EXISTS (
        SELECT 1 FROM json_each(${table}.payload_json, '$.provenance.sourceRecordIds') AS linked_transcript
        WHERE linked_transcript.value IN (SELECT id FROM target_transcripts)
        OR linked_transcript.value IN (SELECT family FROM target_transcripts)
      )`
      : `EXISTS (
      SELECT 1 FROM json_each(${table}.payload_json, '$.provenance.sourceRecordIds') AS linked_transcript
      JOIN transcript_segments AS source_transcript
        ON source_transcript.id = linked_transcript.value
        OR json_extract(source_transcript.payload_json, '$.transcriptId') = linked_transcript.value
      WHERE json_extract(source_transcript.payload_json, '$.recordingSourceId') = ${sourceIdExpression}
    )`,
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
  if (kind === 'visit_question_record') {
    dependencies.push(`EXISTS (
      SELECT 1 FROM json_each(${table}.payload_json, '$.provenance.sourceRecordIds') AS original_evidence
      JOIN evidence_spans AS source_span ON source_span.id = original_evidence.value
      WHERE json_extract(source_span.payload_json, '$.sourceRecordId') = ${sourceIdExpression}
    )`);
    dependencies.push(`EXISTS (
      SELECT 1 FROM visit_questions AS parent_question
      WHERE parent_question.id = json_extract(${table}.payload_json, '$.questionId')
      AND ${sourceDeletionDependencyPredicate('visit_question', 'parent_question', sourceIdExpression, snapshot)}
    )`);
  }
  return `(${dependencies.join(' OR ')})`;
}

/** Returns every identity the SQL source cascade removes so memory can fence the same references. */
export async function listSourceDeletionReferences(
  executor: SqlExecutor,
  sourceRecordId: string,
): Promise<readonly string[]> {
  const references = await listTypedSourceDeletionReferences(executor, sourceRecordId);
  return [...new Set(references.map((reference) => reference.id))].sort();
}

/** Capture kind with each identity before the source cascade removes its rows. */
export async function listTypedSourceDeletionReferences(
  executor: SqlExecutor,
  sourceRecordId: string,
): Promise<readonly { kind: string; id: string }[]> {
  return materializeTypedReferences(executor, RecordIdSchema.parse(sourceRecordId));
}

async function materializeTypedReferences(
  executor: SqlExecutor,
  sourceId: string,
  indexedTables?: ReadonlySet<string>,
): Promise<References> {
  const references = new Map<string, { kind: string; id: string }>();
  const add = (kind: string, value: unknown) => {
    if (typeof value !== 'string') throw new Error('A deletion reference ID is invalid.');
    const id = RecordIdSchema.parse(value);
    references.set(JSON.stringify([kind, id]), { kind, id });
  };
  add('source_record', sourceId);
  const spans = await executor.execute(
    "SELECT id FROM evidence_spans WHERE json_extract(payload_json, '$.sourceRecordId') = ?",
    [sourceId],
  );
  for (const row of spans.rows) add('evidence_span', row.id);
  const transcripts = await executor.execute(
    "SELECT id, json_extract(payload_json, '$.transcriptId') AS transcript_id FROM transcript_segments WHERE json_extract(payload_json, '$.recordingSourceId') = ?",
    [sourceId],
  );
  for (const row of transcripts.rows) {
    add('transcript_segment', row.id);
    add('transcript_family', row.transcript_id);
  }
  for (const kind of Object.keys(STORAGE_TABLES) as RecordKind[]) {
    if (kind === 'source_record' || kind === 'evidence_span' || kind === 'transcript_segment')
      continue;
    const table = STORAGE_TABLES[kind].table;
    // The live trigger keeps its original SQL. This snapshot can resolve the recording's
    // target set once per statement instead of joining it again for every record edge.
    const predicate = sourceDeletionDependencyPredicate(kind, table, snapshotSource, true);
    const select = indexedTables?.has(table)
      ? sourceSnapshotHealthCandidates(table, predicate)
      : `SELECT ${table}.id FROM ${table} WHERE ${predicate}`;
    const rows = await executor.execute(
      // Outer SELECT is required by the storage adapters. The original source
      // and transcript queries and record-family order do not change.
      `SELECT id FROM (${snapshotTranscriptSets} ${select}) AS exact_deletion_snapshot`,
      [sourceId],
    );
    for (const row of rows.rows) add(kind, row.id);
  }
  return [...references.values()];
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
