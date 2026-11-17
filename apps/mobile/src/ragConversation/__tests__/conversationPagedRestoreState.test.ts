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
    append: () => {
      session = {
        ...session,
        messages: [
          ...session.messages,
          { id: 100, role: 'user', content: 'new live input' },
        ],
      };
    },
  };
}

test('fetches one page, deduplicates in-flight requests, preserves visible ids and live appended input', async () => {
  let resolve!: (value: ConversationHistoryPage) => void;
  const read = jest
    .fn<
      ReturnType<ReadConversationHistoryPage>,
      Parameters<ReadConversationHistoryPage>
    >()
    .mockResolvedValueOnce({
      turns: [turn('new')],
      taskCards: [],
      nextCursor: cursor,
    })
    .mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
  const f = setup(read);
  await f.state.start(1, 'durable');
  expect(read).toHaveBeenCalledTimes(1);
  const visibleIds = f.get().messages.map(message => message.id);
  const one = f.state.loadOlder(1);
  const two = f.state.loadOlder(1);
  expect(one).toBe(two);
  f.append();
  resolve({
    turns: [turn('older'), turn('new')],
    taskCards: [],
    nextCursor: null,
  });
  await one;
  expect(f.get().messages.map(message => message.content)).toEqual([
    'question older',
    'answer older',
    'question new',
    'answer new',
    'new live input',
  ]);
  expect(
    f
      .get()
      .messages.slice(2, 4)
      .map(message => message.id),
  ).toEqual(visibleIds);
  expect(new Set(f.get().messages.map(message => message.id)).size).toBe(5);
  await f.state.loadOlder(1);
  expect(read).toHaveBeenCalledTimes(2);
});

test('failed page keeps the cursor and visible data, then retries the same boundary', async () => {
  const read = jest
    .fn<
      ReturnType<ReadConversationHistoryPage>,
      Parameters<ReadConversationHistoryPage>
    >()
    .mockResolvedValueOnce({
      turns: [turn('new')],
      taskCards: [],
      nextCursor: cursor,
    })
    .mockRejectedValueOnce(new Error('synthetic'))
    .mockResolvedValueOnce({
      turns: [turn('old')],
      taskCards: [],
      nextCursor: null,
    });
  const f = setup(read);
  await f.state.start(1, 'durable');
  await f.state.loadOlder(1);
  expect(f.get().historyLoadFailed).toBe(true);
  expect(f.get().messages).toHaveLength(2);
  await f.state.loadOlder(1);
  expect(read.mock.calls[1]?.[2]).toBe(cursor);
  expect(read.mock.calls[2]?.[2]).toBe(cursor);
  expect(f.get().historyHasMore).toBe(false);
});

test('session replacement and deletion discard late pages without resurrecting private content', async () => {
  let resolve!: (value: ConversationHistoryPage) => void;
  const read: ReadConversationHistoryPage = () =>
    new Promise(done => {
      resolve = done;
    });
  const f = setup(read);
  const pending = f.state.start(1, 'old');
  f.state.forget(1);
  resolve({ turns: [turn('late')], taskCards: [], nextCursor: null });
  await pending;
  expect(f.get().messages).toEqual([]);
});

test('model context loads older pages only until eight eligible messages exist', async () => {
  const read = jest
    .fn<
      ReturnType<ReadConversationHistoryPage>,
      Parameters<ReadConversationHistoryPage>
    >()
    .mockResolvedValueOnce({
      turns: [
        {
          ...turn('interrupted'),
          interrupted: true,
          answer: '',
          completion: 'partial',
        },
      ],
      taskCards: [],
      nextCursor: cursor,
    })
    .mockResolvedValueOnce({
      turns: ['a', 'b', 'c', 'd'].map(turn),
      taskCards: [],
      nextCursor: { ...cursor, id: 'older' },
    });
  const f = setup(read);
  await f.state.start(1, 'durable');
  expect(await f.state.prepareContext(1)).toBe(true);
  expect(read).toHaveBeenCalledTimes(2);
  expect(f.get().historyHasMore).toBe(true);
});

test('health deletion fences an in-flight older page while keeping a retryable cursor', async () => {
  let resolve!: (value: ConversationHistoryPage) => void;
  let signal!: AbortSignal;
  const read = jest
    .fn<
      ReturnType<ReadConversationHistoryPage>,
      Parameters<ReadConversationHistoryPage>
    >()
    .mockResolvedValueOnce({
      turns: [turn('new')],
      taskCards: [],
      nextCursor: cursor,
    })
    .mockImplementationOnce((_id, current) => {
      signal = current;
      return new Promise(done => {
        resolve = done;
      });
    })
    .mockResolvedValueOnce({ turns: [], taskCards: [], nextCursor: null });
  const f = setup(read);
  await f.state.start(1, 'durable');
  const pending = f.state.loadOlder(1);
  f.state.invalidatePage(1);
  expect(signal.aborted).toBe(true);
  resolve({ turns: [turn('deleted source')], taskCards: [], nextCursor: null });
  await pending;
  expect(f.get().messages.map(message => message.content)).toEqual([
    'question new',
    'answer new',
  ]);
  expect(f.get().historyLoadFailed).toBe(true);
  await f.state.loadOlder(1);
  expect(read.mock.calls[2]?.[2]).toBe(cursor);
});
