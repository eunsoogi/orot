import {
  appointment,
  candidate,
} from '../../agent/visitQuestions/testing/persistenceFixtures';
import {
  createInlineVisitReview,
  inlineReviewUpdate,
} from '../../nextVisitQuestions/inlineVisitReview';
import { createConversationSessions } from '../conversationSessions';

test('edits stay with their answer and cannot be delivered to another session', async () => {
  const store = createConversationSessions();
  const first = store.getSnapshot().activeId;
  const review = createInlineVisitReview(
    'first-turn',
    [],
    [candidate],
    [],
    () => 'question-a',
  );
  store.setDraft(first, '질문 준비');
  await store.send(first, async () => ({
    status: 'answer',
    answer: '질문을 준비했어요.',
    citations: [],
    visitQuestions: { appointment, review, validateSource: async () => true },
  }));
  const message = store.getSnapshot().sessions[0]!.messages[1]!;
  store.create();
  const second = store.getSnapshot().activeId;
  const edited = inlineReviewUpdate(review, 'question-a', {
    questionText: '수정한 질문',
  });
  expect(store.updateVisitQuestionReview(second, message.id, edited)).toBe(
    false,
  );
  const savedValidator = jest.fn(async () => false);
  expect(
    store.updateVisitQuestionReview(first, message.id, edited, savedValidator),
  ).toBe(true);
  expect(
    store.getSnapshot().sessions.find(session => session.id === first)
      ?.messages[1]?.visitQuestions?.validateSource,
  ).toBe(savedValidator);
  expect(
    store.getSnapshot().sessions.find(session => session.id === first)
      ?.messages[1]?.visitQuestions?.review.items[0]?.question.questionText,
  ).toBe('수정한 질문');
  store.remove(first);
  expect(store.updateVisitQuestionReview(first, message.id, edited)).toBe(
    false,
  );
  store.dispose();
});
