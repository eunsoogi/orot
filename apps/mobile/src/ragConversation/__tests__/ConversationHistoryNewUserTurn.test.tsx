import { fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import { ConversationHistory } from '../ConversationHistory';

type HistoryProps = Parameters<typeof ConversationHistory>[0];
type HistoryElement = ReturnType<typeof screen.getByTestId>;

const page = (
  messages: HistoryProps['messages'],
  pendingMessage: HistoryProps['pendingMessage'],
  sessionId = 1,
) => (
  <ConversationHistory
    messages={messages}
    pendingMessage={pendingMessage}
    sessionId={sessionId}
    error=""
    onOpenSource={jest.fn()}
    onLinkError={jest.fn()}
  />
);

async function scrollReaderAway(history: HistoryElement) {
  await fireEvent(history, 'scrollBeginDrag');
  await fireEvent.scroll(history, {
    nativeEvent: {
      contentOffset: { x: 0, y: 100 },
      contentSize: { width: 300, height: 1000 },
      layoutMeasurement: { width: 300, height: 400 },
    },
  });
  await fireEvent(history, 'scrollEndDrag');
}

test('follows a completed user turn when no pending snapshot is rendered', async () => {
  const scrollToEnd = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  const view = await render(
    page([{ id: 1, role: 'assistant', content: '이전 답변' }], null),
  );
  const history = screen.getByTestId('rag-conversation-history');
  await scrollReaderAway(history);
  scrollToEnd.mockClear();
  await view.rerender(
    page(
      [
        { id: 1, role: 'assistant', content: '이전 답변' },
        { id: 2, role: 'user', content: '새 질문' },
        { id: 3, role: 'assistant', content: '준비된 답변' },
      ],
      null,
    ),
  );
  await fireEvent(history, 'contentSizeChange', 300, 1100);
  expect(scrollToEnd).toHaveBeenCalledTimes(1);
  scrollToEnd.mockRestore();
});

test('follows a retry that replaces its failed prompt', async () => {
  const scrollToEnd = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  const view = await render(
    page(
      [
        { id: 1, role: 'user', content: '다시 시도할 질문', failed: true },
        { id: 2, role: 'assistant', content: '이전 답변' },
      ],
      null,
    ),
  );
  const history = screen.getByTestId('rag-conversation-history');
  await scrollReaderAway(history);
  scrollToEnd.mockClear();
  await view.rerender(
    page(
      [
        { id: 2, role: 'assistant', content: '이전 답변' },
        { id: 3, role: 'user', content: '다시 시도할 질문' },
      ],
      null,
    ),
  );
  await fireEvent(history, 'contentSizeChange', 300, 1100);
  expect(scrollToEnd).toHaveBeenCalledTimes(1);
  scrollToEnd.mockRestore();
});

test('preserves reader position when same-session history restores old turns', async () => {
  const scrollToEnd = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  const view = await render(page([], null));
  const history = screen.getByTestId('rag-conversation-history');
  await scrollReaderAway(history);
  scrollToEnd.mockClear();
  await view.rerender(
    page(
      [
        { id: -1, role: 'user', content: '복원된 질문' },
        { id: -2, role: 'assistant', content: '복원된 답변' },
      ],
      null,
    ),
  );
  await fireEvent(history, 'contentSizeChange', 300, 1100);
  expect(scrollToEnd).not.toHaveBeenCalled();
  scrollToEnd.mockRestore();
});

test('does not treat a different session as a submitted turn', async () => {
  const scrollToEnd = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  const view = await render(
    page(
      [
        { id: 1, role: 'user', content: '이전 세션 질문' },
        { id: 2, role: 'assistant', content: '이전 세션 답변' },
      ],
      null,
    ),
  );
  const history = screen.getByTestId('rag-conversation-history');
  await scrollReaderAway(history);
  scrollToEnd.mockClear();
  await view.rerender(
    page(
      [
        { id: 10, role: 'user', content: '다른 세션 질문' },
        { id: 11, role: 'assistant', content: '다른 세션 답변' },
      ],
      null,
      2,
    ),
  );
  await fireEvent(history, 'contentSizeChange', 300, 1100);
  expect(scrollToEnd).not.toHaveBeenCalled();
  scrollToEnd.mockRestore();
});

test('keeps a manual scroll-up during streamed assistant updates', async () => {
  const scrollToEnd = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  const messages: HistoryProps['messages'] = [
    { id: 1, role: 'assistant', content: '이전 답변' },
    { id: 2, role: 'user', content: '새 질문' },
  ];
  const view = await render(
    page([{ id: 1, role: 'assistant', content: '이전 답변' }], null),
  );
  const history = screen.getByTestId('rag-conversation-history');
  await scrollReaderAway(history);
  await view.rerender(
    page(messages, { id: 3, content: '', activity: '작성 중' }),
  );
  await fireEvent(history, 'contentSizeChange', 300, 1100);
  scrollToEnd.mockClear();
  await fireEvent.scroll(history, {
    nativeEvent: {
      contentOffset: { x: 0, y: 700 },
      contentSize: { width: 300, height: 1100 },
      layoutMeasurement: { width: 300, height: 400 },
    },
  });
  await fireEvent(history, 'scrollBeginDrag');
  await fireEvent.scroll(history, {
    nativeEvent: {
      contentOffset: { x: 0, y: 300 },
      contentSize: { width: 300, height: 1100 },
      layoutMeasurement: { width: 300, height: 400 },
    },
  });
  await fireEvent(history, 'scrollEndDrag');
  await view.rerender(
    page(messages, { id: 3, content: '더 긴 응답', activity: '작성 중' }),
  );
  await fireEvent(history, 'contentSizeChange', 300, 1200);
  expect(scrollToEnd).not.toHaveBeenCalled();
  scrollToEnd.mockRestore();
});
