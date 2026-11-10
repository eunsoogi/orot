import type { RecapInput, RecapResult } from '../src';

/** Synthetic Korean consultation text; these fixtures prove contracts, never real-model inference. */
export function recapInput(
  text = '이 약은 계속 먹어도 되나요? 네, 지금 용량을 유지하세요.',
): RecapInput {
  return {
    recordingSourceId: 'recording-1',
    appointmentId: 'visit-1',
    binding: { fingerprint: 'explicit-binding-1', version: 1 },
    questions: [
      {
        id: 'question-1',
        appointmentId: 'visit-1',
        questionText: '약을 계속 복용해도 되나요?',
        revision: '2026-11-05T00:00:00Z',
      },
    ],
    segments: [
      {
        id: 'recording-1:segment:0:r1',
        transcriptId: 'recording-1:segment:0',
        recordingSourceId: 'recording-1',
        segmentOrdinal: 0,
        revision: 1,
        text,
        language: 'ko-KR',
        recordingDurationMs: 60000,
        audioRange: { startMs: 0, endMs: 10000 },
        effectiveAt: '2026-11-05T00:00:00Z',
        recordedAt: '2026-11-05T00:01:00Z',
        ingestedAt: '2026-11-05T00:01:00Z',
        provenance: {
          origin: 'derived',
          sourceRecordIds: ['recording-1'],
          source: {
            system: 'Apple Speech',
            sourceIdentifier: 'dictation_transcriber',
            sourceVersion: 'synthetic',
          },
        },
        reviewState: { status: 'unreviewed' },
      },
    ],
  };
}

export function recapResult(input = recapInput()): RecapResult {
  return {
    recordingSourceId: input.recordingSourceId,
    appointmentId: input.appointmentId,
    binding: input.binding,
    providerId: 'synthetic',
    modelId: 'synthetic-model',
    promptVersion: 'transcript-recap-v1',
    chunkCount: 1,
    preparedQuestions: input.questions.map(({ id, questionText, revision }) => ({
      id,
      questionText,
      revision,
    })),
    sources: input.segments.map((segment) => ({
      segmentId: segment.id,
      transcriptId: segment.transcriptId,
      revision: segment.revision,
      audioRange: segment.audioRange,
    })),
    questions: input.questions.map((question) => ({
      questionId: question.id,
      status: 'not_found',
      questionEvidence: [],
      answers: [],
    })),
  };
}
