import { TranscriptEvidenceSegmentSchema } from '@orot/domain';
import type { TranscriptEvidenceSegment } from '@orot/domain';

/** Repository reads include correction history; only the latest revision of each stable segment is model input. */
export function latestRecapTranscript(
  sourceId: string,
  rows: readonly TranscriptEvidenceSegment[],
) {
  const latest = new Map<string, TranscriptEvidenceSegment>();
  for (const row of rows) {
    const segment = TranscriptEvidenceSegmentSchema.parse(row);
    if (segment.recordingSourceId !== sourceId)
      throw new Error('Foreign Recap transcript source.');
    const previous = latest.get(segment.transcriptId);
    if (!previous || previous.revision < segment.revision)
      latest.set(segment.transcriptId, segment);
    else if (
      previous.revision === segment.revision &&
      JSON.stringify(previous) !== JSON.stringify(segment)
    ) {
      throw new Error('Conflicting current transcript revisions.');
    }
  }
  return [...latest.values()].sort(
    (left, right) => left.segmentOrdinal - right.segmentOrdinal,
  );
}
