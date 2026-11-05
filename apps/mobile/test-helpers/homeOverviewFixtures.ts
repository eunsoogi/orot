import type { SavedVisitQuestionsLoadState } from '../src/aiFeatures/integration/savedVisitQuestions';

export function savedHomeQuestions(
  appointmentId: string,
  texts: string[] = [],
): SavedVisitQuestionsLoadState {
  return {
    status: 'ready',
    appointmentId,
    caveats: [],
    restorationNotice: '',
    questions: texts.map((questionText, position) => ({
      identity: {
        id: `synthetic-${position}`,
        expectedRevision: 'fixture-revision',
      },
      questionText,
      position,
      rationale: '합성 질문',
      priority: 'routine',
      citations: [],
    })),
  };
}
