import { waitFor } from '@testing-library/react-native';
import { createConversationRequestLifetime } from '../conversationRequestLifetime';
import type { ConversationExecutionEvent } from '../conversationExecutionLease';
import type { Turn } from '../conversationLifetimeEntry';

async function fixture() {
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
  const turn = {
    toolMessageId: 'synthetic-owned-request',
    startRequest: async () => {},
    interruptRequest: jest.fn(async () => {}),
  } as unknown as Turn;
  const pauseState = jest.fn();
  const lifetime = createConversationRequestLifetime({
    execution,
    pauseState,
    interrupt: id => lifetime.interrupt(id, 'interrupted'),
    reportFenceFailure: jest.fn(),
  });
  const controller = new AbortController();
  await lifetime.start(1, controller, turn, 'synthetic');
  return {
    lifetime,
    controller,
    turn,
    pauseState,
    observer: lifetime.executionObserver(controller),
    emit(kind: 'pause-requested' | 'expired') {
      listeners.forEach(listener =>
        listener({ kind, requestId: execution.begin.mock.calls.at(-1)![0] }),
      );
    },
  };
}

test('an advisory pause before workflow registration is delivered once to that owner', async () => {
  const f = await fixture();
  f.emit('pause-requested');
  f.emit('pause-requested');
  const pause = jest.fn();
  f.observer.onWorkflowPauseController(pause);
  expect(pause).toHaveBeenCalledTimes(1);
  f.observer.onWorkflowPauseController(pause);
  expect(pause).toHaveBeenCalledTimes(1);
  await f.lifetime.settle(1, f.controller);
});

test.each(['abort', 'stop', 'expire', 'settle', 'replace'] as const)(
  'a queued advisory pause cannot revive an owner after %s',
  async ending => {
    const f = await fixture();
    f.emit('pause-requested');
    if (ending === 'abort') f.controller.abort();
    if (ending === 'stop') f.lifetime.interrupt(1, 'cancelled');
    if (ending === 'expire') f.emit('expired');
    if (ending === 'settle') await f.lifetime.settle(1, f.controller);
    const replacement = new AbortController();
    if (ending === 'replace')
      await f.lifetime.start(1, replacement, f.turn, 'synthetic replacement');
    const pause = jest.fn();
    f.observer.onWorkflowPauseController(pause);
    expect(pause).not.toHaveBeenCalled();
    await f.lifetime.settle(1, f.controller);
    if (ending === 'replace') await f.lifetime.settle(1, replacement);
  },
);

test('a new lease pause while continuation prepares reaches the new controller, not the drained one', async () => {
  const f = await fixture();
  const oldPause = jest.fn();
  f.observer.onWorkflowPauseController(oldPause);
  f.emit('pause-requested');
  expect(oldPause).toHaveBeenCalledTimes(1);
  const waiting = f.observer.onWorkflowPaused();
  await waitFor(() => expect(f.pauseState).toHaveBeenCalled());
  f.pauseState.mock.calls.at(-1)![1]();
  await expect(waiting).resolves.toBe(true);
  f.emit('pause-requested');
  expect(oldPause).toHaveBeenCalledTimes(1);
  const nextPause = jest.fn();
  f.observer.onWorkflowPauseController(nextPause);
  expect(nextPause).toHaveBeenCalledTimes(1);
  await f.lifetime.settle(1, f.controller);
});
