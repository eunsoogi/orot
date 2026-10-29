import type { RecordRepository } from '@orot/storage';
import type { TranscriptEvidenceSegment } from '@orot/domain';
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

/** Read through the existing transaction queue, then release it before any audio queue or native work. */
export async function readRecordingSummarySnapshot(
  repository: RecordRepository,
): Promise<RecordingSummarySnapshot> {
  const snapshot = await repository.transaction(async writer => {
    const sources = await writer.list('source_record');
    let segments: TranscriptEvidenceSegment[] | null;
    try {
      segments = await writer.list('transcript_segment');
    } catch {
      // Only metadata read failure is optional. Begin, source-read and final commit errors still propagate.
      segments = null;
    }
    return { sources, segments };
  });
  // Aggregation is outside the transaction: no filesystem, UI, or audio-queue await can hold its lock.
  const sourceIds = new Set(
    snapshot.sources
      .filter(source => source.sourceKind === 'audio_recording')
      .map(source => source.id),
  );
  if (snapshot.segments === null) return { sourceIds, segmentsBySource: null };
  const latest = new Map<string, TranscriptEvidenceSegment>();
  for (const segment of snapshot.segments) {
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
