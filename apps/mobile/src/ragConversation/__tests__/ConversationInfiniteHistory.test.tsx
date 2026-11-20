import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { ScrollView, Text } from 'react-native';
import { ConversationHistory } from '../ConversationHistory';
import type { DisplayMessage } from '../ConversationMessage';

jest.mock('../../layout/AiResponseText', () => ({
  AiResponseText: require('react-native').Text,
}));
const turns = (count = 30): DisplayMessage[] =>
  Array.from({ length: count }, (_, index) => [
    {
      id: -(2 * index + 1),
      restoredHistory: true as const,
      role: 'user' as const,
      content: `Synthetic question ${index}`,
    },
    {
      id: -(2 * index + 2),
      restoredHistory: true as const,
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
      entryChoices={<Text>Synthetic boundary choices</Text>}
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
  // Native initial row layout includes container padding before the fetch completes.
  scrollTo.mockClear();
  await fireEvent(
    screen.getByTestId('conversation-earlier-anchor'),
    'layout',
    layout(24),
  );
  expect(scrollTo).not.toHaveBeenCalled();
  await view.rerender(
    <ConversationHistory
      {...base}
      sessionId={1}
      entryChoices={<Text>Synthetic boundary choices</Text>}
      messages={all}
      historyHasMore={false}
      onLoadOlderHistory={loadOlder}
    />,
  );
  await act(async () => resolve());
  await fireEvent(
    screen.getByTestId('conversation-earlier-anchor'),
    'layout',
    layout(724),
  );
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 720, animated: false });
  expect(screen.getByText('Synthetic question 0')).toBeTruthy();
  expect(screen.getAllByText('Synthetic boundary choices')).toHaveLength(1);
  expect(screen.getByTestId('conversation-earlier-messages')).toBeDisabled();
  expect(screen.getByLabelText('이전 대화를 모두 표시했어요')).toBeTruthy();
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

test('numbered history remains ordered across automatic loading, retry, and manual exhaustion', async () => {
  const all = turns(30);
  const loadOlder = jest.fn(async () => {});
  const props = { ...base, sessionId: 1, onLoadOlderHistory: loadOlder };
  const view = await render(
    <ConversationHistory {...props} messages={all.slice(40)} historyHasMore />,
  );
  expect(screen.getByText('Synthetic question 20')).toBeTruthy();
  expect(screen.queryByText('Synthetic question 19')).toBeNull();
  const history = screen.getByTestId('rag-conversation-history');
  const top = {
    nativeEvent: {
      contentOffset: { y: 0 },
      contentSize: { height: 1200 },
      layoutMeasurement: { height: 600 },
    },
  };
  await fireEvent(history, 'scrollBeginDrag');
  await fireEvent.scroll(history, top);
  expect(loadOlder).toHaveBeenCalledTimes(1);
  await view.rerender(
    <ConversationHistory
      {...props}
      messages={all.slice(40)}
      historyHasMore
      historyLoadFailed
    />,
  );
  expect(
    screen.getByLabelText('이전 대화를 못 불러왔어요. 다시 시도'),
  ).toBeTruthy();
  await fireEvent(history, 'scrollBeginDrag');
  await fireEvent.scroll(history, top);
  expect(loadOlder).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Synthetic question 20')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('conversation-earlier-messages'));
  expect(loadOlder).toHaveBeenCalledTimes(2);
  await view.rerender(
    <ConversationHistory {...props} messages={all.slice(20)} historyHasMore />,
  );
  expect(screen.getByText('Synthetic question 10')).toBeTruthy();
  expect(screen.queryByText('Synthetic question 9')).toBeNull();
  await fireEvent.press(screen.getByTestId('conversation-earlier-messages'));
  expect(loadOlder).toHaveBeenCalledTimes(3);
  await view.rerender(
    <ConversationHistory {...props} messages={all} historyHasMore={false} />,
  );
  const rows = screen.getAllByTestId('conversation-user-message');
  expect(rows).toHaveLength(30);
  rows.forEach((row, index) => {
    expect(within(row).getByText(`Synthetic question ${index}`)).toBeTruthy();
  });
  for (let index = 0; index < 30; index++) {
    expect(screen.getAllByText(`Synthetic question ${index}`)).toHaveLength(1);
    expect(screen.getAllByText(`Synthetic answer ${index}`)).toHaveLength(1);
  }
  expect(screen.getByTestId('conversation-earlier-messages')).toBeDisabled();
});
