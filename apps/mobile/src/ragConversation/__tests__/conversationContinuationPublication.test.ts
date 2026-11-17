import { createConversationRequestLifetime } from '../conversationRequestLifetime';
import type { Turn } from '../conversationLifetimeEntry';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

// Exercise the real persistence-to-paused-UI gap, not a synthetic renderer replacement.
test.each(['replacement', 'stop', 'abort', 'settle'] as const)(
  'late pause persistence after %s never publishes an obsolete Continue action',
  async ending => {
    const saved = deferred();
    const pauseState = jest.fn();
    const lifetime = createConversationRequestLifetime({
      interrupt: jest.fn(),
      reportFenceFailure: jest.fn(),
      pauseState,
    });
    const original = new AbortController();
    const turn = {
      toolMessageId: 'synthetic-original',
      startRequest: async () => {},
      interruptRequest: () => saved.promise,
    } as unknown as Turn;
    await lifetime.start(1, original, turn, 'synthetic');
    const pending = lifetime.executionObserver(original).onWorkflowPaused();
    const replacement = new AbortController();
    if (ending === 'replacement')
      await lifetime.start(1, replacement, turn, 'synthetic replacement');
    if (ending === 'stop') lifetime.interrupt(1, 'cancelled');
    if (ending === 'abort') original.abort();
    if (ending === 'settle') await lifetime.settle(1, original);
    saved.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    try {
      expect(pauseState).not.toHaveBeenCalled();
      await expect(pending).resolves.toBe(false);
    } finally {
      original.abort();
      await pending;
      await lifetime.settle(1, original);
      if (ending === 'replacement') await lifetime.settle(1, replacement);
    }
  },
);

async function resumable() {
  const lease = deferred();
  const execution = {
    begin: jest.fn(async (_id: string) => true),
    end: jest.fn(),
    isActive: async () => true,
    protectedDataAvailable: async () => true,
    subscribe: () => () => {},
  };
  const pauseState = jest.fn();
  const lifetime = createConversationRequestLifetime({
    execution,
    interrupt: id => lifetime.interrupt(id, 'interrupted'),
    reportFenceFailure: jest.fn(),
    pauseState,
  });
  const controller = new AbortController();
  const turn = {
    toolMessageId: 'synthetic-resume',
    startRequest: async () => {},
    interruptRequest: async () => {},
  } as unknown as Turn;
  await lifetime.start(1, controller, turn, 'synthetic');
  const pending = lifetime.executionObserver(controller).onWorkflowPaused();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  return {
    lifetime,
    controller,
    pending,
    execution,
    pauseState,
    lease,
    resume: pauseState.mock.calls[0]![1] as () => void,
  };
}

test('Stop before a retained Continue tap rejects it without acquiring a new lease', async () => {
  const f = await resumable();
  f.lifetime.interrupt(1, 'cancelled');
  f.resume();
  await expect(f.pending).resolves.toBe(false);
  expect(f.execution.begin).toHaveBeenCalledTimes(1);
  await f.lifetime.settle(1, f.controller);
});

test('reentrant Stop while clearing Continue UI cannot begin a lease', async () => {
  const f = await resumable();
  f.pauseState.mockImplementation(() => f.lifetime.interrupt(1, 'cancelled'));
  f.resume();
  await expect(f.pending).resolves.toBe(false);
  expect(f.execution.begin).toHaveBeenCalledTimes(1);
  await f.lifetime.settle(1, f.controller);
});

test('a terminal owner cannot resume after its delayed lease acquisition completes', async () => {
  const f = await resumable();
  f.execution.begin.mockImplementationOnce(async () => {
    await f.lease.promise;
    return true;
  });
  f.resume();
  await Promise.resolve();
  await Promise.resolve();
  expect(f.execution.begin).toHaveBeenCalledTimes(2);
  const acquiredId = f.execution.begin.mock.calls[1]![0];
  f.lifetime.interrupt(1, 'cancelled');
  f.lease.resolve();
  await expect(f.pending).resolves.toBe(false);
  expect(
    f.execution.end.mock.calls.filter(([id]) => id === acquiredId),
  ).toHaveLength(1);
  await f.lifetime.settle(1, f.controller);
});

test('final UI cleanup cannot return a successful continuation after reentrant Stop', async () => {
  const f = await resumable();
  let clears = 0;
  f.pauseState.mockImplementation(() => {
    if (++clears === 2) f.lifetime.interrupt(1, 'cancelled');
  });
  f.resume();
  await expect(f.pending).resolves.toBe(false);
  expect(f.execution.begin).toHaveBeenCalledTimes(2);
  await f.lifetime.settle(1, f.controller);
});
