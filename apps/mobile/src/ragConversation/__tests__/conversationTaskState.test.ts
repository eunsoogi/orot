import { createDailyReportIdentity } from '@orot/domain';
import { createConversationTaskState } from '../conversationTaskState';
import { createEmptyConversation } from '../conversationEmptySession';

test('serializes updates to a task and keeps its saved revision when the same day is revisited', async () => {
  const identity = createDailyReportIdentity('2026-11-10', 'Asia/Seoul');
  let session = createEmptyConversation(1);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  const firstWrite = new Promise<void>(resolve => {
    release = resolve;
  });
  const saveTaskCard = jest
    .fn()
    .mockImplementationOnce(() => {
      entered();
      return firstWrite;
    })
    .mockResolvedValue(undefined);
  const state = createConversationTaskState({
    retention: { saveTaskCard } as never,
    find: () => session,
    update: (_id, change) => {
      session = { ...session, ...change };
    },
    valid: () => true,
    activeId: () => 1,
  });
  const selected = state.save(1, 'card', { kind: 'daily_report', identity });
  const report = { identity, runId: 'synthetic-run', revision: 2 };
  const saved = state.save(1, 'card', {
    kind: 'daily_report',
    identity,
    report,
  });
  await started;
  expect(saveTaskCard).toHaveBeenCalledTimes(1);
  release();
  await Promise.all([selected, saved]);
  expect(saveTaskCard.mock.calls[1]?.[1]).toMatchObject({
    expectedRevision: 1,
    task: { report },
  });
  await state.save(1, 'card', { kind: 'daily_report', identity });
  expect(saveTaskCard).toHaveBeenCalledTimes(2);
  expect(session.taskCards?.[0]).toMatchObject({
    revision: 2,
    task: { report },
  });
});

test('a failed save remains retryable and an invalidated in-flight result cannot repopulate state', async () => {
  const identity = createDailyReportIdentity('2026-11-10', 'Asia/Seoul');
  let session = createEmptyConversation(1);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  const wait = new Promise<void>(resolve => {
    release = resolve;
  });
  const saveTaskCard = jest
    .fn()
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockImplementationOnce(() => {
      entered();
      return wait;
    });
  const state = createConversationTaskState({
    retention: { saveTaskCard } as never,
    find: () => session,
    update: (_id, change) => {
      session = { ...session, ...change };
    },
    valid: () => true,
    activeId: () => 1,
  });
  const task = { kind: 'daily_report' as const, identity };
  await expect(state.save(1, 'card', task)).rejects.toThrow();
  expect(session.taskCards).toBeUndefined();
  const retry = state.save(1, 'card', task);
  await started;
  state.invalidate();
  expect((saveTaskCard.mock.calls[1]?.[2] as AbortSignal).aborted).toBe(true);
  release();
  await expect(retry).rejects.toThrow('Conversation changed');
  expect(session.taskCards).toBeUndefined();
});

test('a late report result cannot replace a newer task selection', async () => {
  const first = createDailyReportIdentity('2026-11-10', 'Asia/Seoul');
  const second = createDailyReportIdentity('2026-11-11', 'Asia/Seoul');
  let session = createEmptyConversation(1);
  const state = createConversationTaskState({
    find: () => session,
    update: (_id, change) => {
      session = { ...session, ...change };
    },
    valid: () => true,
    activeId: () => 1,
  });
  await state.save(1, 'card', { kind: 'daily_report', identity: first });
  await state.save(1, 'card', { kind: 'daily_report', identity: second });
  await state.save(
    1,
    'card',
    {
      kind: 'daily_report',
      identity: first,
      report: { identity: first, runId: 'old-run', revision: 1 },
    },
    1,
  );
  expect(session.taskCards?.[0]?.task).toEqual({
    kind: 'daily_report',
    identity: second,
  });
});
