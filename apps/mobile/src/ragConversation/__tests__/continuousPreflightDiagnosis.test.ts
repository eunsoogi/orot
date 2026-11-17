import { createConversationSessions } from '../conversationSessions';
import { setup } from '../testSupport/continuousSessionFixture';
import type { ConversationHistoryPage } from '../conversationHistoryPage';
import { conversationHistoryRecoveryProps } from '../conversationHistoryRecoveryProps';

const cursor = {
  id: 'older',
  createdAt: '2026-11-01T00:00:00Z',
  kind: 'turn' as const,
  version: 0,
};
const turn = {
  question: 'Synthetic prior question',
  answer: '',
  citations: [],
  toolMessageId: 'prior',
  interrupted: true as const,
  completion: 'partial' as const,
};
const page = (
  turns: ConversationHistoryPage['turns'],
  more = false,
): ConversationHistoryPage => ({
  turns,
  taskCards: [],
  nextCursor: more ? cursor : null,
});
const sender = () =>
  jest.fn(async () => ({
    status: 'answer' as const,
    answer: 'Synthetic answer',
    citations: [],
  }));

// Synthetic preflight coverage keeps restore recovery separate from provider execution.
test.each(['empty', 'interrupted', 'failed', 'quarantined'] as const)(
  'exhausted %s history alone does not prevent dispatch',
  async kind => {
    const f = await setup();
    const turns =
      kind === 'empty'
        ? []
        : [
            {
              ...turn,
              ...(kind === 'failed' ? { interrupted: undefined } : {}),
              ...(kind === 'quarantined'
                ? { question: '', answer: 'Synthetic unavailable: regenerate' }
                : {}),
            },
          ];
    const read = jest.fn().mockResolvedValue(page(turns));
    const store = createConversationSessions({
      ...f.options,
      restoreSessionPage: read,
    });
    try {
      await store.synchronizeModel();
      const id = store.getSnapshot().activeId;
      const send = sender();
      store.setDraft(id, 'Synthetic new input');
      await store.send(id, send);
      expect(send).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      store.dispose();
      f.store.dispose();
      f.close();
    }
  },
);

test('a failed older-page retry preserves input and shows an error, then a later Send retries', async () => {
  const f = await setup();
  const read = jest
    .fn()
    .mockResolvedValueOnce(page([turn], true))
    .mockRejectedValueOnce(new Error('Synthetic transient read failure'))
    .mockRejectedValueOnce(new Error('Synthetic retry read failure'))
    .mockResolvedValue(page([]));
  const store = createConversationSessions({
    ...f.options,
    restoreSessionPage: read,
  });
  try {
    await store.synchronizeModel();
    const id = store.getSnapshot().activeId;
    const current = () => store.getSnapshot().sessions.find(s => s.id === id)!;
    const send = sender();
    store.setDraft(id, 'Synthetic unsent draft');
    const before = current().messages;
    await store.send(id, send);
    expect(current().historyLoadFailed).toBe(true);
    expect(read).toHaveBeenCalledTimes(3);
    expect(send).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(3);
    expect(current().messages).toEqual(before);
    expect(current().draft).toBe('Synthetic unsent draft');
    expect(current().busy).toBe(false);
    expect(current().error).toContain('전송하지 않았어요');
    expect(current().modelSelectionPending).toBe(false);
    await store.send(id, send);
    expect(read).toHaveBeenCalledTimes(4);
    expect(current().historyLoadFailed).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    store.dispose();
    f.store.dispose();
    f.close();
  }
});

test('older context loading exposes cancellable preparation without inventing a bubble', async () => {
  const f = await setup();
  let release!: (page: ConversationHistoryPage) => void;
  const read = jest
    .fn()
    .mockResolvedValueOnce(page([turn], true))
    .mockImplementationOnce(
      () =>
        new Promise<ConversationHistoryPage>(resolve => {
          release = resolve;
        }),
    );
  const store = createConversationSessions({
    ...f.options,
    restoreSessionPage: read,
  });
  try {
    await store.synchronizeModel();
    const id = store.getSnapshot().activeId;
    const current = () => store.getSnapshot().sessions.find(s => s.id === id)!;
    const send = sender();
    store.setDraft(id, 'Synthetic pending draft');
    const before = current().messages;
    const pending = store.send(id, send);
    for (let i = 0; i < 30 && read.mock.calls.length < 2; i++)
      await new Promise(resolve => setTimeout(resolve, 0));
    expect(read).toHaveBeenCalledTimes(2);
    expect(current().historyLoading).toBe(true);
    expect(current().preparingSend).toBe(true);
    expect(current().modelSelectionPending).toBe(false);
    expect(current().busy).toBe(false);
    expect(current().messages).toEqual(before);
    expect(current().draft).toBe('Synthetic pending draft');
    expect(send).not.toHaveBeenCalled();
    expect(conversationHistoryRecoveryProps(current(), store).restoring).toBe(
      false,
    );
    release(page([]));
    await pending;
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    store.dispose();
    f.store.dispose();
    f.close();
  }
});
