import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import {
  appointment,
  candidate,
} from '../../../agent/visitQuestions/testing/persistenceFixtures';
import { createInlineVisitReview } from '../../../nextVisitQuestions/inlineVisitReview';
import { theme } from '../../../nextVisitQuestions/testSupport/fixtures';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import { ConversationVisitQuestionCard } from '../ConversationVisitQuestionCard';
import type { VisitQuestionRouteOperations } from '../visitQuestionsRouteOperations';

test('saving a selected question updates only its owning conversation message', async () => {
  const store = createConversationSessions();
  const sessionId = store.getSnapshot().activeId;
  const review = createInlineVisitReview(
    'turn-a',
    [],
    [candidate],
    [],
    () => 'new-id',
  );
  store.setDraft(sessionId, '진료 질문');
  await store.send(sessionId, async () => ({
    status: 'answer',
    answer: '질문을 준비했어요.',
    citations: [],
    visitQuestions: { appointment, review, validateSource: async () => true },
  }));
  const message = store.getSnapshot().sessions[0]!.messages[1]!;
  const save = jest.fn(async input => ({
    questions: input.questions.map((question: typeof candidate) => ({
      ...question,
      identity: { id: question.identity!.id, expectedRevision: 'revision' },
    })),
    caveats: [],
    memoryStatus: 'saved' as const,
    validateSource: async () => true,
  }));
  function View() {
    const current = store.getSnapshot().sessions[0]!.messages[1]!;
    return (
      <ConversationVisitQuestionCard
        message={current}
        sessionId={sessionId}
        store={store}
        operations={{ save } as unknown as VisitQuestionRouteOperations}
        services={{
          resolveSource: () => undefined,
          registerVisitQuestionSource: reference => reference,
        }}
        onOpenSource={() => undefined}
        onRegenerate={() => undefined}
        theme={theme}
      />
    );
  }
  // A real screen subscribes to the store; the save callback itself writes to the owner.
  const rendered = await render(<View />);
  await fireEvent.press(screen.getByTestId('inline-visit-select-0'));
  await rendered.rerender(<View />);
  await fireEvent.press(screen.getByTestId('inline-visit-save'));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      store.getSnapshot().sessions[0]!.messages[1]!.visitQuestions?.review
        .expectedSavedQuestions,
    ).toEqual([{ id: 'new-id', revision: 'revision' }]),
  );
  expect(message.visitQuestions?.review.expectedSavedQuestions).toEqual([]);
  store.dispose();
});
