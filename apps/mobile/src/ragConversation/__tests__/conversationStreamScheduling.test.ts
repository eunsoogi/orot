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
