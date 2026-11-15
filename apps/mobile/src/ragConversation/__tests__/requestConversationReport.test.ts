import { createConversationSessions } from '../conversationSessions';
import { requestConversationReport } from '../requestConversationReport';

test('keeps the current session, draft and exchange and deduplicates report entry', async () => {
  const store = createConversationSessions();
  const id = store.getSnapshot().activeId;
  store.setDraft(id, 'synthetic unsent question');
  const before = store.getSnapshot();
  const ready = jest.fn();
  await Promise.all([
    requestConversationReport(store, () => true, ready),
    requestConversationReport(store, () => true, ready),
  ]);
  await requestConversationReport(store, () => true, ready);
  const after = store.getSnapshot();
  expect(after.activeId).toBe(id);
  expect(after.sessions).toHaveLength(before.sessions.length);
  expect(after.sessions[0]).toMatchObject({
    draft: 'synthetic unsent question',
    messages: [],
    busy: false,
    taskCards: [{ revision: 1, task: { kind: 'daily_report' } }],
  });
  expect(ready).toHaveBeenCalledTimes(2);
  store.dispose();
});

test('does not navigate after a newer session selection during persistence', async () => {
  const store = createConversationSessions();
  const save = store.saveTaskCard;
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  jest.spyOn(store, 'saveTaskCard').mockImplementation(async (...args) => {
    await gate;
    await save(...args);
  });
  const ready = jest.fn();
  const oldId = store.getSnapshot().activeId;
  const pending = requestConversationReport(store, () => true, ready);
  store.create();
  release();
  await pending;
  expect(ready).not.toHaveBeenCalled();
  expect(store.getSnapshot().activeId).not.toBe(oldId);
  expect(
    store.getSnapshot().sessions.find(s => s.id === oldId)?.taskCards,
  ).toHaveLength(1);
  store.dispose();
});

test('stale entry does nothing; failed persistence reports error without navigating', async () => {
  const store = createConversationSessions();
  const save = jest
    .spyOn(store, 'saveTaskCard')
    .mockRejectedValue(new Error('synthetic failure'));
  const ready = jest.fn();
  await requestConversationReport(store, () => false, ready);
  expect(save).not.toHaveBeenCalled();
  await requestConversationReport(store, () => true, ready);
  expect(ready).not.toHaveBeenCalled();
  expect(store.getSnapshot().sessions[0]?.error).toBeTruthy();
  expect(store.getSnapshot().sessions).toHaveLength(1);
  store.dispose();
});

test('adding a report does not cancel an active response or replace its eventual answer', async () => {
  const store = createConversationSessions();
  const id = store.getSnapshot().activeId;
  store.setDraft(id, 'synthetic question');
  let finish!: (value: import('../service').RagConversationOutcome) => void;
  let signal: AbortSignal | undefined;
  const send = store.send(id, (_question, _history, current) => {
    signal = current;
    return new Promise(resolve => {
      finish = resolve;
    });
  });
  await requestConversationReport(store, () => true);
  expect(signal?.aborted).toBe(false);
  expect(store.getSnapshot().sessions[0]?.busy).toBe(true);
  finish({ status: 'answer', answer: 'synthetic answer', citations: [] });
  await send;
  expect(store.getSnapshot().sessions[0]?.messages.map(m => m.content)).toEqual(
    ['synthetic question', 'synthetic answer'],
  );
  expect(store.getSnapshot().sessions[0]?.taskCards).toHaveLength(1);
  store.dispose();
});

test('navigation interrupted during persistence retains the task without redirecting', async () => {
  const store = createConversationSessions();
  let current = true;
  const ready = jest.fn();
  const pending = requestConversationReport(store, () => current, ready);
  current = false;
  await pending;
  expect(ready).not.toHaveBeenCalled();
  expect(store.getSnapshot().sessions[0]?.taskCards).toHaveLength(1);
  store.dispose();
});
