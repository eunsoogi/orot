import type { EncounterPending } from '@orot/agent-runtime';

/** One immutable preview shared by presentation and controller regression cases. */
export const pending: EncounterPending = {
  sourceId: 'recording-a',
  threadId: 'attempt-a',
  segments: [
    {
      id: 'segment-r2',
      transcriptId: 'segment',
      revision: 2,
      effectiveAt: '2035-01-02T00:00:00Z',
      audioRange: { startMs: 100, endMs: 2900 },
    },
  ],
  candidates: [
    {
      id: 'candidate-0',
      kind: 'medication',
      text: '약물 언급',
      speaker: 'unknown',
      evidence: [
        {
          segmentId: 'segment-r2',
          startOffset: 0,
          endOffset: 2,
          quote: '약물',
        },
      ],
    },
  ],
  conflicts: [
    {
      candidateId: 'candidate-0',
      recordId: 'other',
      version: 'version',
      description: '기존 기록과 다름',
    },
  ],
};
