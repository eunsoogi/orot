import { createConversationRequestLifetime } from '../conversationRequestLifetime';
import type { createConversationTurnRetention } from '../conversationTurnRetention';
import { interruptConversationLifetime } from '../conversationLifetimeInterruption';
import type { ConversationLifetimeEntry } from '../conversationLifetimeEntry';

// Deferred adapters distinguish revoked continued work from a still-pending durable fence.
test('Stop revokes continued work before a slow fence without releasing its storage lease', async () => {
  let finish!: () => void;
  const fence = new Promise<void>(resolve => {
    finish = resolve;
  });
  const execution = {
    begin: jest.fn(async () => true),
    end: jest.fn(),
    work: jest.fn(),
    isActive: async () => true,
    protectedDataAvailable: async () => true,
    subscribe: () => () => {},
  };
  const turn = {
    toolMessageId: 'synthetic-stop',
    startRequest: async () => {},
    interruptRequest: jest.fn(() => fence),
  } as unknown as ReturnType<typeof createConversationTurnRetention>;
  const life = createConversationRequestLifetime({
    execution,
    interrupt: jest.fn(),
    reportFenceFailure: jest.fn(),
  });
  const controller = new AbortController();
  await life.start(1, controller, turn, 'synthetic question');
  const observer = life.executionObserver(controller);
  observer.onExecutionState('working');
  const requestId = execution.work.mock.calls[0]![0];
  life.interrupt(1, 'cancelled');
  observer.onExecutionState('working'); // Reentrant bridge events before abort cannot regrant work.
  controller.abort();
  expect(execution.work.mock.calls).toEqual([
    [requestId, true],
    [requestId, false],
  ]);
  observer.onExecutionState('working');
  life.interrupt(1, 'cancelled');
  expect(execution.work).toHaveBeenCalledTimes(2);
  let settled = false;
  const pending = life.settle(1, controller).then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(execution.end).not.toHaveBeenCalled();
  finish();
  await pending;
  expect(turn.interruptRequest).toHaveBeenCalledWith(
    'interrupted',
    'user-stopped',
  );
  expect(execution.end).toHaveBeenCalledTimes(1);
});

test('bridge failure cannot bypass the initial-write fence or destructive abandonment', async () => {
  let start!: () => void;
  const interruptRequest = jest.fn(async () => {});
  const entry = {
    executionId: 'synthetic-owner',
    start: new Promise<void>(resolve => {
      start = resolve;
    }),
    turn: { interruptRequest },
    diagnose: jest.fn(),
  } as unknown as ConversationLifetimeEntry;
  const failure = jest.fn();
  const execution = {
    work: () => {
      throw new Error('Synthetic bridge failure');
    },
  };
  interruptConversationLifetime(
    entry,
    'cancelled',
    true,
    execution as never,
    failure,
  );
  expect(entry.status).toBe('cancelled');
  expect(interruptRequest).not.toHaveBeenCalled();
  start();
  await entry.fence;
  expect(interruptRequest).toHaveBeenCalledWith('cancelled', 'user-stopped');
  expect(failure).not.toHaveBeenCalled();
});

test('failed interruption storage is still reported after revoking work', async () => {
  const failure = jest.fn();
  const work = jest.fn();
  const entry = {
    executionId: 'synthetic-owner',
    interruptionReason: 'protected-data',
    turn: {
      interruptRequest: async () => {
        throw new Error('Synthetic write failure');
      },
    },
    diagnose: jest.fn(),
  } as unknown as ConversationLifetimeEntry;
  interruptConversationLifetime(
    entry,
    'interrupted',
    false,
    { work } as never,
    failure,
  );
  expect(work).toHaveBeenCalledWith('synthetic-owner', false);
  await entry.fence;
  expect(failure).toHaveBeenCalledTimes(1);
  expect(entry.interruptionReason).toBe('protected-data');
});

test('old cleanup cannot revoke a newer owner or replay late work', async () => {
  let finish!: () => void;
  const fence = new Promise<void>(resolve => {
    finish = resolve;
  });
  const execution = {
    begin: async () => true,
    end: jest.fn(),
    work: jest.fn(),
    isActive: async () => true,
    protectedDataAvailable: async () => true,
    subscribe: () => () => {},
  };
  const life = createConversationRequestLifetime({
    execution,
    interrupt: jest.fn(),
    reportFenceFailure: jest.fn(),
  });
  const turn = (toolMessageId: string, interruptRequest: () => Promise<void>) =>
    ({
      toolMessageId,
      startRequest: async () => {},
      interruptRequest,
    }) as unknown as ReturnType<typeof createConversationTurnRetention>;
  const old = new AbortController();
  await life.start(
    1,
    old,
    turn('old', () => fence),
    'synthetic',
  );
  const observer = life.executionObserver(old);
  observer.onExecutionState('working');
  life.interrupt(1, 'cancelled');
  old.abort();
  const current = new AbortController();
  await life.start(
    1,
    current,
    turn('new', async () => {}),
    'synthetic',
  );
  life.executionObserver(current).onExecutionState('working');
  const newerId = execution.work.mock.calls.at(-1)![0];
  const calls = execution.work.mock.calls.length;
  observer.onExecutionState('working');
  finish();
  await life.settle(1, old);
  expect(execution.work).toHaveBeenCalledTimes(calls);
  expect(execution.end).not.toHaveBeenCalledWith(newerId);
  expect(current.signal.aborted).toBe(false);
  await life.settle(1, current);
  expect(execution.end).toHaveBeenCalledWith(newerId);
});
