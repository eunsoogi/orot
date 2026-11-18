import {
  createConversationArchive,
  withConversationArchive,
} from '../conversationArchive';
import type { ConversationHistoryPage } from '../conversationHistoryPage';

const metadata = {
  id: 'old-a',
  version: 0,
  updatedAt: '2026-10-01T00:00:00.000Z',
};
const page: ConversationHistoryPage = {
  turns: [
    {
      question: 'Synthetic old A question',
      answer: 'Synthetic old A answer',
      citations: [],
      toolMessageId: 'turn-a',
      coldResume: { attempt: 2 },
    },
  ],
  taskCards: [],
  nextCursor: null,
};
const listSessions = jest.fn(async () => ({
  items: [metadata],
  nextCursor: null,
}));

test('only metadata is listed; selected strict page becomes capability-free text without dispatch selection', async () => {
  const restoreSessionPage = jest.fn(async () => page);
  const dispatch = {
    refreshAfterSourceDeletion: jest.fn(),
    invalidateAll: jest.fn(),
    dispose: jest.fn(),
    synchronizeModel: jest.fn(async () => {}),
  };
  const store = withConversationArchive(dispatch, {
    listSessions,
    restoreSessionPage,
  });
  await store.archive.list();
  expect(restoreSessionPage).not.toHaveBeenCalled();
  await store.archive.select('old-a');
  expect(restoreSessionPage).toHaveBeenCalledTimes(1);
  expect(store.archive.getSnapshot().lines).toEqual([
    { key: 1, role: 'user', content: 'Synthetic old A question' },
    { key: 2, role: 'assistant', content: 'Synthetic old A answer' },
  ]);
  expect(dispatch.synchronizeModel).not.toHaveBeenCalled();
  expect(dispatch.invalidateAll).not.toHaveBeenCalled();
  store.dispose();
});

test.each(['invalidate', 'dispose', 'model', 'source', 'clear'] as const)(
  '%s clears content and fences a late page even if the adapter ignores cancellation',
  async kind => {
    let release!: (value: ConversationHistoryPage) => void;
    const read = jest.fn(
      (_id: string, _signal: AbortSignal) =>
        new Promise<ConversationHistoryPage>(resolve => {
          release = resolve;
        }),
    );
    const store = withConversationArchive(
      {
        refreshAfterSourceDeletion: jest.fn(),
        invalidateAll: jest.fn(),
        dispose: jest.fn(),
        synchronizeModel: jest.fn(async () => {}),
      },
      { listSessions, restoreSessionPage: read },
    );
    await store.archive.list();
    const pending = store.archive.select('old-a');
    if (kind === 'model') await store.synchronizeModel(true);
    else if (kind === 'source') store.refreshAfterSourceDeletion();
    else if (kind === 'clear') store.invalidateAll();
    else store.archive[kind]();
    release(page);
    await pending;
    expect(store.archive.getSnapshot().lines).toEqual([]);
    expect(store.archive.getSnapshot().selected).toBeNull();
    expect(read.mock.calls[0]?.[1]?.aborted).toBe(true);
  },
);

test('withheld history never exposes the original question, preview, or action identities; errors are retryable', async () => {
  const read = jest
    .fn()
    .mockRejectedValueOnce(new Error('temporary'))
    .mockResolvedValueOnce({
      ...page,
      turns: [
        {
          ...page.turns[0],
          question: 'withheld',
          preview: 'withheld',
          answer: 'Unavailable notice',
          historyUnavailable: true,
        },
      ],
    });
  const archive = createConversationArchive({
    listSessions,
    restoreSessionPage: read,
  });
  await archive.list();
  await archive.select('old-a');
  expect(archive.getSnapshot().failed).toBe(true);
  await archive.loadOlder();
  expect(archive.getSnapshot().lines).toEqual([
    { key: 1, role: 'assistant', content: 'Unavailable notice' },
  ]);
  expect(archive.getSnapshot().failed).toBe(false);
  archive.invalidate();
  await archive.list();
  expect(archive.getSnapshot().lines).toEqual([]);
});

test('older pages prepend with stable display keys and one in-flight page', async () => {
  const cursor = {
    id: 'older',
    kind: 'turn' as const,
    version: 0,
    createdAt: '2026-09-30T00:00:00.000Z',
  };
  let finish!: (value: ConversationHistoryPage) => void;
  const read = jest
    .fn()
    .mockResolvedValueOnce({ ...page, nextCursor: cursor })
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
  const archive = createConversationArchive({
    listSessions,
    restoreSessionPage: read,
  });
  await archive.list();
  await archive.select('old-a');
  const recent = archive.getSnapshot().lines;
  const pending = archive.loadOlder();
  await archive.loadOlder();
  expect(read).toHaveBeenCalledTimes(2);
  finish({
    ...page,
    turns: [{ question: 'Earlier', answer: 'Earlier reply', citations: [] }],
  });
  await pending;
  expect(archive.getSnapshot().lines.slice(2)).toEqual(recent);
  expect(new Set(archive.getSnapshot().lines.map(line => line.key)).size).toBe(
    4,
  );
  await archive.loadOlder();
  expect(read).toHaveBeenCalledTimes(2);
});

test('historical nonempty partial answers are not newly classified as interrupted', async () => {
  const archive = createConversationArchive({
    listSessions,
    restoreSessionPage: async () => ({
      ...page,
      turns: [
        {
          question: 'Historical',
          answer: 'Saved text',
          completion: 'partial',
          citations: [],
        },
        { question: 'Empty', answer: '', completion: 'partial', citations: [] },
        {
          question: 'Interrupted',
          answer: 'Draft',
          interrupted: true,
          citations: [],
        },
      ],
    }),
  });
  await archive.list();
  await archive.select('old-a');
  const text = archive.getSnapshot().lines.map(line => line.content);
  expect(text.slice(0, 2)).toEqual(['Historical', 'Saved text']);
  expect(
    text.filter(content => content === '완료되지 않은 응답이에요.'),
  ).toHaveLength(2);
});

test('validated full answers take precedence over a distinct saved preview', async () => {
  const archive = createConversationArchive({
    listSessions,
    restoreSessionPage: async () => ({
      ...page,
      turns: [
        {
          question: 'Complete',
          answer: 'Full saved answer',
          preview: 'Short preview',
          citations: [],
        },
        {
          question: 'Interrupted',
          answer: '',
          preview: 'Only available preview',
          interrupted: true,
          citations: [],
        },
        {
          question: 'Withheld question',
          answer: 'Unavailable notice',
          preview: 'Withheld preview',
          historyUnavailable: true,
          citations: [],
        },
      ],
    }),
  });
  await archive.list();
  await archive.select('old-a');
  const text = archive.getSnapshot().lines.map(line => line.content);
  expect(text).toContain('Full saved answer');
  expect(text).not.toContain('Short preview');
  expect(text).toContain('Only available preview');
  expect(text).not.toContain('Withheld question');
  expect(text).not.toContain('Withheld preview');
  expect(text).toContain('Unavailable notice');
});
