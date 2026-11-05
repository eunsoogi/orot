import {
  appointment,
  candidate,
} from '../../agent/visitQuestions/testing/persistenceFixtures';
import {
  createInlineVisitReview,
  inlineReviewUpdate,
} from '../../nextVisitQuestions/inlineVisitReview';
import { createConversationSessions } from '../conversationSessions';
import { regenerateVisitQuestions } from '../conversationVisitRegenerate';

test('regeneration starts a separate turn without replacing prior edits or a composer draft', async () => {
  const store = createConversationSessions();
  const review = createInlineVisitReview(
    'first',
    [],
    [candidate],
    [],
    () => 'first-question',
  );
  store.setDraft(1, '원래 요청');
  await store.send(1, async () => ({
    status: 'answer',
    answer: '준비했어요',
    citations: [],
    visitQuestions: { appointment, review, validateSource: async () => true },
  }));
  const message = store.getSnapshot().sessions[0]!.messages[1]!;
  const edited = inlineReviewUpdate(review, 'first-question', {
    questionText: '보존할 편집',
  });
  store.updateVisitQuestionReview(1, message.id, edited);
  const prepare = jest.fn(async () => ({
    status: 'answer' as const,
    answer: '새 후보',
    citations: [],
  }));
  store.setDraft(1, '작성 중인 대화');
  regenerateVisitQuestions({ store, sessionId: 1, message, prepare });
  expect(store.getSnapshot().sessions[0]!.draft).toBe('작성 중인 대화');
  expect(prepare).not.toHaveBeenCalled();
  store.setDraft(1, '');
  regenerateVisitQuestions({ store, sessionId: 1, message, prepare });
  await Promise.resolve();
  await Promise.resolve();
  expect(prepare).toHaveBeenCalledWith(
    '원래 요청',
    expect.any(Array),
    expect.any(AbortSignal),
    expect.any(Object),
    expect.objectContaining({ appointmentId: appointment.id }),
  );
  expect(
    store.getSnapshot().sessions[0]!.messages[1]!.visitQuestions?.review
      .items[0]?.question.questionText,
  ).toBe('보존할 편집');
  store.dispose();
});
