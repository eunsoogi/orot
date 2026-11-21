import type { SqlExecutor, SqlResult } from '@orot/storage';
import type { SavedRecordSummarySource } from '../diseaseHypotheses/savedSummaries';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import { utf8ByteLength } from '../aiFeatures/integration/evidenceUtils';
import type { ConversationArtifact } from './conversationArtifactCodec';
import {
  assertRetainedRecordRevision,
  requireRetainedRecordPayload,
} from './retainedRecordFreshness';
import {
  checkedRetainedRow,
  orderedRetainedRecords,
} from './retainedRecordRows';

const maxDescriptors = 256;
const maxKeyBytes = 16 * 1024;
const maxRowBytes = 8 * 1024;
type RawRow = SqlResult['rows'][number];

/** One direct root and one fence only. Never reuses source validity, calls a
 * mutable reader, or crosses an await between inspecting individual rows. */
export async function assertBatchedHistoryRecords(
  tx: SqlExecutor,
  artifact: ConversationArtifact,
  currentOwner: () => boolean,
): Promise<boolean> {
  if (
    artifact.submittedInput ||
    artifact.treatmentContext ||
    artifact.dailyReport ||
    artifact.sources.length < 2
  )
    return false;
  const kinds = {
    health_observation: new Set<string>(),
    source_record: new Set<string>(),
  };
  const sources: SavedRecordSummarySource['records'][] = [];
  let size = 0;
  for (const source of artifact.sources) {
    if (
      'kind' in source ||
      source.reference.sourceKind !== 'personal_record' ||
      source.records.length === 0 ||
      (size += source.records.length) > maxDescriptors
    )
      return false;
    for (const record of source.records) {
      if (
        record.kind !== 'health_observation' &&
        record.kind !== 'source_record'
      )
        return false;
      if (record.id.length > maxKeyBytes) return false;
      kinds[record.kind].add(record.id);
    }
    try {
      sources.push(orderedRetainedRecords(source.records));
    } catch (error) {
      // Let strict replay preserve the first source failure (including an
      // earlier missing record before a conflicting revision later).
      if (error instanceof RetainedSourceInvalidError) return false;
      throw error;
    }
  }
  const observations = JSON.stringify([...kinds.health_observation]);
  const sourceRecords = JSON.stringify([...kinds.source_record]);
  if (
    utf8ByteLength(observations) + utf8ByteLength(sourceRecords) >
    maxKeyBytes
  )
    return false;
  // Bound bridge materialization before transferring it into JS; oversized
  // payloads fall back to the original strict reader, not an unavailable row.
  // UNION ALL keeps both raw kinds on the same SQLite statement snapshot.
  // On transport/transaction errors, let the normal restoration error path
  // retry the whole operation. A JS owner isn't proof SQLite can replay.
  const { rows } = await tx.execute(
    `SELECT 'health_observation' AS kind, r.id,
       CASE WHEN length(CAST(r.payload_json AS BLOB)) > ${maxRowBytes} THEN NULL ELSE r.payload_json END AS source_json,
       length(CAST(r.payload_json AS BLOB)) > ${maxRowBytes} AS oversized,
       EXISTS (SELECT 1 FROM transcript_artifact_staleness s WHERE s.artifact_kind = 'health_observation' AND s.artifact_id = r.id) AS stale
     FROM health_observations r WHERE r.id IN (SELECT value FROM json_each(?))
     UNION ALL
     SELECT 'source_record' AS kind, r.id,
       CASE WHEN length(CAST(r.payload_json AS BLOB)) > ${maxRowBytes} THEN NULL ELSE r.payload_json END AS source_json,
       length(CAST(r.payload_json AS BLOB)) > ${maxRowBytes} AS oversized,
       EXISTS (SELECT 1 FROM transcript_artifact_staleness s WHERE s.artifact_kind = 'source_record' AND s.artifact_id = r.id) AS stale
     FROM source_records r WHERE r.id IN (SELECT value FROM json_each(?))`,
    [observations, sourceRecords],
  );
  if (!currentOwner()) return false;
  const rawRows = {
    health_observation: new Map<string, RawRow>(),
    source_record: new Map<string, RawRow>(),
  };
  for (const row of rows) {
    if (
      (row.kind !== 'health_observation' && row.kind !== 'source_record') ||
      typeof row.id !== 'string' ||
      !kinds[row.kind].has(row.id) ||
      row.oversized !== 0 ||
      rawRows[row.kind].has(row.id)
    )
      return false;
    rawRows[row.kind].set(row.id, row);
  }
  for (const records of sources) {
    // Row shape failures retain original per-source order; fetching
    // identical IDs across sources does not merge validation.
    const checked = records.map(record => {
      if (
        record.kind !== 'health_observation' &&
        record.kind !== 'source_record'
      )
        throw new Error('Unexpected batched history record kind.');
      const row = rawRows[record.kind].get(record.id);
      return row ? checkedRetainedRow(row) : undefined;
    });
    for (const [index, record] of records.entries()) {
      const row = checked[index];
      assertRetainedRecordRevision(
        requireRetainedRecordPayload(row),
        record.revision,
        row?.stale ?? false,
      );
    }
  }
  return true;
}
