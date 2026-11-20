import { createConversationListeners } from '../conversationListeners';
import { createConversationSessions } from '../conversationSessions';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

// Subscription callbacks are presentation observers, not request execution owners.
test.each(['immediate', 'stream'] as const)(
  '%s publication visits a re-subscribing observer only once',
  mode => {
    const listeners = createConversationListeners();
    let unsubscribe = () => {};
    const observer = jest.fn(() => {
      unsubscribe();
      // Bound the baseline reproduction rather than hanging on live Map iteration.
      if (observer.mock.calls.length < 4)
        unsubscribe = listeners.subscribe(observer);
    });
    unsubscribe = listeners.subscribe(observer);
    const other = jest.fn();
    listeners.subscribe(other);
    if (mode === 'immediate') listeners.emit();
    else {
      listeners.emitStream();
      jest.advanceTimersByTime(16);
    }
    expect(observer).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
    listeners.dispose();
  },
);

test('a failing observer cannot prevent explicit Stop from aborting the sender', async () => {
  const store = createConversationSessions();
  const id = store.getSnapshot().activeId;
  let signal: AbortSignal | undefined;
  let complete!: (result: { status: 'failure'; kind: 'cancelled' }) => void;
  const sending = store.sendPrompt(
    id,
    'synthetic request',
    async (_q, _h, received) => {
      signal = received;
      return new Promise(resolve => {
        complete = resolve;
      });
    },
  );
  for (let i = 0; i < 30 && !signal; i++) await Promise.resolve();
  expect(signal).toBeDefined();
  store.subscribe(() => {
    throw new Error('synthetic presentation failure');
  });
  const observed = jest.fn();
  store.subscribe(observed);
  try {
    expect(() => store.cancel(id)).not.toThrow();
    expect(signal!.aborted).toBe(true);
    expect(store.getSnapshot().sessions[0].busy).toBe(false);
    expect(observed).toHaveBeenCalled();
  } finally {
    complete({ status: 'failure', kind: 'cancelled' });
    await sending.catch(() => undefined);
    store.dispose();
  }
});

test('throwing visibility is isolated and terminal delivery does not consult visibility', () => {
  const listeners = createConversationListeners();
  const hidden = jest.fn();
  listeners.subscribe(hidden, () => {
    throw new Error('synthetic visibility failure');
  });
  const other = jest.fn();
  listeners.subscribe(other);
  listeners.emitStream();
  expect(() => jest.advanceTimersByTime(16)).not.toThrow();
  expect(hidden).not.toHaveBeenCalled();
  expect(other).toHaveBeenCalledTimes(1);
  listeners.emit();
  expect(hidden).toHaveBeenCalledTimes(1);
  expect(other).toHaveBeenCalledTimes(2);
  listeners.dispose();
});

test('removed and replaced registrations cannot receive a stale publication', () => {
  const listeners = createConversationListeners();
  const second = jest.fn();
  let replace = true;
  let remove = () => {};
  listeners.subscribe(() => {
    if (replace) {
      replace = false;
      remove();
      listeners.subscribe(second);
    }
  });
  remove = listeners.subscribe(second);
  listeners.emit();
  expect(second).not.toHaveBeenCalled();
  remove(); // Old cleanup cannot remove the replacement.
  listeners.emit();
  expect(second).toHaveBeenCalledTimes(1);
  listeners.dispose();
});

test('disposal during delivery prevents remaining observer callbacks', () => {
  const listeners = createConversationListeners();
  listeners.subscribe(() => listeners.dispose());
  const later = jest.fn();
  listeners.subscribe(later);
  listeners.emit();
  expect(later).not.toHaveBeenCalled();
});
