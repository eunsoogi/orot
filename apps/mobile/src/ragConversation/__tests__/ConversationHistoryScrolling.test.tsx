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

test('follows the latest message before evidence while preserving a reader scroll', async () => {
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
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
  const end = screen.getByTestId('rag-conversation-message-end');
  const content = footer.parent!;
  expect(end.parent).toBe(content);
  expect(content.children.indexOf(end)).toBeLessThan(
    content.children.indexOf(footer),
  );
  expect(history.props.contentContainerStyle.paddingBottom).toBe(0);
  await fireEvent(history, 'layout', {
    nativeEvent: { layout: { height: 34 } },
  });
  await fireEvent(end, 'layout', { nativeEvent: { layout: { y: 1000 } } });
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 966, animated: false });
  await fireEvent.scroll(history, {
    nativeEvent: {
      contentOffset: { x: 0, y: 400 },
      contentSize: { width: 300, height: 1300 },
      layoutMeasurement: { width: 300, height: 34 },
    },
  });
  scrollTo.mockClear();
  await fireEvent(end, 'layout', { nativeEvent: { layout: { y: 1100 } } });
  expect(scrollTo).not.toHaveBeenCalled();
  scrollTo.mockRestore();
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

test('keeps a reader position when the viewport changes to compact', async () => {
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
  const scrollToEnd = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  const page = (compact: boolean) => (
    <ConversationHistory
      compact={compact}
      messages={[{ id: 1, role: 'user', content: '이전 질문' }]}
      pendingMessage={null}
      error=""
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
      footer={<Text>근거와 안내</Text>}
    />
  );
  const view = await render(page(false));
  const history = screen.getByTestId('rag-conversation-history');
  await fireEvent.scroll(history, {
    nativeEvent: {
      contentOffset: { x: 0, y: 100 },
      contentSize: { width: 300, height: 1200 },
      layoutMeasurement: { width: 300, height: 400 },
    },
  });
  scrollTo.mockClear();
  scrollToEnd.mockClear();
  await view.rerender(page(true));
  await fireEvent(history, 'layout', {
    nativeEvent: { layout: { height: 34 } },
  });
  await fireEvent(
    screen.getByTestId('rag-conversation-message-end'),
    'layout',
    {
      nativeEvent: { layout: { y: 1000 } },
    },
  );
  expect(scrollTo).not.toHaveBeenCalled();
  expect(scrollToEnd).not.toHaveBeenCalled();
  scrollTo.mockRestore();
  scrollToEnd.mockRestore();
});
