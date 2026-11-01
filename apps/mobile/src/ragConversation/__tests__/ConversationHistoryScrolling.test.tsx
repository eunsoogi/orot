import { fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView, Text } from 'react-native';
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

test('keeps evidence scrollable before the latest message in a compact viewport', async () => {
  await render(
    <ConversationHistory
      compact
      messages={[{ id: 1, role: 'user', content: '최근 질문' }]}
      pendingMessage={null}
      error=""
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
      footer={<Text testID="evidence">근거와 안내</Text>}
    />,
  );
  const history = screen.getByTestId('rag-conversation-history');
  const footer = screen.getByTestId('evidence');
  const message = screen.getByText('최근 질문');
  const content = footer.parent!;
  let messageSection = message;
  while (messageSection.parent && messageSection.parent !== content)
    messageSection = messageSection.parent;
  expect(messageSection.parent).toBe(content);
  expect(content.children.indexOf(footer)).toBeLessThan(
    content.children.indexOf(messageSection),
  );
  expect(history.props.contentContainerStyle.paddingBottom).toBe(0);
});

test('puts streaming text after its activity in the short reading viewport', async () => {
  await render(
    <ConversationHistory
      compact
      messages={[]}
      pendingMessage={{ id: 2, content: '답변 본문', activity: '작성 중' }}
      error=""
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
    />,
  );
  const stream = screen.getByTestId('rag-conversation-stream');
  const activity = screen.getByTestId('rag-conversation-progress');
  expect(stream.parent).toBe(activity.parent);
  expect(stream.parent!.children.indexOf(activity)).toBeLessThan(
    stream.parent!.children.indexOf(stream),
  );
});
