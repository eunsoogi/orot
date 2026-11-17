import { createConversationSessions } from '../conversationSessions';
import { setup } from '../testSupport/continuousSessionFixture';
import { conversationComposerDisabled } from '../conversationComposerDisabled';
import type { ConversationHistoryPage } from '../conversationHistoryPage';

const empty: ConversationHistoryPage = {
  turns: [],
  taskCards: [],
  nextCursor: null,
};
const cursor = {
  id: 'older',
  createdAt: '2026-11-01T00:00:00Z',
  kind: 'turn' as const,
  version: 0,
};
const sender = () =>
  jest.fn(async () => ({
    status: 'answer' as const,
    answer: 'Synthetic answer',
    citations: [],
  }));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test.each(['manual', 'choice'] as const)(
  'explicit %s Send retries initial restore failure without an empty-history bypass',
  async mode => {
    const f = await setup();
    const read = jest
      .fn()
      .mockRejectedValueOnce(new Error('Synthetic initial read failure'))
      .mockResolvedValue(empty);
    const store = createConversationSessions({
      ...f.options,
      restoreSessionPage: read,
    });
    try {
      await store.synchronizeModel();
      const id = store.getSnapshot().activeId;
      const current = () =>
        store.getSnapshot().sessions.find(s => s.id === id)!;
      expect(current().restoreFailed).toBe(true);
      expect(conversationComposerDisabled(current(), store.continuous)).toBe(
        false,
      );
      const send = sender();
      store.setDraft(id, 'Synthetic draft');
      if (mode === 'manual') await store.send(id, send);
      else await store.sendPrompt(id, 'Synthetic choice', send);
      expect(read).toHaveBeenCalledTimes(2);
      expect(current().restoreFailed).toBe(false);
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      store.dispose();
      f.store.dispose();
      f.close();
    }
  },
);

test('Stop releases blocked context immediately; duplicate Send and late old SQL cannot dispatch or overwrite a retry', async () => {
  const f = await setup();
  let release!: (page: ConversationHistoryPage) => void;
  let oldSignal!: AbortSignal;
  const read = jest
    .fn()
    .mockResolvedValueOnce({ ...empty, nextCursor: cursor })
    .mockImplementationOnce((_id: string, signal: AbortSignal) => {
      oldSignal = signal;
      return new Promise<ConversationHistoryPage>(resolve => {
        release = resolve;
      });
    })
    .mockResolvedValue(empty);
  const steering = jest.fn(async () => []);
  const store = createConversationSessions({
    ...f.options,
    restoreSessionPage: read,
    restoreSteering: steering,
  });
  try {
    await store.synchronizeModel();
    const id = store.getSnapshot().activeId;
    const current = () => store.getSnapshot().sessions.find(s => s.id === id)!;
    const send = sender();
    store.setDraft(id, 'Synthetic stopped input');
    const pending = store.send(id, send);
    for (let i = 0; i < 30 && read.mock.calls.length < 2; i++) await tick();
    expect(current().preparingSend).toBe(true);
    await store.send(id, send);
    expect(read).toHaveBeenCalledTimes(2);
    store.cancel(id);
    await pending;
    expect(oldSignal.aborted).toBe(true);
    expect(current().preparingSend).toBe(false);
    expect(current().messages).toEqual([]);
    expect(current().draft).toBe('Synthetic stopped input');
    expect(current().error).toBe('');
    await store.send(id, send);
    expect(read).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenCalledTimes(1);
    const completed = current().messages;
    release({
      ...empty,
      turns: [
        {
          question: 'Stale secret',
          answer: 'Stale secret',
          citations: [],
          toolMessageId: 'stale-tool',
        },
      ],
    });
    await tick();
    expect(current().messages).toEqual(completed);
    expect(steering).not.toHaveBeenCalled();
    expect(JSON.stringify(current().messages)).not.toContain('Stale secret');
  } finally {
    store.dispose();
    f.store.dispose();
    f.close();
  }
});

test('Stop during model selection clears preparing state and fences a late model switch', async () => {
  const f = await setup();
  try {
    await f.store.synchronizeModel();
    const id = f.store.getSnapshot().activeId;
    let release!: () => void;
    const original = f.options.continuousSession;
    f.options.continuousSession = async signal => {
      await new Promise<void>(resolve => {
        release = resolve;
      });
      return original(signal);
    };
    const send = sender();
    f.store.setDraft(id, 'Synthetic pending selection');
    const pending = f.store.send(id, send);
    f.store.cancel(id);
    await pending;
    const current = f.store.getSnapshot().sessions.find(s => s.id === id)!;
    expect(current.preparingSend).toBe(false);
    expect(current.modelSelectionPending).toBe(false);
    expect(current.error).toBe('');
    release();
    await tick();
    expect(send).not.toHaveBeenCalled();
    expect(f.store.getSnapshot().activeId).toBe(id);
  } finally {
    f.store.dispose();
    f.close();
  }
});
