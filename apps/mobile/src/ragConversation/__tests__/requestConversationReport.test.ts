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
