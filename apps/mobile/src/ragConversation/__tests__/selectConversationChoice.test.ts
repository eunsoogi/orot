import type { ConversationScreenProps } from '../ConversationScreenProps';
import { createConversationSessions } from '../conversationSessions';
import { selectConversationChoice } from '../selectConversationChoice';
import { conversationEntryForSession } from '../useConversationEntryIntent';
import { conversationIntentRequests } from '../../aiFeatures/integration/conversationIntent';
import {
  sendConversationMessage,
  startExplicitVisitPreparation,
} from '../conversationVisitDispatch';

const answer = async () => ({
  status: 'answer' as const,
  answer: 'Synthetic answer',
  citations: [],
});

test.each(['possibilities', 'visit-questions', 'health-summary'] as const)(
  'selects %s in the same populated session without dispatching',
  async intent => {
    const store = createConversationSessions();
    store.setDraft(1, 'Earlier synthetic question');
    await store.send(1, answer);
    const messages = store.getSnapshot().sessions[0]!.messages;
    expect(selectConversationChoice(store, intent, () => true)).toBe(true);
    expect(selectConversationChoice(store, intent, () => true)).toBe(true);
    expect(store.getSnapshot().activeId).toBe(1);
    expect(store.getSnapshot().sessions).toHaveLength(1);
    expect(store.getSnapshot().sessions[0]).toMatchObject({
      draft: '',
      entryPrompt: conversationIntentRequests[intent],
      busy: false,
    });
    expect(store.getSnapshot().sessions[0]!.messages).toBe(messages);
    expect(conversationEntryForSession(store, 1)?.intent).toBe(intent);
    const send = jest.fn(
      async (..._args: Parameters<ConversationScreenProps['onSend']>) =>
        answer(),
    );
    if (intent === 'visit-questions') {
      await startExplicitVisitPreparation(store, 1, send);
    } else {
      store.setDraft(1, conversationIntentRequests[intent]);
      await sendConversationMessage(store, 1, send);
    }
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[4]).toMatchObject({ intent });
    expect(store.getSnapshot().sessions).toHaveLength(1);
    store.dispose();
  },
);

test('never relabels an existing draft or a hidden route', () => {
  const store = createConversationSessions();
  store.setDraft(1, 'Keep my draft');
  const before = store.getSnapshot();
  expect(selectConversationChoice(store, 'health-summary', () => true)).toBe(
    false,
  );
  expect(store.getSnapshot()).toBe(before);
  store.setDraft(1, '');
  const empty = store.getSnapshot();
  expect(selectConversationChoice(store, 'possibilities', () => false)).toBe(
    false,
  );
  expect(store.getSnapshot()).toBe(empty);
  store.dispose();
});

test('preserves an in-flight request and its purpose', async () => {
  const store = createConversationSessions();
  let resolve!: (value: Awaited<ReturnType<typeof answer>>) => void;
  store.setDraft(1, 'Pending question');
  const pending = store.send(
    1,
    () =>
      new Promise(done => {
        resolve = done;
      }),
  );
  expect(selectConversationChoice(store, 'visit-questions', () => true)).toBe(
    false,
  );
  resolve(await answer());
  await pending;
  expect(store.getSnapshot().sessions).toHaveLength(1);
  expect(conversationEntryForSession(store, 1)).toBeUndefined();
  store.dispose();
});

test('new choice supersedes failed visit retry context without removing existing turns', async () => {
  const store = createConversationSessions();
  selectConversationChoice(store, 'visit-questions', () => true);
  const prepare = jest.fn().mockResolvedValue({
    status: 'unavailable',
    message: 'Synthetic provider unavailable',
  });
  await startExplicitVisitPreparation(store, 1, prepare);
  const messages = store.getSnapshot().sessions[0]!.messages;
  selectConversationChoice(store, 'health-summary', () => true);
  expect(store.getSnapshot().sessions[0]!.messages).toBe(messages);
  const send = jest.fn().mockResolvedValue({ status: 'no_evidence' });
  store.setDraft(1, 'Summarize the existing record');
  await sendConversationMessage(store, 1, send, prepare);
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]?.[4]).toMatchObject({ intent: 'health-summary' });
  store.dispose();
});

test('does not replace a pending photo attachment', () => {
  const store = createConversationSessions();
  jest.spyOn(store.photoDrafts, 'get').mockReturnValue({ status: 'preparing' });
  const before = store.getSnapshot();
  expect(selectConversationChoice(store, 'health-summary', () => true)).toBe(
    false,
  );
  expect(store.getSnapshot()).toBe(before);
  expect(conversationEntryForSession(store, 1)).toBeUndefined();
  store.dispose();
});

test('new choice supersedes selected report context but preserves its answered transcript', async () => {
  const store = createConversationSessions();
  store.selectDailyReport(1, {
    identity: {
      kind: 'daily_report',
      localDate: '2026-11-10',
      timeZone: 'Asia/Seoul',
      key: 'daily-report:2026-11-10@Asia/Seoul',
    },
    runId: 'synthetic-run',
    revision: 2,
  });
  store.setDraft(1, 'Earlier report question');
  await sendConversationMessage(store, 1, answer);
  const messages = store.getSnapshot().sessions[0]!.messages;
  expect(selectConversationChoice(store, 'possibilities', () => true)).toBe(
    true,
  );
  expect(store.getSnapshot().sessions[0]!.messages).toBe(messages);
  expect(store.getSnapshot().sessions[0]!.dailyReport).toBeUndefined();
  const send = jest.fn().mockResolvedValue({ status: 'no_evidence' });
  store.setDraft(1, conversationIntentRequests.possibilities);
  await sendConversationMessage(store, 1, send);
  expect(send.mock.calls[0]?.[4]).toMatchObject({ intent: 'possibilities' });
  expect(send.mock.calls[0]?.[4]).not.toHaveProperty('dailyReport');
  store.dispose();
});
