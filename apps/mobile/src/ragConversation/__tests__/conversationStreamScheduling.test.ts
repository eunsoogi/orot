import { createConversationSessions } from '../conversationSessions';
import type {
  RagConversationObserver,
  RagConversationOutcome,
} from '../service';
import { createConversationListeners } from '../conversationListeners';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('stream notifications yield and coalesce while terminal updates publish immediately', () => {
  const listeners = createConversationListeners();
  const notified = jest.fn();
  listeners.subscribe(notified);
  for (let index = 0; index < 1000; index++) listeners.emitStream();
  expect(notified).not.toHaveBeenCalled();
  jest.advanceTimersByTime(16);
  expect(notified).toHaveBeenCalledTimes(1);
  listeners.emitStream();
  listeners.emit();
  expect(notified).toHaveBeenCalledTimes(2);
  jest.runOnlyPendingTimers();
  expect(notified).toHaveBeenCalledTimes(2);
  listeners.emitStream();
  listeners.dispose();
  jest.runOnlyPendingTimers();
  expect(notified).toHaveBeenCalledTimes(2);
});

test('real conversation state retains every token before paint and Stop rejects late output', async () => {
  const store = createConversationSessions();
  let observer: RagConversationObserver | undefined;
  let complete!: (outcome: RagConversationOutcome) => void;
  const sending = store.sendPrompt(
    store.getSnapshot().activeId,
    'synthetic question',
    async (_question, _history, _signal, received) => {
      observer = received;
      return new Promise(resolve => {
        complete = resolve;
      });
    },
  );
  // Prepare the app-owned request; no provider, health data or network is involved.
  for (let index = 0; index < 20 && !observer; index++) await Promise.resolve();
  expect(observer).toBeDefined();
  const notified = jest.fn();
  store.subscribe(notified);
  for (let index = 0; index < 1000; index++)
    observer!.onTaskStreamEvent?.({ type: 'text_delta', text: 'x' });
  const session = () => store.getSnapshot().sessions[0];
  expect(session().pendingMessage?.content).toBe('x'.repeat(1000));
  // Activity may publish its first stage change; token count must not control render count.
  expect(notified.mock.calls.length).toBeLessThanOrEqual(1);
  jest.advanceTimersByTime(16);
  expect(notified.mock.calls.length).toBeLessThanOrEqual(2);
  store.cancel(session().id);
  const stopped = store.getSnapshot();
  observer!.onTaskStreamEvent?.({ type: 'text_delta', text: 'late' });
  jest.runOnlyPendingTimers();
  expect(store.getSnapshot()).toBe(stopped);
  complete({ status: 'failure', kind: 'cancelled' });
  await sending;
  store.dispose();
});

test('the last unsubscribe drops its pending timer before a new subscriber joins', () => {
  const listeners = createConversationListeners();
  const old = jest.fn();
  const unsubscribe = listeners.subscribe(old);
  listeners.emitStream();
  unsubscribe();
  const current = jest.fn();
  listeners.subscribe(current);
  jest.runOnlyPendingTimers();
  expect(old).not.toHaveBeenCalled();
  expect(current).not.toHaveBeenCalled();
  listeners.emitStream();
  jest.advanceTimersByTime(16);
  expect(current).toHaveBeenCalledTimes(1);
  listeners.dispose();
});

test('hidden presentation skips stream work without suppressing privacy or terminal updates', () => {
  const listeners = createConversationListeners();
  let visible = false;
  const presentation = jest.fn();
  const other = jest.fn();
  listeners.subscribe(presentation, () => visible);
  listeners.subscribe(other);
  for (let i = 0; i < 100; i++) {
    listeners.emitStream();
    jest.advanceTimersByTime(16);
  }
  expect(presentation).not.toHaveBeenCalled();
  expect(other).toHaveBeenCalledTimes(100);
  // Deletion/cancellation/terminal notifications must invalidate even hidden UI.
  listeners.emit();
  expect(presentation).toHaveBeenCalledTimes(1);
  visible = true;
  listeners.emitStream();
  jest.advanceTimersByTime(16);
  expect(presentation).toHaveBeenCalledTimes(2);
  // Visibility is checked when the queued callback executes, not when scheduled.
  listeners.emitStream();
  visible = false;
  jest.advanceTimersByTime(16);
  expect(presentation).toHaveBeenCalledTimes(2);
  listeners.dispose();
});
