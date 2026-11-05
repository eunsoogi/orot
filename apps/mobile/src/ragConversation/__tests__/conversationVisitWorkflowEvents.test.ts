import { createConversationSessions } from '../conversationSessions';
import { runVisitQuestionWorkflow } from '../../agent/visitQuestions/workflow';
import {
  makeProvider,
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../../agent/visitQuestions/testing/workflowFixtures';

test('actual visit workflow tool events belong to the originating answer and do not expose its query', async () => {
  const store = createConversationSessions();
  const first = store.getSnapshot().activeId;
  const prepared = preparedContext();
  const { provider } = makeProvider(
    successfulOutputs(prepared.initialEvidence, prepared.supplementalEvidence),
  );
  const { selection, option } = selectedOption(provider);
  store.setDraft(first, '진료 질문');
  await store.send(first, async (_question, _history, signal, observer) => {
    const result = await runVisitQuestionWorkflow({
      prepared,
      selection,
      providerOptions: [option],
      recipient: 'selected account',
      confirmConsent: async () => true,
      signal,
      observer,
    });
    return result.status === 'ready'
      ? { status: 'answer', answer: '준비했어요.', citations: [] }
      : { status: 'failure', kind: 'unavailable' };
  });
  const message = store.getSnapshot().sessions[0]!.messages[1]!;
  expect(message.toolEvents?.map(event => event.status)).toEqual(['completed']);
  expect(message.toolEvents?.[0]?.callId).toBeTruthy();
  expect(JSON.stringify(message.toolEvents)).not.toContain('최근 검사 결과');
  store.create();
  expect(
    store
      .getSnapshot()
      .sessions.find(session => session.id === store.getSnapshot().activeId)
      ?.messages,
  ).toEqual([]);
  store.dispose();
});
