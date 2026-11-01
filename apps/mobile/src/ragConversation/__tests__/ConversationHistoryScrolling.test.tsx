import { fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import { ConversationHistory } from '../ConversationHistory';

test('does not follow new content after the reader scrolls away from the bottom', async () => {
  const scrollToEnd = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  await render(
    <ConversationHistory
      messages={[{ id: 1, role: 'user', content: '질문' }]}
      pendingMessage={null}
      error=""
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
    />,
  );
  const history = screen.getByTestId('rag-conversation-history');
  await fireEvent(history, 'contentSizeChange', 300, 1000);
  expect(scrollToEnd).toHaveBeenCalledTimes(1);
  await fireEvent.scroll(history, {
    nativeEvent: {
      contentOffset: { x: 0, y: 100 },
      contentSize: { width: 300, height: 1000 },
      layoutMeasurement: { width: 300, height: 400 },
    },
  });
  await fireEvent(history, 'contentSizeChange', 300, 1100);
  expect(scrollToEnd).toHaveBeenCalledTimes(1);
  scrollToEnd.mockRestore();
});
