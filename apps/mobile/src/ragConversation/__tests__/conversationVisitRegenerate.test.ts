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
import { sendConversationMessage } from '../conversationVisitDispatch';

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

test('failed regeneration retries preparation before ordinary follow-up', async () => {
  const store = createConversationSessions();
  const review = createInlineVisitReview(
    'first',
    [],
    [candidate],
    [],
    () => 'q',
  );
  store.setDraft(1, '질문 준비');
  await store.send(1, async () => ({
    status: 'answer',
    answer: '준비',
    citations: [],
    visitQuestions: { appointment, review, validateSource: async () => true },
  }));
  const message = store.getSnapshot().sessions[0]!.messages[1]!;
  const prepare = jest
    .fn()
    .mockResolvedValueOnce({ status: 'unavailable' })
    .mockResolvedValueOnce({
      status: 'answer',
      answer: '다시 준비',
      citations: [],
    });
  const onSend = jest
    .fn()
    .mockResolvedValue({ status: 'answer', answer: '대화', citations: [] });
  regenerateVisitQuestions({ store, sessionId: 1, message, prepare });
  await new Promise<void>(resolve => setImmediate(resolve));
  await sendConversationMessage(store, 1, onSend, prepare);
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(onSend).not.toHaveBeenCalled();
  store.setDraft(1, '추가 질문');
  await sendConversationMessage(store, 1, onSend, prepare);
  expect(onSend).toHaveBeenCalledTimes(1);
  store.dispose();
});

test('cancelled regeneration keeps its appointment when an edited prompt is retried', async () => {
  const store = createConversationSessions();
  const review = createInlineVisitReview(
    'first',
    [],
    [candidate],
    [],
    () => 'q',
  );
  store.setDraft(1, '질문 준비');
  await store.send(1, async () => ({
    status: 'answer',
    answer: '준비',
    citations: [],
    visitQuestions: { appointment, review, validateSource: async () => true },
  }));
  const message = store.getSnapshot().sessions[0]!.messages[1]!;
  const prepare = jest
    .fn()
    .mockImplementationOnce(
      (_q, _h, signal: AbortSignal) =>
        new Promise(resolve =>
          signal.addEventListener('abort', () =>
            resolve({ status: 'failure', kind: 'cancelled' }),
          ),
        ),
    )
    .mockResolvedValueOnce({
      status: 'answer',
      answer: '다시 준비',
      citations: [],
    });
  const onSend = jest.fn();
  regenerateVisitQuestions({ store, sessionId: 1, message, prepare });
  await new Promise<void>(resolve => setImmediate(resolve));
  store.cancel(1);
  store.setDraft(1, '수정한 요청');
  await sendConversationMessage(store, 1, onSend, prepare);
  expect(prepare).toHaveBeenLastCalledWith(
    '수정한 요청',
    expect.any(Array),
    expect.any(AbortSignal),
    expect.any(Object),
    expect.objectContaining({ appointmentId: appointment.id }),
  );
  expect(onSend).not.toHaveBeenCalled();
  store.dispose();
});
