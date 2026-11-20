import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { runMigrations } from '@orot/storage';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import type { ConversationExecutionEvent } from '../conversationExecutionLease';
import { Alert } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { ConversationScreen } from '../ConversationScreen';
import { createConversationSessions } from '../conversationSessions';
import { useConversationSessions } from '../ConversationSessionsContext';
import type { ConversationScreenProps } from '../ConversationScreenProps';

jest.mock('../ConversationSessionsContext', () => ({
  useConversationSessions: jest.fn(),
}));

// No entry metadata exists for ordinary chat. The retry wrapper must not invent any.
test('ordinary chat confirms one new request without introducing feature context', async () => {
  let receive!: (event: ConversationExecutionEvent) => void;
  const begin = jest.fn(async (_id: string) => true);
  const db = openSqliteTestDatabase(':memory:');
  await runMigrations(db.database);
  let sequence = 0;
  const store = createConversationSessions({
    retention: createConversationSessionRetention({
      openStorage: async () => createConversationArtifactStorage(db.database),
      createId: () => `ordinary-${++sequence}`,
      now: () => '2035-01-01T12:00:00.000Z',
    }),
    execution: {
      begin,
      end: () => {},
      isActive: async () => true,
      protectedDataAvailable: async () => true,
      subscribe: listener => {
        receive = listener;
        return () => {};
      },
    },
  });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  let finish!: () => void;
  const gate = new Promise<void>(resolve => {
    finish = resolve;
  });
  try {
    store.setDraft(1, '합성 일반 질문');
    const initial = store.send(
      1,
      async (_question, _history, signal, observer) => {
        observer?.onExecutionState?.('working');
        await new Promise<void>(resolve =>
          signal?.addEventListener('abort', () => resolve(), { once: true }),
        );
        return { status: 'failure', kind: 'cancelled' };
      },
    );
    await waitFor(() => expect(begin).toHaveBeenCalledTimes(1));
    receive({ kind: 'expired', requestId: begin.mock.calls[0]![0] });
    await initial;
    expect(store.getSnapshot().sessions[0]!.messages.at(-1)).toMatchObject({
      incomplete: true,
      interruptionReason: 'expired',
    });
    jest.mocked(useConversationSessions).mockReturnValue(store);
    const sender: ConversationScreenProps['onSend'] = async () => {
      await gate;
      return { status: 'answer', answer: '합성 새 답변', citations: [] };
    };
    const send = jest.fn(sender);
    const view = await render(
      <ConversationScreen
        onBack={jest.fn()}
        onOpenSource={jest.fn()}
        onSend={send}
      />,
    );
    await fireEvent.press(screen.getByText('다시 요청'));
    expect(send).not.toHaveBeenCalled();
    await act(async () => {
      alert.mock.calls.at(-1)?.[2]?.[0]?.onPress?.();
    });
    expect(send).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('다시 요청'));
    await act(async () => {
      const confirm = alert.mock.calls.at(-1)?.[2]?.[1]?.onPress;
      confirm?.();
      confirm?.();
    });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]![0]).toBe('합성 일반 질문');
    expect(send.mock.calls[0]).toHaveLength(4);
    expect(send.mock.calls[0]![4]).toBeUndefined();
    await act(async () => {
      finish();
      await send.mock.results[0]!.value;
    });
    await waitFor(() =>
      expect(store.getSnapshot().sessions[0]!.busy).toBe(false),
    );
    await view.unmount();
  } finally {
    finish();
    store.dispose();
    db.close();
    alert.mockRestore();
  }
});
