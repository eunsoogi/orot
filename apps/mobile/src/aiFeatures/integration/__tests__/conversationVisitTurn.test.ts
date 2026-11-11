import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createConversationVisitTurn } from '../conversationVisitTurn';
import { defaultVisitQuestionRouteOperations } from '../visitQuestionsRouteOperations';
import type { SelectedAiResolution } from '../provider';
import type { ConversationEntryContext } from '../conversationIntent';

jest.mock('../visitQuestionsRouteOperations', () => ({
  defaultVisitQuestionRouteOperations: {
    loadAppointment: jest.fn(async () => ({ id: 'appointment-1' })),
    generate: jest.fn(),
  },
}));

test('passes typed saved-question recovery to the conversation result', async () => {
  const selected = { status: 'ready' } as SelectedAiResolution;
  const confirmConsent = jest.fn(async () => true);
  const turn = createConversationVisitTurn({
    loadLocalData: jest.fn(),
    registry: new LocalEvidenceReferenceRegistry(),
    loadSaved: async () => ({
      status: 'error',
      appointmentId: 'appointment-1',
      questions: [],
      message: 'safe retry copy',
      failureReason: 'stale_artifact',
    }),
    registerSource: jest.fn() as never,
  });

  const result = await turn({
    question: 'synthetic visit question request',
    context: {
      intent: 'visit-questions',
      entryKey: 'synthetic-entry',
      appointmentId: 'appointment-1',
    } satisfies ConversationEntryContext,
    signal: new AbortController().signal,
    resolveSelectedAi: async () => selected,
    confirmConsent,
  });

  expect(result).toMatchObject({
    status: 'failure',
    kind: 'visit_saved_unavailable',
    visitQuestionRecovery: {
      status: 'stale_evidence',
      reason: 'stale_artifact',
      action: 'revalidate_saved_question_sources',
    },
  });
  expect(defaultVisitQuestionRouteOperations.generate).not.toHaveBeenCalled();
  expect(confirmConsent).not.toHaveBeenCalled();
});
