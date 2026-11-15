import { waitFor } from '@testing-library/react-native';
import { createConversationRequestLifetime } from '../conversationRequestLifetime';
import type { ConversationExecutionEvent } from '../conversationExecutionLease';
import type { createConversationTurnRetention } from '../conversationTurnRetention';

async function setup() {
  let phase: 'active' | 'background' = 'active';
  const listeners = new Set<(event: ConversationExecutionEvent) => void>();
  const state = jest.fn(),
    interrupt = jest.fn(),
    pause = jest.fn();
  const execution = {
    begin: jest.fn(async (_id: string) => true),
    end: jest.fn(),
    isActive: async () => true,
    protectedDataAvailable: async () => true,
    currentPhase: () => phase,
    subscribe(listener: (event: ConversationExecutionEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const turn = {
    toolMessageId: 'original',
    startRequest: async () => {},
    interruptRequest: jest.fn(async () => {}),
  } as unknown as ReturnType<typeof createConversationTurnRetention>;
  const controller = new AbortController();
  const lifetime = createConversationRequestLifetime({
    execution,
    interrupt,
    pauseState: state,
    reportFenceFailure: jest.fn(),
  });
  await lifetime.start(1, controller, turn, 'synthetic');
  const observer = lifetime.executionObserver(controller);
  observer.onWorkflowPauseController(pause);
  return {
    lifetime,
    observer,
    controller,
    pause,
    interrupt,
    state,
    execution,
    background() {
      phase = 'background';
      listeners.forEach(fn => fn({ kind: 'phase' }));
    },
    expire() {
      listeners.forEach(fn =>
        fn({
          kind: 'expired',
          requestId: execution.begin.mock.calls.at(-1)![0],
        }),
      );
    },
  };
}

test('journaled approval backgrounds into safe pause and only an explicit tap continues', async () => {
  const f = await setup();
  f.observer.onApprovalWait(true);
  f.observer.onExecutionState('decision');
  f.background();
  expect(f.pause).toHaveBeenCalledTimes(1);
  expect(f.interrupt).not.toHaveBeenCalled();
  f.observer.onApprovalWait(false);
  const waiting = f.observer.onWorkflowPaused();
  await waitFor(() => expect(f.state).toHaveBeenCalled());
  expect(f.controller.signal.aborted).toBe(false);
  f.state.mock.calls.at(-1)![1]();
  await expect(waiting).resolves.toBe(true);
  expect(f.execution.begin).toHaveBeenCalledTimes(2);
  f.expire();
  expect(f.interrupt).toHaveBeenCalledWith(1);
  await f.lifetime.settle(1, f.controller);
});

test('unsupported approval still hard interrupts even with a pause controller', async () => {
  const f = await setup();
  f.observer.onExecutionState('decision');
  f.background();
  expect(f.pause).not.toHaveBeenCalled();
  expect(f.interrupt).toHaveBeenCalledWith(1);
  await f.lifetime.settle(1, f.controller);
});

test('Stop prevents late approval state or stale continuation from reviving work', async () => {
  const f = await setup();
  f.observer.onApprovalWait(true);
  f.background();
  f.observer.onApprovalWait(false);
  const waiting = f.observer.onWorkflowPaused();
  await waitFor(() => expect(f.state).toHaveBeenCalled());
  const resume = f.state.mock.calls.at(-1)![1];
  f.lifetime.interrupt(1, 'cancelled');
  f.controller.abort();
  await expect(waiting).resolves.toBe(false);
  const count = f.pause.mock.calls.length;
  f.observer.onApprovalWait(true);
  resume();
  expect(f.pause).toHaveBeenCalledTimes(count);
  expect(f.execution.begin).toHaveBeenCalledTimes(1);
  await f.lifetime.settle(1, f.controller);
});
