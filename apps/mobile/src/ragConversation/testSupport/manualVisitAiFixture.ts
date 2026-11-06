import { VisitQuestionRecordSchema } from '@orot/domain';
import { recapResult } from '../../../../../packages/domain/__tests__/recap-fixtures';

/** Schema-valid synthetic results exercise display semantics without claiming model execution. */
export function manualVisitAiRecord(status: 'not_found' | 'indeterminate') {
  const source = recapResult();
  const time = '2026-11-05T00:00:00Z';
  return VisitQuestionRecordSchema.parse({
    id: 'ai-1',
    appointmentId: source.appointmentId,
    questionId: source.questions[0].questionId,
    questionText: source.preparedQuestions[0].questionText,
    questionRevision: 'v1:1',
    revision: 1,
    sourceMethod: 'ai_generated',
    editOrigin: 'ai_analysis',
    answer: null,
    analysisKey: 'fixture',
    effectiveAt: time,
    recordedAt: time,
    ingestedAt: time,
    provenance: {
      origin: 'derived',
      sourceRecordIds: [source.recordingSourceId],
    },
    reviewState: { status: 'unreviewed' },
    automaticSource: {
      recordingSourceId: source.recordingSourceId,
      appointmentId: source.appointmentId,
      binding: source.binding,
      providerId: source.providerId,
      modelId: source.modelId,
      promptVersion: source.promptVersion,
      chunkCount: source.chunkCount,
      sources: source.sources,
      questionRevision: 'v1:1',
      result: {
        questionId: source.questions[0].questionId,
        status,
        questionEvidence: [],
        answers: [],
      },
    },
  });
}
