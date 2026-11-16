import { createConversationSessions } from '../conversationSessions';
import { startConversationReportTurn } from '../startConversationReportTurn';

test('explicit report choice appends a normal user and assistant exchange in the current session', async () => {
  const store = createConversationSessions();
  const sender = jest.fn().mockResolvedValue({
    status: 'answer',
    answer: 'Synthetic report',
    citations: [],
  });
  await startConversationReportTurn(store, () => true, sender);
  const state = store.getSnapshot();
  expect(state.activeId).toBe(1);
  expect(state.sessions).toHaveLength(1);
  expect(state.sessions[0].messages.map(message => message.role)).toEqual([
    'user',
    'assistant',
  ]);
  expect(state.sessions[0].messages[1].content).toBe('Synthetic report');
  expect(state.sessions[0].taskCards ?? []).toHaveLength(0);
  expect(sender.mock.calls[0][4]).toMatchObject({
    intent: 'daily-report',
    reportRequest: expect.objectContaining({ kind: 'daily_report' }),
  });
  store.dispose();
});

test('duplicate, navigation-stale, or drafted choices cannot dispatch another task', async () => {
  const store = createConversationSessions();
  const sender = jest.fn().mockResolvedValue({ status: 'no_evidence' });
  await startConversationReportTurn(store, () => false, sender);
  store.setDraft(1, 'Keep my input');
  await startConversationReportTurn(store, () => true, sender);
  expect(sender).not.toHaveBeenCalled();
  expect(store.getSnapshot().sessions[0].draft).toBe('Keep my input');
  store.dispose();
});

test('rapid repeat taps share one owned report request', async () => {
  const store = createConversationSessions();
  let complete!: (value: unknown) => void;
  const sender = jest.fn(
    () =>
      new Promise(resolve => {
        complete = resolve;
      }),
  ) as never;
  const first = startConversationReportTurn(store, () => true, sender);
  const second = startConversationReportTurn(store, () => true, sender);
  await Promise.resolve();
  expect(sender).toHaveBeenCalledTimes(1);
  complete({ status: 'answer', answer: 'Synthetic report', citations: [] });
  await Promise.all([first, second]);
  expect(store.getSnapshot().sessions[0].messages).toHaveLength(2);
  store.dispose();
});
