import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import { ConversationHistory } from '../ConversationHistory';
import type { DisplayMessage } from '../ConversationMessage';

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

test('only a user top-edge scroll fetches a database page and prepends preserve the old visible anchor', async () => {
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
  let resolve!: () => void;
  const loadOlder = jest.fn(
    () =>
      new Promise<void>(done => {
        resolve = done;
      }),
  );
  const all = turns(20);
  const recent = all.slice(20);
  const view = await render(
    <ConversationHistory
      {...base}
      sessionId={1}
      messages={recent}
      historyHasMore
      onLoadOlderHistory={loadOlder}
    />,
  );
  const history = screen.getByTestId('rag-conversation-history');
  const scroll = {
    nativeEvent: {
      contentOffset: { y: 20 },
      contentSize: { height: 1200 },
      layoutMeasurement: { height: 600 },
    },
  };
  await fireEvent.scroll(history, scroll);
  expect(loadOlder).not.toHaveBeenCalled();
  await fireEvent(history, 'scrollBeginDrag');
  await fireEvent.scroll(history, scroll);
  await fireEvent.scroll(history, scroll);
  expect(loadOlder).toHaveBeenCalledTimes(1);
  await view.rerender(
    <ConversationHistory
      {...base}
      sessionId={1}
      messages={all}
      historyHasMore={false}
      onLoadOlderHistory={loadOlder}
    />,
  );
  await act(async () => resolve());
  await fireEvent(
    screen.getByTestId('conversation-earlier-anchor'),
    'layout',
    layout(700),
  );
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 720, animated: false });
  expect(screen.getByText('Synthetic question 0')).toBeTruthy();
  expect(screen.getByTestId('conversation-earlier-messages')).toBeDisabled();
});

test('a failed older page offers an accessible retry without automatic retry loops', async () => {
  const loadOlder = jest.fn(async () => {});
  await render(
    <ConversationHistory
      {...base}
      sessionId={1}
      messages={turns(2)}
      historyHasMore
      historyLoadFailed
      onLoadOlderHistory={loadOlder}
    />,
  );
  const history = screen.getByTestId('rag-conversation-history');
  await fireEvent(history, 'scrollBeginDrag');
  await fireEvent.scroll(history, {
    nativeEvent: {
      contentOffset: { y: 0 },
      contentSize: { height: 800 },
      layoutMeasurement: { height: 600 },
    },
  });
  expect(loadOlder).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('conversation-earlier-messages'));
  expect(loadOlder).toHaveBeenCalledTimes(1);
});
