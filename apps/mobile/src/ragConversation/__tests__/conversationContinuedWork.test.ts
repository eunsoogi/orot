import { createConversationRequestLifetime } from '../conversationRequestLifetime';
import type { Turn } from '../conversationLifetimeEntry';

function setup(initial: 'active' | 'background' = 'active', admitted = true) {
  let phase = initial;
  let resolveStart!: () => void;
  const turn = {
    toolMessageId: 'synthetic',
    startRequest: () =>
      new Promise<void>(resolve => {
        resolveStart = resolve;
      }),
    interruptRequest: jest.fn(async () => {}),
  } as unknown as Turn;
  const work = jest.fn();
  const life = createConversationRequestLifetime({
    execution: {
      begin: async () => admitted,
      end: jest.fn(),
      currentPhase: () => phase,
      protectedDataAvailable: async () => true,
      isActive: async () => true,
      subscribe: () => () => {},
      work,
    },
    interrupt: jest.fn(),
    reportFenceFailure: jest.fn(),
  });
  const controller = new AbortController();
  const observer = life.executionObserver(controller);
  const start = life.start(1, controller, turn, 'synthetic');
  return {
    life,
    controller,
    observer,
    work,
    foreground: () => {
      phase = 'active';
    },
    async finishStart() {
      resolveStart();
      await start;
    },
  };
}

test('explicit durable submit admits once before any provider dispatch', async () => {
  const f = setup();
  f.observer.onExecutionState('local');
  expect(f.work).not.toHaveBeenCalled();
  await f.finishStart();
  expect(f.work).toHaveBeenCalledTimes(1);
  expect(f.work).toHaveBeenLastCalledWith(expect.any(String), true);
  f.observer.onExecutionState('local');
  f.observer.onExecutionState('working');
  expect(f.work).toHaveBeenCalledTimes(1);
});

test('decision revokes OS work and local activity cannot clear pending journal approval', async () => {
  const f = setup();
  await f.finishStart();
  f.observer.onApprovalWait(true);
  f.observer.onExecutionState('local');
  expect(f.work.mock.calls.map(([, value]) => value)).toEqual([true, false]);
  f.observer.onApprovalWait(false);
  f.observer.onExecutionState('working');
  expect(f.work.mock.calls.map(([, value]) => value)).toEqual([
    true,
    false,
    true,
  ]);
});

test('a backgrounded checkpoint and denied or stopped ownership cannot schedule work', async () => {
  const background = setup('background');
  await background.finishStart();
  expect(background.work).not.toHaveBeenCalled();
  background.foreground();
  expect(background.work).not.toHaveBeenCalled();

  const denied = setup('active', false);
  await denied.finishStart();
  denied.observer.onExecutionState('working');
  expect(denied.work).not.toHaveBeenCalled();

  const stopped = setup();
  stopped.controller.abort();
  await stopped.finishStart();
  expect(stopped.work).not.toHaveBeenCalled();
});
