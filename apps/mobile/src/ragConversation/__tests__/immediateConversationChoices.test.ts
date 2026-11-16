import type { ConversationScreenProps } from '../ConversationScreenProps';
import { createConversationSessions } from '../conversationSessions';
import { conversationChoiceActions } from '../selectConversationChoice';
import { immediateConversationChoices } from '../immediateConversationChoices';
import { conversationIntentRequests } from '../../aiFeatures/integration/conversationIntent';

const answer = {
  status: 'answer' as const,
  answer: 'Synthetic reply',
  citations: [],
};
test.each([
  ['possibilities', 'possibilities'],
  ['visitQuestions', 'visit-questions'],
  ['healthSummary', 'health-summary'],
] as const)(
  'one %s tap submits once in the same existing conversation',
  async (key, intent) => {
    const store = createConversationSessions();
    store.setDraft(1, 'Earlier synthetic turn');
    await store.send(1, async () => answer);
    let finish!: (value: typeof answer) => void;
    const send = jest.fn(
      (..._args: Parameters<ConversationScreenProps['onSend']>) =>
        new Promise<typeof answer>(resolve => {
          finish = resolve;
        }),
    );
    const callbacks = conversationChoiceActions(store, () => true);
    const actions = immediateConversationChoices(
      store,
      1,
      {
        possibilities: callbacks.onOpenDiseaseHypotheses,
        visitQuestions: callbacks.onOpenVisitQuestions,
        healthSummary: callbacks.onOpenHealthSummary,
      },
      send,
      send,
      () => true,
    )!;
    actions[key]!();
    actions[key]!();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]).toBeDefined();
    expect(store.getSnapshot().sessions).toHaveLength(1);
    expect(store.getSnapshot().sessions[0]?.messages[0]?.content).toBe(
      'Earlier synthetic turn',
    );
    expect(
      store.getSnapshot().sessions[0]?.pendingMessage?.content,
    ).toBeDefined();
    expect(jest.mocked(send).mock.calls[0]?.[0]).toBe(
      conversationIntentRequests[intent],
    );
    finish(answer);
    await Promise.resolve();
    store.dispose();
  },
);

test('does not choose or submit a draft, hidden entry, or stale session', () => {
  const store = createConversationSessions();
  const choose = jest.fn();
  const send = jest.fn(async () => answer);
  store.setDraft(1, 'Preserve input');
  const actions = immediateConversationChoices(
    store,
    1,
    { healthSummary: choose },
    send,
    send,
    () => true,
  )!;
  actions.healthSummary!();
  store.setDraft(1, '');
  immediateConversationChoices(
    store,
    1,
    { healthSummary: choose },
    send,
    send,
    () => false,
  )!.healthSummary!();
  store.create();
  actions.healthSummary!();
  expect(choose).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  store.dispose();
});
