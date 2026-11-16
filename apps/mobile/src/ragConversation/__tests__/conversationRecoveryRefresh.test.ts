import { createConversationRecoveryRefresh } from '../conversationRecoveryRefresh';
import type {
  ConversationSession,
  ConversationSessionOptions,
} from '../conversationSessionTypes';
function fixture() {
  let session: ConversationSession = {
    id: 1,
    title: 'Synthetic',
    createdAt: '',
    error: '',
    pendingMessage: null,
    busy: false,
    draft: '',
    messages: [
      {
        id: 2,
        role: 'assistant',
        content: '',
        incomplete: true,
        interruptionReason: 'expired',
        toolMessageId: 'request-1',
      },
    ],
  };
  let lease = { id: 'session-1', version: 3 };
  let disposed = false;
  const inspect = jest.fn(async () => ({ attempt: 2 }));
  const update = jest.fn(
    (_id: number, change: Partial<ConversationSession>) => {
      session = { ...session, ...change };
    },
  );
  const refresh = createConversationRecoveryRefresh({
    options: {
      retention: { activeLease: () => lease },
      coldResume: { inspect },
    } as unknown as ConversationSessionOptions,
    find: () => session,
    update,
    disposed: () => disposed,
  });
  return {
    refresh,
    inspect,
    update,
    get: () => session,
    set: (next: ConversationSession) => {
      session = next;
    },
    invalidateLease: () => {
      lease = { ...lease, version: 4 };
    },
    dispose: () => {
      disposed = true;
    },
  };
}
test('publishes only a validated existing checkpoint without changing transcript or draft', async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  expect(await f.refresh(1, signal)).toBe(true);
  expect(f.inspect).toHaveBeenCalledWith(
    { sessionId: 'session-1', sessionVersion: 3, requestId: 'request-1' },
    signal,
  );
  expect(f.get().messages[0]?.coldResume).toEqual({ attempt: 2 });
  expect(Object.keys(f.update.mock.calls[0]![1])).toEqual(['messages']);
});
test.each(['busy', 'stopped', 'aborted'] as const)(
  'does not inspect %s requests',
  async mode => {
    const f = fixture();
    const controller = new AbortController();
    if (mode === 'busy') f.set({ ...f.get(), busy: true });
    if (mode === 'stopped')
      f.set({
        ...f.get(),
        messages: [
          { ...f.get().messages[0]!, interruptionReason: 'user-stopped' },
        ],
      });
    if (mode === 'aborted') controller.abort();
    expect(await f.refresh(1, controller.signal)).toBe(false);
    expect(f.inspect).not.toHaveBeenCalled();
  },
);
test.each(['message', 'lease', 'busy', 'disposed', 'aborted'] as const)(
  'refuses a late result after %s changes',
  async mode => {
    const f = fixture();
    const controller = new AbortController();
    f.inspect.mockImplementation(async () => {
      if (mode === 'message')
        f.set({ ...f.get(), messages: [...f.get().messages] });
      if (mode === 'lease') f.invalidateLease();
      if (mode === 'busy') f.set({ ...f.get(), busy: true });
      if (mode === 'disposed') f.dispose();
      if (mode === 'aborted') controller.abort();
      return { attempt: 2 };
    });
    expect(await f.refresh(1, controller.signal)).toBe(false);
    expect(f.update).not.toHaveBeenCalled();
  },
);
