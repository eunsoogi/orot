import { conversationRecoveryActions } from '../conversationRecoveryActions';
import { createConversationPagedRestoreState } from '../conversationPagedRestoreState';
import { createEmptyConversation } from '../conversationEmptySession';
import type {
  ConversationHistoryPage,
  ReadConversationHistoryPage,
} from '../conversationHistoryPage';

const turn = (id: string) => ({
  question: `question ${id}`,
  answer: `answer ${id}`,
  citations: [],
  toolMessageId: id,
  completion: 'complete' as const,
});
const cursor = {
  createdAt: '2026-11-01T00:00:00.000Z',
  id: 'middle',
  kind: 'turn' as const,
  version: 0,
};
function setup(read: ReadConversationHistoryPage) {
  let session = createEmptyConversation(1);
  const state = createConversationPagedRestoreState({
    read,
    find: () => session,
    update: (_id, change) => {
      session = { ...session, ...change };
    },
  });
  return {
    state,
    get: () => session,
  };
}

test('route recovery reads only the interrupted first page without retrying pending tasks or older history', async () => {
  let finishOld!: (page: ConversationHistoryPage) => void;
  const read = jest
    .fn<
      ReturnType<ReadConversationHistoryPage>,
      Parameters<ReadConversationHistoryPage>
    >()
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishOld = resolve;
        }),
    )
    .mockResolvedValueOnce({
      turns: [turn('fresh')],
      taskCards: [],
      nextCursor: cursor,
    });
  const f = setup(read);
  const pendingTaskRefresh = jest.fn(async () => {});
  const actions = conversationRecoveryActions({
    options: {},
    find: f.get,
    update: () => {},
    restoration: f.state,
    taskRefresh: {
      start: jest.fn(),
      has: () => true,
      retry: pendingTaskRefresh,
      invalidate: jest.fn(),
    },
    disposed: () => false,
  });
  const old = new AbortController();
  const current = new AbortController();
  const detached = f.state.start(1, 'durable', old.signal);
  old.abort();
  await actions.retryInitialRestore(1, 'wrong', current.signal);
  expect(read).toHaveBeenCalledTimes(1);
  await actions.retryInitialRestore(1, 'durable', current.signal);
  await actions.retryInitialRestore(1, 'durable', current.signal);
  expect(
    read.mock.calls.map(([id, , requestedCursor]) => [id, requestedCursor]),
  ).toEqual([
    ['durable', undefined],
    ['durable', undefined],
  ]);
  expect(pendingTaskRefresh).not.toHaveBeenCalled();
  expect(f.get().historyHasMore).toBe(true);
  finishOld({ turns: [turn('stale')], taskCards: [], nextCursor: null });
  await detached;
  expect(f.get().messages.map(message => message.content)).toEqual([
    'question fresh',
    'answer fresh',
  ]);
  await actions.retryRestore(1);
  expect(pendingTaskRefresh).toHaveBeenCalledTimes(1);
});
