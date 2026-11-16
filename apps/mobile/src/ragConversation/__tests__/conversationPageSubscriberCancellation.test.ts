import { createConversationPagedRestoreState } from '../conversationPagedRestoreState';
import { createEmptyConversation } from '../conversationEmptySession';
import type { ConversationHistoryPage } from '../conversationHistoryPage';

test('a joining context wait cancels immediately without cancelling the scroll owner or advancing its cursor', async () => {
  let session = createEmptyConversation(1);
  let resolve!: (page: ConversationHistoryPage) => void;
  let pageSignal!: AbortSignal;
  const cursor = {
    createdAt: '2026-11-01T00:00:00.000Z',
    id: 'boundary',
    kind: 'turn' as const,
    version: 0,
  };
  const read = jest
    .fn()
    .mockResolvedValueOnce({ turns: [], taskCards: [], nextCursor: cursor })
    .mockImplementationOnce((_id: string, signal: AbortSignal) => {
      pageSignal = signal;
      return new Promise(done => {
        resolve = done;
      });
    });
  const state = createConversationPagedRestoreState({
    read,
    find: () => session,
    update: (_id, change) => {
      session = { ...session, ...change };
    },
  });
  await state.start(1, 'synthetic-session');
  const scrolling = state.loadOlder(1);
  const controller = new AbortController();
  const preparing = state.prepareContext(1, controller.signal);
  expect(read).toHaveBeenCalledTimes(2);
  controller.abort();
  await expect(preparing).resolves.toBe(false);
  expect(pageSignal.aborted).toBe(false);
  expect(session.historyLoading).toBe(true);
  resolve({
    turns: [
      {
        question: 'Synthetic question',
        answer: 'Synthetic answer',
        citations: [],
        toolMessageId: 'older',
        completion: 'complete',
      },
    ],
    taskCards: [],
    nextCursor: null,
  });
  await scrolling;
  expect(session.messages).toHaveLength(2);
  expect(session.historyHasMore).toBe(false);
  expect(session.historyLoading).toBe(false);
  state.dispose();
});
