import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationHistoryScreen } from '../ConversationHistoryScreen';
import * as sessionsContext from '../ConversationSessionsContext';
import { createConversationSessions } from '../conversationSessions';

/** Selection is navigation only: stale native events cannot open another draft. */
test('returns only for an existing session and preserves drafts on repeated selection', async () => {
  const store = createConversationSessions();
  store.setDraft(1, 'first synthetic draft');
  store.create();
  store.setDraft(2, 'second synthetic draft');
  const before = store.getSnapshot().sessions;
  const onBack = jest.fn(() => {
    expect(store.getSnapshot().activeId).toBe(1);
  });
  const hook = jest
    .spyOn(sessionsContext, 'useConversationSessions')
    .mockReturnValue(store);
  try {
    await render(<ConversationHistoryScreen onBack={onBack} />);
    const list = screen.getByTestId('conversation-history-list');
    await fireEvent(list, 'selectSession', { nativeEvent: { id: 999 } });
    expect(onBack).not.toHaveBeenCalled();
    expect(store.getSnapshot().activeId).toBe(2);
    await fireEvent(list, 'selectSession', { nativeEvent: { id: 1 } });
    await fireEvent(list, 'selectSession', { nativeEvent: { id: 1 } });
    expect(onBack).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().sessions).toEqual(before);
    await fireEvent(list, 'deleteSession', { nativeEvent: { id: 1 } });
    onBack.mockClear();
    await fireEvent(
      screen.getByTestId('conversation-history-list'),
      'selectSession',
      { nativeEvent: { id: 1 } },
    );
    expect(onBack).not.toHaveBeenCalled();
    expect(store.getSnapshot().activeId).toBe(2);
  } finally {
    hook.mockRestore();
    store.dispose();
  }
});
