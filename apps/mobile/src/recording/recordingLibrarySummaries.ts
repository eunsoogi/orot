import type { RecordRepository } from '@orot/storage';
import {
  TranscriptEvidenceSegmentSchema,
  type TranscriptEvidenceSegment,
} from '@orot/domain';
import type { RecordingSourceRecord } from './recordingTypes';
import type {
  RecordingLibrarySummary,
  RecordingTranscriptReviewState,
} from './recordingLibraryServiceTypes';

interface RecordingSummarySnapshot {
  readonly sourceIds: ReadonlySet<string>;
  readonly segmentsBySource: ReadonlyMap<
    string,
    readonly TranscriptEvidenceSegment[]
  > | null;
}

// Only the current revision can affect a summary. Use the existing uniqueness
// index to test newer revisions without materializing their verbatim payload.
const latestTranscriptMetadata = `SELECT retained.payload_json
  FROM transcript_segments AS retained
  WHERE NOT EXISTS (
    SELECT 1 FROM transcript_segments AS newer INDEXED BY transcript_segments_revision_idx
    WHERE json_extract(newer.payload_json, '$.transcriptId') =
          json_extract(retained.payload_json, '$.transcriptId')
      AND json_extract(newer.payload_json, '$.revision') >
          json_extract(retained.payload_json, '$.revision')
  )
  ORDER BY retained.id`;

/** Keep source membership and newest revision selection on one protected
 * snapshot, but release the SQLite transaction before decoding transcripts. */
export async function readRecordingSummarySnapshot(
  repository: RecordRepository,
): Promise<RecordingSummarySnapshot> {
  const snapshot = await repository.transaction(async (writer, sql) => {
    const sources = await writer.list('source_record');
    try {
      if (sql) {
        const { rows } = await sql.execute(latestTranscriptMetadata);
        return { sources, rawSegments: rows.map(row => row.payload_json) };
      }
      // Repository test/legacy ports without a transaction executor retain their typed behavior.
      return { sources, segments: await writer.list('transcript_segment') };
    } catch {
      // Only metadata read failure is optional. Source and transaction errors still propagate.
      return { sources, segments: null };
    }
  });
  let segments = snapshot.segments ?? null;
  if (snapshot.rawSegments) {
    try {
      segments = snapshot.rawSegments.map(payload => {
        if (typeof payload !== 'string')
          throw new Error('Invalid transcript snapshot.');
        return TranscriptEvidenceSegmentSchema.parse(JSON.parse(payload));
      });
    } catch {
      segments = null;
    }
  }
  // Aggregation is outside the transaction: no filesystem, UI, or audio-queue await can hold its lock.
  const sourceIds = new Set(
    snapshot.sources
      .filter(source => source.sourceKind === 'audio_recording')
      .map(source => source.id),
  );
  if (segments === null) return { sourceIds, segmentsBySource: null };
  const latest = new Map<string, TranscriptEvidenceSegment>();
  for (const segment of segments) {
    const current = latest.get(segment.transcriptId);
    if (!current || segment.revision > current.revision)
      latest.set(segment.transcriptId, segment);
  }
  const segmentsBySource = new Map<string, TranscriptEvidenceSegment[]>();
  for (const segment of latest.values()) {
    const rows = segmentsBySource.get(segment.recordingSourceId) ?? [];
    rows.push(segment);
    segmentsBySource.set(segment.recordingSourceId, rows);
  }
  return { sourceIds, segmentsBySource };
}

/** Metadata describes its read snapshot; later source identities cannot be classified by an earlier absence. */
export function recordingLibrarySummaries(
  recordings: readonly RecordingSourceRecord[],
  snapshot: RecordingSummarySnapshot,
): readonly RecordingLibrarySummary[] {
  return recordings.map(source => {
    const known =
      snapshot.sourceIds.has(source.id) && snapshot.segmentsBySource !== null;
    const segments = known
      ? (snapshot.segmentsBySource?.get(source.id) ?? [])
      : [];
    const durations = [
      ...new Set(segments.map(segment => segment.recordingDurationMs)),
    ];
    let transcriptReviewState: RecordingTranscriptReviewState;
    if (!known) transcriptReviewState = 'unavailable';
    else if (segments.length === 0) transcriptReviewState = 'notTranscribed';
    else if (
      segments.some(segment => segment.reviewState.status === 'needs_review')
    )
      transcriptReviewState = 'needsReview';
    else if (
      segments.some(segment => segment.reviewState.status === 'unreviewed')
    )
      transcriptReviewState = 'unreviewed';
    else transcriptReviewState = 'reviewed';
    return {
      source,
      durationMs:
        source.recordingDurationMs ??
        (durations.length === 1 ? durations[0] : null),
      transcriptReviewState,
    };
  });
}
