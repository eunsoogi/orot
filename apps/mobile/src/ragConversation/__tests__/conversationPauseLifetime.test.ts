import { waitFor } from '@testing-library/react-native';
import { createConversationRequestLifetime } from '../conversationRequestLifetime';
import type { createConversationTurnRetention } from '../conversationTurnRetention';

const turn = () =>
  ({
    toolMessageId: 'original-request',
    startRequest: async () => {},
    interruptRequest: async () => {},
  }) as unknown as ReturnType<typeof createConversationTurnRetention>;

test('abort settles paused UI and a stale continue button cannot resurrect work', async () => {
  const state = jest.fn();
  const lifetime = createConversationRequestLifetime({
    interrupt: jest.fn(),
    reportFenceFailure: jest.fn(),
    pauseState: state,
  });
  const controller = new AbortController();
  await lifetime.start(1, controller, turn(), 'synthetic');
  const pending = lifetime.executionObserver(controller).onWorkflowPaused();
  await waitFor(() => expect(state).toHaveBeenCalled());
  const resume = state.mock.calls.at(-1)![1] as () => void;
  lifetime.interrupt(1, 'cancelled', true);
  controller.abort();
  await expect(pending).resolves.toBe(false);
  resume();
  expect(state).toHaveBeenLastCalledWith(1);
  await lifetime.settle(1, controller);
});

test('an explicit continuation can settle only once', async () => {
  const state = jest.fn();
  const lifetime = createConversationRequestLifetime({
    interrupt: jest.fn(),
    reportFenceFailure: jest.fn(),
    pauseState: state,
  });
  const controller = new AbortController();
  await lifetime.start(1, controller, turn(), 'synthetic');
  const pending = lifetime.executionObserver(controller).onWorkflowPaused();
  await waitFor(() => expect(state).toHaveBeenCalled());
  const resume = state.mock.calls.at(-1)![1] as () => void;
  resume();
  resume();
  await expect(pending).resolves.toBe(true);
  await lifetime.settle(1, controller);
});

test('queued expiration from a previous lease cannot interrupt a resumed request', async () => {
  const state = jest.fn(),
    interrupt = jest.fn();
  const listeners = new Set<
    (
      event: import('../conversationExecutionLease').ConversationExecutionEvent,
    ) => void
  >();
  const execution = {
    begin: jest.fn(async (_requestId: string) => true),
    end: jest.fn(),
    isActive: async () => true,
    protectedDataAvailable: async () => true,
    work: jest.fn(),
    milestone: jest.fn(),
    subscribe: (
      listener: (
        event: import('../conversationExecutionLease').ConversationExecutionEvent,
      ) => void,
    ) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const lifetime = createConversationRequestLifetime({
    execution,
    interrupt,
    reportFenceFailure: jest.fn(),
    pauseState: state,
  });
  const controller = new AbortController();
  await lifetime.start(1, controller, turn(), 'synthetic');
  const oldId = execution.begin.mock.calls[0]![0];
  const pending = lifetime.executionObserver(controller).onWorkflowPaused();
  await waitFor(() => expect(state).toHaveBeenCalled());
  state.mock.calls.at(-1)![1]();
  await expect(pending).resolves.toBe(true);
  const currentId = execution.begin.mock.calls[1]![0];
  expect(currentId).not.toBe(oldId);
  listeners.forEach(listener =>
    listener({ kind: 'expired', requestId: oldId }),
  );
  expect(interrupt).not.toHaveBeenCalled();
  lifetime.executionObserver(controller).onExecutionState('working');
  lifetime.answered(controller, true);
  expect(execution.work).toHaveBeenCalledWith(currentId, true);
  expect(execution.milestone).toHaveBeenLastCalledWith(currentId, 'committed');
  listeners.forEach(listener =>
    listener({ kind: 'expired', requestId: currentId }),
  );
  expect(interrupt).toHaveBeenCalledWith(1);
  await lifetime.settle(1, controller);
});
