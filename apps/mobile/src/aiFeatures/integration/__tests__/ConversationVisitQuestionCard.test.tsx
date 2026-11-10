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
import { saveVisitQuestionRoute } from '../visitQuestionsRouteSave';
import type { VisitQuestionEvidenceItem } from '../../../agent/visitQuestions/taskContract';
import {
  citation,
  sourceAlias,
  preparedContext,
} from '../testSupport/visitQuestionsRouteSaveFixtures';

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
  const savedValidator = jest.fn(async () => true);
  const save = jest.fn(async input => ({
    questions: input.questions.map((question: typeof candidate) => ({
      ...question,
      identity: { id: question.identity!.id, expectedRevision: 'revision' },
    })),
    caveats: [],
    memoryStatus: 'saved' as const,
    validateSource: savedValidator,
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
  const committed =
    store.getSnapshot().sessions[0]!.messages[1]!.visitQuestions!;
  await committed.validateSource(
    candidate.citations[0]!,
    new AbortController().signal,
  );
  expect(savedValidator).toHaveBeenCalled();
  await rendered.rerender(<View />);
  await fireEvent.press(screen.getByTestId('inline-visit-save'));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  store.dispose();
});

test('saved generated references and unchecked aliases retain live validation', async () => {
  const original = citation({
    sourceKind: 'generated_artifact',
    sourceId: 'turn',
    evidenceId: 'turn',
    sourceRevision: 'rev',
    evidenceRevision: 'rev',
    locator: { kind: 'generated_artifact', type: 'conversation_turn' },
  });
  const alias = sourceAlias(original);
  const other = { ...alias, sourceId: 'other', evidenceId: 'other' };
  const store = createConversationSessions();
  let index = 0;
  const review = createInlineVisitReview(
    'turn',
    [],
    [
      { ...candidate, citations: [alias] },
      { ...candidate, citations: [other] },
    ],
    [],
    () => `q-${++index}`,
  );
  let fresh = true;
  const originalValidator = jest.fn(
    async (ref, signal: AbortSignal) =>
      !signal.aborted &&
      fresh &&
      (ref.sourceId === alias.sourceId || ref.sourceId === other.sourceId),
  );
  store.setDraft(1, '질문');
  await store.send(1, async () => ({
    status: 'answer',
    answer: '준비',
    citations: [],
    visitQuestions: { appointment, review, validateSource: originalValidator },
  }));
  const save = jest.fn(input =>
    saveVisitQuestionRoute(input, async () => ({
      prepareUpcomingVisitQuestionContext: async options => {
        const context = { ...preparedContext([]), appointment };
        context.revalidateEvidence.mockImplementation(async items =>
          Boolean(
            await options.validateGeneratedArtifact?.(items[0]!, {} as never),
          ),
        );
        return context as never;
      },
    })),
  );
  const resolveSource = (ref: VisitQuestionEvidenceItem) =>
    ref.sourceId === alias.sourceId
      ? original
      : ref.sourceId === other.sourceId
        ? { ...original, sourceId: 'turn-2', evidenceId: 'turn-2' }
        : undefined;
  function View() {
    return (
      <ConversationVisitQuestionCard
        message={store.getSnapshot().sessions[0]!.messages[1]!}
        sessionId={1}
        store={store}
        operations={{ save } as unknown as VisitQuestionRouteOperations}
        services={{ resolveSource, registerVisitQuestionSource: ref => ref }}
        onOpenSource={() => undefined}
        onRegenerate={() => undefined}
        theme={theme}
      />
    );
  }
  const rendered = await render(<View />);
  await fireEvent.press(screen.getByTestId('inline-visit-select-0'));
  await rendered.rerender(<View />);
  await fireEvent.press(screen.getByTestId('inline-visit-save'));
  await waitFor(() =>
    expect(
      store.getSnapshot().sessions[0]!.messages[1]!.visitQuestions!.review
        .expectedSavedQuestions,
    ).toHaveLength(1),
  );
  const visit = store.getSnapshot().sessions[0]!.messages[1]!.visitQuestions!;
  const durable = visit.review.items[0]!.question.citations[0]!;
  expect(durable.sourceId).toBe('turn');
  expect(
    await visit.validateSource(durable, new AbortController().signal),
  ).toBe(true);
  expect(await visit.validateSource(other, new AbortController().signal)).toBe(
    true,
  );
  await rendered.rerender(<View />);
  await fireEvent.press(screen.getByTestId('inline-visit-save'));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.getByText('질문을 저장했어요.')).toBeTruthy(),
  );
  fresh = false;
  expect(
    await visit.validateSource(durable, new AbortController().signal),
  ).toBe(false);
  expect(await visit.validateSource(other, new AbortController().signal)).toBe(
    false,
  );
  const aborted = new AbortController();
  aborted.abort();
  expect(await visit.validateSource(durable, aborted.signal)).toBe(false);
  store.dispose();
});
