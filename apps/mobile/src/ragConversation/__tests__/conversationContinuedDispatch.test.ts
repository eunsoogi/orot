import { createConversationSessions } from '../conversationSessions';
import type { ConversationExecutionEvent } from '../conversationExecutionLease';
import type { ConversationSender } from '../conversationSessionTypes';
import { setup } from '../testSupport/continuousSessionFixture';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test.each(['granted', 'refused', 'stopped'] as const)(
  'one protected local-to-provider dispatch across background: %s',
  async mode => {
    const f = await setup();
    const atLocal = deferred();
    const finishLocal = deferred();
    const atProvider = deferred();
    const finishProvider = deferred();
    let phase: 'active' | 'background' = 'active';
    let emit!: (event: ConversationExecutionEvent) => void;
    const work = jest.fn<void, [string, boolean]>();
    const store = createConversationSessions({
      ...f.options,
      execution: {
        currentPhase: () => phase,
        begin: async () => true,
        end: jest.fn(),
        isActive: async () => true,
        protectedDataAvailable: async () => true,
        subscribe: listener => {
          emit = listener;
          return () => {};
        },
        work,
      },
    });
    try {
      await store.synchronizeModel();
      const id = store.getSnapshot().activeId;
      const provider = jest.fn(() => finishProvider.promise);
      const sender = jest.fn<
        ReturnType<ConversationSender>,
        Parameters<ConversationSender>
      >(async (_question, _history, signal, observer) => {
        expect(observer?.retentionRequestId).toBeTruthy();
        expect(work.mock.calls.filter(([, active]) => active)).toHaveLength(1);
        observer?.onExecutionState?.('local');
        atLocal.resolve();
        await finishLocal.promise;
        if (signal?.aborted) return { status: 'failure', kind: 'cancelled' };
        observer?.onExecutionState?.('working');
        atProvider.resolve();
        await provider();
        return { status: 'unavailable' };
      });
      const handle = store.sendOwnedPrompt(id, 'Synthetic request', sender);
      const identity = await handle.requestIdentity;
      expect(identity).not.toBeNull();
      await atLocal.promise;
      const [[requestId]] = work.mock.calls;
      emit({
        kind: 'continued',
        requestId,
        state: mode === 'granted' ? 'continued-granted' : 'continued-refused',
      });
      phase = 'background';
      emit({ kind: 'phase' });
      if (mode === 'stopped') store.cancel(id);
      finishLocal.resolve();
      if (mode !== 'stopped') {
        await atProvider.promise;
        phase = 'active';
        emit({ kind: 'continuation-foreground' });
      }
      finishProvider.resolve();
      await handle.completion;
      expect(sender).toHaveBeenCalledTimes(1);
      expect(provider).toHaveBeenCalledTimes(mode === 'stopped' ? 0 : 1);
      expect(work.mock.calls.filter(([, active]) => active)).toEqual([
        [requestId, true],
      ]);
    } finally {
      finishLocal.resolve();
      finishProvider.resolve();
      store.dispose();
      f.store.dispose();
      f.close();
    }
  },
);
