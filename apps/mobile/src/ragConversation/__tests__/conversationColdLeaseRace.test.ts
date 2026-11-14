import { waitFor } from '@testing-library/react-native';
import { createConversationRequestLifetime } from '../conversationRequestLifetime';
import type { ConversationExecutionEvent } from '../conversationExecutionLease';
import type { createConversationTurnRetention } from '../conversationTurnRetention';

function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
function turn(id: string) {
  return {
    toolMessageId: id,
    startRequest: jest.fn(async () => {}),
    interruptRequest: jest.fn(async () => {}),
  } as unknown as ReturnType<typeof createConversationTurnRetention>;
}
function fixture() {
  const listeners = new Set<(event: ConversationExecutionEvent) => void>();
  const execution = {
    begin: jest.fn(async (_id: string) => true),
    end: jest.fn(),
    isActive: async () => true,
    protectedDataAvailable: async () => true,
    subscribe(listener: (event: ConversationExecutionEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const interrupt = jest.fn(),
    pauseState = jest.fn();
  const lifetime = createConversationRequestLifetime({
    execution,
    interrupt,
    pauseState,
    reportFenceFailure: jest.fn(),
  });
  return {
    lifetime,
    execution,
    interrupt,
    pauseState,
    listeners,
    expire(id: string) {
      listeners.forEach(listener =>
        listener({ kind: 'expired', requestId: id }),
      );
    },
  };
}

/** Synthetic delayed native bridge; no OS or device claims are made by this regression. */
test('late native lease from cold Continue cannot interrupt a new owner or clear its pause action', async () => {
  const f = fixture();
  const old = new AbortController();
  await f.lifetime.resume(1, old, turn('old-request'), 7);
  expect(f.execution.begin.mock.calls[0][0]).toBe('old-request:cold:1:7:1');
  const waiting = f.lifetime.executionObserver(old).onWorkflowPaused();
  await waitFor(() =>
    expect(f.pauseState.mock.calls.at(-1)?.[1]).toEqual(expect.any(Function)),
  );
  const pending = deferred();
  f.execution.begin.mockImplementationOnce(() => pending.promise);
  f.pauseState.mock.calls.at(-1)![1]();
  await waitFor(() => expect(f.execution.begin).toHaveBeenCalledTimes(2));
  const oldLease = f.execution.begin.mock.calls[1][0];
  expect(oldLease).toBe('old-request:cold:1:7:2');
  f.lifetime.interrupt(1, 'cancelled');
  old.abort();
  await expect(waiting).resolves.toBe(false);
  await f.lifetime.settle(1, old);

  const current = new AbortController();
  await f.lifetime.resume(1, current, turn('new-request'), 8);
  const currentWaiting = f.lifetime
    .executionObserver(current)
    .onWorkflowPaused();
  await waitFor(() =>
    expect(f.pauseState.mock.calls.at(-1)?.[1]).toEqual(expect.any(Function)),
  );
  const newPauseAction = f.pauseState.mock.calls.at(-1)![1];
  const pauseCount = f.pauseState.mock.calls.length;
  // Old begin has not resolved, so its subscription cannot yet have been released by the caller.
  f.expire(oldLease);
  expect(f.interrupt).not.toHaveBeenCalled();
  pending.resolve(true);
  await waitFor(() => expect(f.execution.end).toHaveBeenCalledWith(oldLease));
  expect(f.pauseState).toHaveBeenCalledTimes(pauseCount);
  expect(f.pauseState.mock.calls.at(-1)![1]).toBe(newPauseAction);
  expect(current.signal.aborted).toBe(false);
  current.abort();
  await expect(currentWaiting).resolves.toBe(false);
  await f.lifetime.settle(1, current);
  expect(f.listeners.size).toBe(0);
});

test.each(['start', 'resume'] as const)(
  '%s releases a late attached lease after Stop/settle without disturbing replacement owner',
  async mode => {
    const f = fixture();
    const pending = deferred();
    f.execution.begin.mockImplementationOnce(() => pending.promise);
    const old = new AbortController();
    const oldTurn = turn('old-request');
    const attaching =
      mode === 'start'
        ? f.lifetime.start(1, old, oldTurn, 'synthetic')
        : f.lifetime.resume(1, old, oldTurn, 3);
    await waitFor(() => expect(f.execution.begin).toHaveBeenCalledTimes(1));
    const oldLease = f.execution.begin.mock.calls[0][0];
    f.lifetime.interrupt(1, 'cancelled');
    old.abort();
    await f.lifetime.settle(1, old);
    const current = new AbortController();
    await f.lifetime.resume(1, current, turn('new-request'), 4);
    const newLease = f.execution.begin.mock.calls[1][0];
    f.expire(oldLease);
    expect(f.interrupt).not.toHaveBeenCalled();
    pending.resolve(true);
    await attaching;
    expect(f.execution.end).toHaveBeenCalledWith(oldLease);
    expect(f.execution.end).not.toHaveBeenCalledWith(newLease);
    expect(f.listeners.size).toBe(1);
    if (mode === 'resume') expect(oldTurn.startRequest).not.toHaveBeenCalled();
    f.expire(newLease);
    expect(f.interrupt).toHaveBeenCalledTimes(1);
    expect(f.interrupt).toHaveBeenCalledWith(1);
    current.abort();
    await f.lifetime.settle(1, current);
    expect(f.listeners.size).toBe(0);
  },
);
