import type { TranscriptEvidenceSegment } from '@orot/domain';
import { isRecordKind } from './contracts';
import { decodeLocalQueryRows, parseLocalQueryWindow } from './localQueryContracts';
import type { LocalQueryWindow, TranscriptQueryResult } from './localQueryContracts';
import type { StaleTranscriptArtifact } from './transcriptEvidence';
import type { SqlDatabase, SqlValue } from './sql';

/** Returns current transcript revisions and the invalidation links for derived artifacts. */
export async function queryTranscriptEvidence(
  database: SqlDatabase,
  filter: LocalQueryWindow & { readonly recordingSourceId: string },
): Promise<TranscriptQueryResult> {
  const window = parseLocalQueryWindow(filter);
  const recordingSourceId = filter.recordingSourceId.trim();
  if (!recordingSourceId) throw new Error('A recording source ID is required.');

  const result = await database.execute(
    `SELECT candidate.payload_json FROM transcript_segments AS candidate
     WHERE json_extract(candidate.payload_json, '$.recordingSourceId') = ?
       AND julianday(candidate.effective_at) >= julianday(?)
       AND julianday(candidate.effective_at) < julianday(?)
       AND NOT EXISTS (
         SELECT 1 FROM transcript_segments AS newer
         WHERE json_extract(newer.payload_json, '$.transcriptId') = json_extract(candidate.payload_json, '$.transcriptId')
           AND json_extract(newer.payload_json, '$.segmentOrdinal') = json_extract(candidate.payload_json, '$.segmentOrdinal')
           AND json_extract(newer.payload_json, '$.revision') > json_extract(candidate.payload_json, '$.revision')
       )
     ORDER BY julianday(candidate.effective_at) ASC,
       CAST(json_extract(candidate.payload_json, '$.segmentOrdinal') AS INTEGER) ASC,
       candidate.id ASC LIMIT ?`,
    [recordingSourceId, window.from, window.to, window.limit + 1],
  );
  const staleRows = await database.execute(
    `SELECT transcript_id, artifact_kind, artifact_id, superseded_segment_id, current_segment_id, invalidated_at
     FROM transcript_artifact_staleness
     WHERE transcript_id IN (
       SELECT DISTINCT json_extract(payload_json, '$.transcriptId') FROM transcript_segments
       WHERE json_extract(payload_json, '$.recordingSourceId') = ?
         AND julianday(effective_at) >= julianday(?) AND julianday(effective_at) < julianday(?)
     )
     ORDER BY transcript_id, artifact_kind, artifact_id LIMIT ?`,
    [recordingSourceId, window.from, window.to, window.limit + 1],
  );

  return {
    ...decodeLocalQueryRows<TranscriptEvidenceSegment>(
      result.rows,
      window.limit,
      'transcript_segment',
    ),
    staleArtifacts: staleRows.rows.slice(0, window.limit).map(readStaleArtifact),
    staleArtifactsHaveMore: staleRows.rows.length > window.limit,
  };
}

function readStaleArtifact(row: Record<string, SqlValue>): StaleTranscriptArtifact {
  const kind = row.artifact_kind;
  if (
    typeof kind !== 'string' ||
    !isRecordKind(kind) ||
    kind === 'transcript_segment' ||
    typeof row.artifact_id !== 'string' ||
    typeof row.superseded_segment_id !== 'string' ||
    typeof row.current_segment_id !== 'string' ||
    typeof row.invalidated_at !== 'string'
  ) {
    throw new Error('A transcript staleness record is invalid.');
  }
  return {
    kind,
    id: row.artifact_id,
    supersededSegmentId: row.superseded_segment_id,
    currentSegmentId: row.current_segment_id,
    invalidatedAt: row.invalidated_at,
  };
}
