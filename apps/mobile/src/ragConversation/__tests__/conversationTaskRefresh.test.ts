import { createConversationTaskRefresh } from '../conversationTaskRefresh';
import { createEmptyConversation } from '../conversationEmptySession';
import type { RetainedConversationTask } from '../conversationTaskState';

test('merges a fresh treatment card created while the surviving-card read is pending', async () => {
  let session = createEmptyConversation(1);
  let finish!: (cards: RetainedConversationTask[]) => void;
  const refresh = createConversationTaskRefresh({
    options: {
      retention: { activeIdentity: () => 'saved' } as never,
      restoreTasks: () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    },
    find: () => session,
    update: (_id, change) => {
      session = { ...session, ...change };
    },
    valid: () => true,
  });
  const pending = refresh.start(1, 'saved');
  const created = {
    id: 'new',
    createdAt: 'now',
    revision: 1,
    task: { kind: 'treatment' as const, artifactId: 'new' },
  };
  const surviving = {
    id: 'old',
    createdAt: 'before',
    revision: 1,
    task: { kind: 'treatment' as const, artifactId: 'old' },
  };
  session = { ...session, taskCards: [created], draft: 'preserved' };
  finish([surviving]);
  await pending;
  expect(session.taskCards).toEqual([created, surviving]);
  expect(session.draft).toBe('preserved');
});

test('a failed task refresh is retryable and does not erase the transcript', async () => {
  let session = createEmptyConversation(1);
  const read = jest
    .fn()
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValueOnce([]);
  const refresh = createConversationTaskRefresh({
    options: {
      retention: { activeIdentity: () => 'saved' } as never,
      restoreTasks: read,
    },
    find: () => session,
    update: (_id, change) => {
      session = { ...session, ...change };
    },
    valid: () => true,
  });
  session = { ...session, draft: 'preserved' };
  await refresh.start(1, 'saved');
  expect(session.restoreFailed).toBe(true);
  await refresh.retry(1);
  expect(session.restoreFailed).toBe(false);
  expect(session.error).toBe('');
  expect(session.draft).toBe('preserved');
});
