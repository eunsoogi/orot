import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ConversationHistoryScreen } from '../ConversationHistoryScreen';
import * as sessionsContext from '../ConversationSessionsContext';
import { createConversationSessions } from '../conversationSessions';

test('keeps the large heading and new-session action inside the scrolling native list', async () => {
  const store = createConversationSessions();
  const onBack = jest.fn();
  const sessionHook = jest
    .spyOn(sessionsContext, 'useConversationSessions')
    .mockReturnValue(store);
  try {
    await render(<ConversationHistoryScreen onBack={onBack} />);
    const list = screen.getByTestId('conversation-history-list');
    expect(
      within(screen.getByTestId('conversation-history-page')).getByTestId(
        'conversation-history-list',
      ),
    ).toBeTruthy();
    await fireEvent(list, 'contentHeightChange', {
      nativeEvent: { height: 640 },
    });
    expect(StyleSheet.flatten(list.props.style).height).toBe(640);
    // A fixed React header can consume the entire list viewport at accessibility sizes.
    expect(screen.queryByText('대화 기록')).toBeNull();
    expect(list.props).toMatchObject({
      headerTitle: '대화 기록',
      headerCount: '1개의 대화',
      newSessionLabel: '새 대화',
    });
    await fireEvent(list, 'createSession', { nativeEvent: {} });
    expect(store.getSnapshot().sessions).toHaveLength(2);
    expect(onBack).toHaveBeenCalledTimes(1);
  } finally {
    sessionHook.mockRestore();
    store.dispose();
  }
});

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
