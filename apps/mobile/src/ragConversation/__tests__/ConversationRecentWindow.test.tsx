import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import { ConversationHistory } from '../ConversationHistory';
import type { DisplayMessage } from '../ConversationMessage';
import {
  conversationHistoryPayload,
  retainedHistoryTurns,
} from '../conversationHistoryPayload';

jest.mock('../../layout/AiResponseText', () => ({
  AiResponseText: require('react-native').Text,
}));
const turns = (count = 30): DisplayMessage[] =>
  Array.from({ length: count }, (_, index) => [
    {
      id: 2 * index + 1,
      role: 'user' as const,
      content: `Synthetic question ${index}`,
    },
    {
      id: 2 * index + 2,
      role: 'assistant' as const,
      content: `Synthetic answer ${index}`,
      retainedTurnId: `turn-${index}`,
    },
  ]).flat();
const base = {
  pendingMessage: null,
  error: '',
  onOpenSource: jest.fn(),
  onLinkError: jest.fn(),
};
const layout = (y: number) => ({ nativeEvent: { layout: { y } } });

afterEach(() => jest.restoreAllMocks());

test('shows ten recent paired turns and reveals older pages without trimming model context', async () => {
  const messages = turns();
  const history = conversationHistoryPayload(messages, '');
  const retained = retainedHistoryTurns(messages, '');
  await render(
    <ConversationHistory {...base} sessionId={1} messages={messages} />,
  );
  expect(screen.queryByText('Synthetic question 19')).toBeNull();
  expect(screen.getByText('Synthetic question 20')).toBeTruthy();
  expect(screen.getByText('Synthetic answer 29')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('conversation-earlier-messages'));
  expect(screen.getByText('Synthetic question 10')).toBeTruthy();
  expect(screen.queryByText('Synthetic question 9')).toBeNull();
  expect(screen.getByTestId('conversation-earlier-messages')).toBeDisabled();
  await fireEvent(
    screen.getByTestId('conversation-earlier-anchor'),
    'layout',
    layout(0),
  );
  expect(screen.getByTestId('conversation-earlier-messages')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('conversation-earlier-messages'));
  expect(screen.queryByText('Synthetic question 9')).toBeNull();
  await fireEvent(
    screen.getByTestId('conversation-earlier-anchor'),
    'layout',
    layout(800),
  );
  await fireEvent.press(screen.getByTestId('conversation-earlier-messages'));
  await fireEvent(
    screen.getByTestId('conversation-earlier-anchor'),
    'layout',
    layout(750),
  );
  expect(screen.getByText('Synthetic question 0')).toBeTruthy();
  expect(screen.getAllByText('Synthetic answer 29')).toHaveLength(1);
  expect(screen.getByTestId('conversation-earlier-messages')).toBeDisabled();
  expect(messages).toHaveLength(60);
  expect(conversationHistoryPayload(messages, '')).toEqual(history);
  expect(retainedHistoryTurns(messages, '')).toEqual(retained);
});

test('anchors prepends to the old first row, not simultaneous streamed content growth', async () => {
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
  const view = await render(
    <ConversationHistory {...base} sessionId={1} messages={turns()} />,
  );
  await fireEvent.scroll(screen.getByTestId('rag-conversation-history'), {
    nativeEvent: {
      contentOffset: { y: 120 },
      contentSize: { height: 1400 },
      layoutMeasurement: { height: 500 },
    },
  });
  await fireEvent.press(screen.getByTestId('conversation-earlier-messages'));
  await view.rerender(
    <ConversationHistory
      {...base}
      sessionId={1}
      messages={turns().map(message =>
        message.id === 60
          ? { ...message, content: 'Synthetic streamed answer' }
          : message,
      )}
    />,
  );
  expect(screen.getByText('Synthetic streamed answer')).toBeTruthy();
  await fireEvent(
    screen.getByTestId('conversation-earlier-anchor'),
    'layout',
    layout(600),
  );
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 720, animated: false });
  expect(screen.getByText('Synthetic question 10')).toBeTruthy();
});

test('session changes and deleted rows revoke pending anchor callbacks and reset the window', async () => {
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
  const view = await render(
    <ConversationHistory {...base} sessionId={1} messages={turns()} />,
  );
  await fireEvent.press(screen.getByTestId('conversation-earlier-messages'));
  const late = screen.getByTestId('conversation-earlier-anchor').props.onLayout;
  await view.rerender(
    <ConversationHistory {...base} sessionId={2} messages={turns()} />,
  );
  scrollTo.mockClear();
  await act(async () => late(layout(900)));
  expect(scrollTo).not.toHaveBeenCalled();
  expect(screen.queryByText('Synthetic question 10')).toBeNull();
  await view.rerender(
    <ConversationHistory {...base} sessionId={2} messages={[]} />,
  );
  expect(screen.queryByTestId('conversation-earlier-messages')).toBeNull();
  expect(screen.queryByText('Synthetic answer 29')).toBeNull();
  await view.rerender(
    <ConversationHistory {...base} sessionId={2} messages={turns()} />,
  );
  expect(screen.queryByText('Synthetic question 19')).toBeNull();
  expect(screen.getByText('Synthetic question 20')).toBeTruthy();
});

test('a protected reply focus can reveal an older turn without a new inference', async () => {
  const complete = jest.fn(() => true);
  await render(
    <ConversationHistory
      {...base}
      sessionId={1}
      messages={turns()}
      replyFocus={{
        generation: 1,
        messageId: 'turn-2',
        canReveal: () => true,
        complete,
      }}
    />,
  );
  expect(screen.getByText('Synthetic question 2')).toBeTruthy();
  expect(screen.getByText('Synthetic answer 2')).toBeTruthy();
  expect(screen.getByTestId('conversation-reply-focus')).toBeTruthy();
  expect(screen.queryByText('Synthetic question 1')).toBeNull();
});

test.each(['new-input', 'reader-drag'] as const)(
  '%s revokes a late prepend correction',
  async reason => {
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
    const view = await render(
      <ConversationHistory {...base} sessionId={1} messages={turns()} />,
    );
    await fireEvent.press(screen.getByTestId('conversation-earlier-messages'));
    const late = screen.getByTestId('conversation-earlier-anchor').props
      .onLayout;
    if (reason === 'new-input')
      await view.rerender(
        <ConversationHistory {...base} sessionId={1} messages={turns(31)} />,
      );
    else
      await fireEvent(
        screen.getByTestId('rag-conversation-history'),
        'scrollBeginDrag',
      );
    scrollTo.mockClear();
    await act(async () => late(layout(900)));
    expect(scrollTo).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('conversation-earlier-messages'),
    ).not.toBeDisabled();
  },
);
