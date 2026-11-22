import { fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import { ConversationHistory } from '../ConversationHistory';
import type { SavedHistoryDisplayItem } from '../conversationSavedHistoryDisplay';

jest.mock('../../layout/AiResponseText', () => ({
  AiResponseText: require('react-native').Text,
}));

test('response growth waits for an active drag, then follows again at latest', async () => {
  const follow = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  const savedHistoryDisplay: readonly SavedHistoryDisplayItem[] = [
    {
      questionId: -1,
      answerId: -2,
      row: {
        id: 'archived',
        kind: 'answer',
        createdAt: '2026-11-22T08:00:00Z',
        question: 'Synthetic saved question',
        answer: 'Synthetic saved response',
      },
    },
  ];
  const props = {
    sessionId: 42,
    messages: [
      { id: 1, role: 'user' as const, content: 'Synthetic typed message' },
    ],
    savedHistoryDisplay,
    error: '',
    onOpenSource: jest.fn(),
    onLinkError: jest.fn(),
  };
  const view = await render(
    <ConversationHistory {...props} pendingMessage={null} />,
  );
  try {
    const archived = screen.getByText('Synthetic saved response');
    const history = screen.getByTestId('rag-conversation-history');
    const position = async (y: number, height: number) =>
      fireEvent.scroll(history, {
        nativeEvent: {
          contentOffset: { x: 0, y },
          contentSize: { width: 390, height },
          layoutMeasurement: { width: 390, height: 400 },
        },
      });
    await fireEvent(history, 'layout', {
      nativeEvent: { layout: { height: 400 } },
    });
    await fireEvent(history, 'contentSizeChange', 390, 1000);
    await position(600, 1000);
    follow.mockClear();

    // The first chunk can arrive after native drag starts but before a scroll offset is delivered.
    await fireEvent(history, 'scrollBeginDrag');
    await view.rerender(
      <ConversationHistory
        {...props}
        pendingMessage={{
          id: 2,
          content: 'Synthetic streamed answer',
          activity: '',
        }}
      />,
    );
    await fireEvent(history, 'contentSizeChange', 390, 1070);
    expect(follow).not.toHaveBeenCalled();
    expect(screen.getByText('Synthetic saved response')).toBe(archived);
    expect(screen.getByText('Synthetic streamed answer')).toBeTruthy();

    // Keeping the gesture near latest is not permission to fight its momentum.
    await position(670, 1070);
    await fireEvent(history, 'scrollEndDrag');
    await fireEvent(history, 'momentumScrollBegin');
    await fireEvent(history, 'contentSizeChange', 390, 1100);
    expect(follow).not.toHaveBeenCalled();
    await position(700, 1100);
    await fireEvent(history, 'momentumScrollEnd');
    await fireEvent(history, 'contentSizeChange', 390, 1140);
    expect(follow).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('rag-conversation-history')).toBe(history);
  } finally {
    follow.mockRestore();
    await view.unmount();
  }
});
