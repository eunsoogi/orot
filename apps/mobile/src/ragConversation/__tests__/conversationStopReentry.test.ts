import { createConversationActivity } from '../conversationActivity';
import { createConversationStopHandler } from '../conversationStoppedTurn';
import type {
  ConversationSession,
  PendingTurn,
} from '../conversationSessionTypes';

function setup(saving = false) {
  const controller = new AbortController();
  const controllers = new Map([[1, controller]]);
  const turn = saving ? ({ saving: true } as PendingTurn) : undefined;
  const pendingTurns = new Map<number, PendingTurn>(turn ? [[1, turn]] : []);
  const retainPartial = jest.fn();
  const finish = jest.fn();
  const clear = jest.fn();
  const update = jest.fn();
  const snapshots = new Map([[1, createConversationActivity(1, 2)]]);
  const stop = createConversationStopHandler({
    controllers,
    pendingTurns,
    snapshots,
    activities: new Map([[1, { finish } as never]]),
    steering: { clear, dispose: jest.fn() },
    lifetime: {
      status: () => undefined,
      interrupt: jest.fn(),
      interruptionReason: () => undefined,
    } as unknown as Parameters<
      typeof createConversationStopHandler
    >[0]['lifetime'],
    find: () => ({ messages: [], draft: '' }) as unknown as ConversationSession,
    update,
    retainPartial,
  });
  return {
    controller,
    controllers,
    pendingTurns,
    retainPartial,
    finish,
    clear,
    update,
    stop,
    snapshots,
  };
}

test('a synchronous abort listener cannot retain the same partial twice', () => {
  const state = setup();
  state.controller.signal.addEventListener('abort', () => state.stop(1));
  state.stop(1);
  expect(state.retainPartial).toHaveBeenCalledTimes(1);
  expect(state.finish).toHaveBeenCalledTimes(1);
  expect(state.controllers.has(1)).toBe(false);
});

test('reentrant settlement is drained rather than leaving a stopped commit owner busy', () => {
  const state = setup(true);
  state.controller.signal.addEventListener('abort', () => state.stop(1, true));
  state.stop(1);
  expect(state.retainPartial).toHaveBeenCalledTimes(1);
  expect(state.controllers.has(1)).toBe(false);
  expect(state.pendingTurns.has(1)).toBe(false);
});

test('an abort callback installing a newer owner cannot have that owner erased', () => {
  const state = setup();
  const replacement = new AbortController();
  state.controller.signal.addEventListener('abort', () =>
    state.controllers.set(1, replacement),
  );
  state.stop(1);
  expect(state.controllers.get(1)).toBe(replacement);
  expect(replacement.signal.aborted).toBe(false);
  expect(state.retainPartial).not.toHaveBeenCalled();
  expect(state.clear).not.toHaveBeenCalled();
  expect(state.finish).not.toHaveBeenCalled();
});

test('a replacement installed during activity publication is not aborted or erased', () => {
  const state = setup();
  const replacement = new AbortController();
  state.update.mockImplementationOnce(() =>
    state.controllers.set(1, replacement),
  );
  state.stop(1);
  expect(state.controllers.get(1)).toBe(replacement);
  expect(replacement.signal.aborted).toBe(false);
  expect(state.controller.signal.aborted).toBe(true);
  expect(state.retainPartial).not.toHaveBeenCalled();
  expect(state.finish).not.toHaveBeenCalled();
});

test('activity publication can reenter Stop without recursion or duplicate cleanup', () => {
  const state = setup();
  state.update.mockImplementationOnce(() => state.stop(1));
  state.stop(1);
  expect(state.retainPartial).toHaveBeenCalledTimes(1);
  expect(state.finish).toHaveBeenCalledTimes(1);
});

test('an unfinished commit remains owned until a later non-reentrant settlement', () => {
  const state = setup(true);
  state.controller.signal.addEventListener('abort', () => state.stop(1));
  state.stop(1);
  expect(state.controllers.get(1)).toBe(state.controller);
  expect(state.retainPartial).not.toHaveBeenCalled();
  state.stop(1, true);
  expect(state.retainPartial).toHaveBeenCalledTimes(1);
  expect(state.controllers.has(1)).toBe(false);
});

test('a detached abort listener cannot redirect this synchronous Stop to a replacement', () => {
  const state = setup();
  const replacement = new AbortController();
  state.update.mockImplementationOnce(() =>
    state.controllers.set(1, replacement),
  );
  state.controller.signal.addEventListener('abort', () => state.stop(1));
  state.stop(1);
  expect(state.controller.signal.aborted).toBe(true);
  expect(replacement.signal.aborted).toBe(false);
  expect(state.controllers.get(1)).toBe(replacement);
  // A later explicit Stop is not blocked by the old synchronous guard.
  state.stop(1);
  expect(replacement.signal.aborted).toBe(true);
});

test('replacement installed by final cleanup publication keeps its new pending state', () => {
  const state = setup();
  const replacement = new AbortController();
  const next = { saving: true } as PendingTurn;
  state.update.mockImplementation((_id, change) => {
    if (change.artifactContinuation === null) {
      state.controllers.set(1, replacement);
      state.pendingTurns.set(1, next);
    }
  });
  state.stop(1);
  expect(state.controllers.get(1)).toBe(replacement);
  expect(state.pendingTurns.get(1)).toBe(next);
  expect(state.retainPartial).not.toHaveBeenCalled();
});

test('replacement after retained partial prevents stale prompt restoration', () => {
  const state = setup(true);
  const replacement = new AbortController();
  state.retainPartial.mockImplementationOnce(() =>
    state.controllers.set(1, replacement),
  );
  state.stop(1, true);
  expect(state.retainPartial).toHaveBeenCalledTimes(1);
  expect(state.controllers.get(1)).toBe(replacement);
  expect(
    state.update.mock.calls.some(
      ([, change]) => 'draft' in change || 'busy' in change,
    ),
  ).toBe(false);
});
