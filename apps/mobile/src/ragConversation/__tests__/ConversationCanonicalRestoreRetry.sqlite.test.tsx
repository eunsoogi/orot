import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { useSyncExternalStore } from 'react';
import { t } from '../../i18n';
import { ConversationHistory } from '../ConversationHistory';
import { conversationHistoryRecoveryProps } from '../conversationHistoryRecoveryProps';
import {
  createConversationSessions,
  type ConversationSessions,
} from '../conversationSessions';
import { setup } from '../testSupport/continuousSessionFixture';

function History({ store }: { store: ConversationSessions }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const session = state.sessions.find(row => row.id === state.activeId)!;
  return (
    <ConversationHistory
      {...conversationHistoryRecoveryProps(session, store)}
      messages={session.messages}
      pendingMessage={null}
      error={session.error}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
    />
  );
}

test('acknowledges a canonical history retry while the protected lookup is still pending', async () => {
  const fixture = await setup();
  const initial = await fixture.options.continuousSession(
    new AbortController().signal,
  );
  const selection = jest.fn(fixture.options.continuousSession);
  let release!: () => void;
  let finished!: Promise<unknown>;
  selection
    .mockRejectedValueOnce(
      new Error('Synthetic temporarily inaccessible selection'),
    )
    .mockImplementationOnce(signal => {
      const bound = new Promise<Awaited<ReturnType<typeof selection>>>(
        resolve => {
          release = () => resolve(fixture.options.continuousSession(signal));
        },
      );
      finished = bound;
      return bound;
    });
  const read = jest.fn(async () => []);
  const store = createConversationSessions({
    ...fixture.options,
    continuousSession: selection,
    restoreSession: read,
  });
  const view = await render(<History store={store} />);
  try {
    await act(async () => store.synchronizeModel());
    await fireEvent.press(
      screen.getByText(t('ragConversation.history.retryRestore')),
    );
    expect(selection).toHaveBeenCalledTimes(2);
    expect(read).not.toHaveBeenCalled();
    expect(screen.getByTestId('conversation-history-restoring')).toBeTruthy();
    expect(
      screen.queryByText(t('ragConversation.history.retryRestore')),
    ).toBeNull();
    await act(async () => {
      release();
      await finished;
    });
    expect(store.toolSourceSessionId(store.getSnapshot().activeId)).toBe(
      initial.id,
    );
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('conversation-history-restoring')).toBeNull();
  } finally {
    await view.unmount();
    store.dispose();
    fixture.store.dispose();
    fixture.close();
  }
});
