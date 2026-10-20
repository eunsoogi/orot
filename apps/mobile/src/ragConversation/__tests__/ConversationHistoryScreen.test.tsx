import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ConversationHistoryScreen } from '../ConversationHistoryScreen';
import * as sessionsContext from '../ConversationSessionsContext';
import { createConversationSessions } from '../conversationSessions';

/** Native visual checks cover actual clipping; this protects wrapping and the real undo action. */
test('lets deletion feedback wrap and restores the removed session', async () => {
  const store = createConversationSessions();
  store.create();
  store.remove(1);
  const sessionHook = jest
    .spyOn(sessionsContext, 'useConversationSessions')
    .mockReturnValue(store);
  try {
    await render(<ConversationHistoryScreen onBack={jest.fn()} />);
    const feedback = screen.getByText('대화를 삭제했어요.');
    expect(StyleSheet.flatten(feedback.parent?.props.style)).toMatchObject({
      flexWrap: 'wrap',
    });
    await fireEvent.press(screen.getByTestId('conversation-history-undo'));
    expect(store.getSnapshot().sessions.map(session => session.id)).toEqual([
      1, 2,
    ]);
    expect(screen.queryByText('대화를 삭제했어요.')).toBeNull();
  } finally {
    sessionHook.mockRestore();
    store.dispose();
  }
});
