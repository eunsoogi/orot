import { useCallback, useSyncExternalStore } from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { createConversationSessions } from '../conversationSessions';
import type {
  RagConversationObserver,
  RagConversationOutcome,
} from '../service';

test('returning to a retained route reads all hidden text while cancellation still updates it', async () => {
  jest.useFakeTimers();
  const store = createConversationSessions();
  let visible = true;
  const isVisible = () => visible;
  let renders = 0;
  function Fixture() {
    const subscribe = useCallback(
      (listener: () => void) => store.subscribe(listener, isVisible),
      [],
    );
    const snapshot = useSyncExternalStore(subscribe, store.getSnapshot);
    renders++;
    return (
      <Text testID="preview">
        {snapshot.sessions[0].pendingMessage?.content ?? 'settled'}
      </Text>
    );
  }
  let observer: RagConversationObserver | undefined;
  let finish!: (value: RagConversationOutcome) => void;
  await render(<Fixture />);
  let sending!: Promise<unknown>;
  await act(async () => {
    sending = store.sendPrompt(
      store.getSnapshot().activeId,
      'synthetic',
      async (_q, _h, _s, received) => {
        observer = received;
        return new Promise(resolve => {
          finish = resolve;
        });
      },
    );
  });
  await act(async () => {
    observer!.onTaskStreamEvent?.({ type: 'text_delta', text: 'first' });
    jest.advanceTimersByTime(16);
  });
  visible = false;
  const before = renders;
  for (let i = 0; i < 100; i++)
    await act(async () => {
      observer!.onTaskStreamEvent?.({ type: 'text_delta', text: 'x' });
      jest.advanceTimersByTime(16);
    });
  expect(renders).toBe(before);
  expect(store.getSnapshot().sessions[0].pendingMessage?.content).toBe(
    'first' + 'x'.repeat(100),
  );
  visible = true;
  await screen.rerender(<Fixture />);
  expect(screen.getByTestId('preview')).toHaveTextContent(
    'first' + 'x'.repeat(100),
  );
  visible = false;
  await act(async () => {
    store.cancel(store.getSnapshot().activeId);
  });
  expect(screen.getByTestId('preview')).toHaveTextContent('settled');
  await act(async () => {
    finish({ status: 'failure', kind: 'cancelled' });
    await sending;
  });
  store.dispose();
  jest.useRealTimers();
});
