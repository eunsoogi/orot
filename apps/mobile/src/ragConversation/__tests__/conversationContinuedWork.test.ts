import { createConversationRequestLifetime } from '../conversationRequestLifetime';
import type { Turn } from '../conversationLifetimeEntry';
import type { ConversationExecutionEvent } from '../conversationExecutionLease';

function setup(initial: 'active' | 'background' = 'active', admitted = true) {
  let phase = initial;
  let protectedData = true;
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
  const interrupt = jest.fn();
  let push: (event: ConversationExecutionEvent) => void = () => {};
  const life = createConversationRequestLifetime({
    execution: {
      begin: async () => admitted,
      end: jest.fn(),
      currentPhase: () => phase,
      protectedDataAvailable: async () => protectedData,
      isActive: async () => true,
      subscribe(listener) {
        push = listener;
        return () => {
          push = () => {};
        };
      },
      work,
    },
    interrupt,
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
    interrupt,
    event: (event: ConversationExecutionEvent) => push(event),
    requestId: () => work.mock.calls[0]?.[0] as string,
    lock: () => {
      protectedData = false;
    },
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

async function finishBridgeEvent() {
  // Drain the actual protection and lease checks before asserting admission.
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

test('a native inactive non-attempt waits for a later certified foreground', async () => {
  const f = setup();
  await f.finishStart();
  const requestId = f.requestId();
  f.event({
    kind: 'continued',
    requestId,
    state: 'continued-deferred-inactive',
  });
  f.observer.onExecutionState('working');
  f.event({ kind: 'foreground' });
  await finishBridgeEvent();
  expect(f.work.mock.calls).toEqual([[requestId, true]]);
  f.event({ kind: 'continuation-foreground' });
  await finishBridgeEvent();
  expect(f.work.mock.calls).toEqual([
    [requestId, true],
    [requestId, true],
  ]);
  f.event({ kind: 'continuation-foreground' });
  await finishBridgeEvent();
  expect(f.work).toHaveBeenCalledTimes(2);
});

test.each([
  'refused',
  'expired',
  'wrong-owner',
  'decision',
  'stop',
  'locked',
] as const)(
  'a %s event cannot turn into another native admission',
  async caseName => {
    const f = setup();
    await f.finishStart();
    const requestId = f.requestId();
    if (caseName === 'refused') {
      f.event({ kind: 'continued', requestId, state: 'continued-refused' });
    } else {
      f.event({
        kind: 'continued',
        requestId: caseName === 'wrong-owner' ? 'unowned' : requestId,
        state: 'continued-deferred-inactive',
      });
      if (caseName === 'expired') f.event({ kind: 'expired', requestId });
      if (caseName === 'decision') f.observer.onApprovalWait(true);
      if (caseName === 'stop') f.controller.abort();
      if (caseName === 'locked') f.lock();
    }
    f.event({ kind: 'continuation-foreground' });
    await finishBridgeEvent();
    expect(f.work.mock.calls.filter(([, active]) => active)).toEqual([
      [requestId, true],
    ]);
  },
);
