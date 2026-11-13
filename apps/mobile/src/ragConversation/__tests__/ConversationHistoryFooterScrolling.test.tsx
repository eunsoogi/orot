import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { ScrollView, Text } from 'react-native';
import { ConversationHistory } from '../ConversationHistory';

test('keeps a reader at the evidence footer when content grows', async () => {
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
  await render(
    <ConversationHistory
      compact
      messages={[{ id: 1, role: 'user', content: '질문' }]}
      pendingMessage={null}
      error=""
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
    />,
  );
  const history = screen.getByTestId('rag-conversation-history');
  const end = screen.getByTestId('rag-conversation-message-end');
  await fireEvent(history, 'layout', {
    nativeEvent: { layout: { height: 34 } },
  });
  await fireEvent(end, 'layout', { nativeEvent: { layout: { y: 1000 } } });
  await fireEvent.scroll(history, {
    nativeEvent: {
      contentOffset: { x: 0, y: 966 },
      contentSize: { width: 300, height: 1200 },
      layoutMeasurement: { width: 300, height: 34 },
    },
  });
  await fireEvent.scroll(history, {
    nativeEvent: {
      contentOffset: { x: 0, y: 1186 },
      contentSize: { width: 300, height: 1220 },
      layoutMeasurement: { width: 300, height: 34 },
    },
  });
  scrollTo.mockClear();
  await fireEvent(end, 'layout', { nativeEvent: { layout: { y: 1020 } } });
  expect(scrollTo).not.toHaveBeenCalled();
  scrollTo.mockRestore();
});

test('places prepared questions before conversation messages in scroll order', async () => {
  await render(
    <ConversationHistory
      messages={[{ id: 1, role: 'user', content: 'Conversation message' }]}
      pendingMessage={null}
      error=""
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
      beforeMessages={<Text>Prepared questions</Text>}
    />,
  );
  const history = screen.getByTestId('rag-conversation-history');
  const content = within(history)
    .getAllByText(/Prepared questions|Conversation message/)
    .map(node => node.props.children);
  expect(content).toEqual(['Prepared questions', 'Conversation message']);
});
