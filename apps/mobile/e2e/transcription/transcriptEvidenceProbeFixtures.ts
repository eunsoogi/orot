import type { TranscriptEvidenceSegment } from '@orot/domain';
import type { AgentMemoryInput } from '@orot/agent-memory';

/** Builds derived fixture records for the isolated transcript invalidation probe. */
export function syntheticConfirmedMemory(
  segment: TranscriptEvidenceSegment,
): AgentMemoryInput {
  // This test-only record models a prior user-confirmed memory linked to the transcript revision.
  return {
    memoryKey: `transcript-probe:${segment.transcriptId}`,
    text: segment.text,
    kind: 'reviewed_interaction',
    provenance: {
      sourceIds: [segment.id],
      sourceDates: [{ sourceId: segment.id, date: segment.recordedAt }],
      reviewState: 'user_confirmed',
    },
  };
}

export function derivedQuestion(segment: TranscriptEvidenceSegment) {
  const timestamp = new Date().toISOString();
  return {
    id: `${segment.recordingSourceId}:transcript-question`,
    effectiveAt: segment.effectiveAt,
    recordedAt: timestamp,
    ingestedAt: timestamp,
    provenance: { origin: 'derived' as const, sourceRecordIds: [segment.id] },
    reviewState: { status: 'unreviewed' as const },
    questionText: 'Synthetic transcript evidence check',
    priority: 'important' as const,
    evidenceSpanIds: [],
  };
}
