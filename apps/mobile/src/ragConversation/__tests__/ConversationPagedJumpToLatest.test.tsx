import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import { ConversationHistory } from '../ConversationHistory';

jest.mock('../../layout/AiResponseText', () => ({
  AiResponseText: require('react-native').Text,
}));
jest.mock('../../layout/GlassIconButton', () => ({
  GlassIconButton: require('react-native').Pressable,
}));
afterEach(() => jest.restoreAllMocks());

// Synthetic layout events prove ownership coordination, not native hit geometry.
test('prepend anchoring keeps the latest control and explicit activation resumes following', async () => {
  const move = jest.spyOn(ScrollView.prototype, 'scrollTo');
  const follow = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  let finish!: () => void;
  const loadOlder = jest.fn(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  const all = Array.from({ length: 20 }, (_, index) => ({
    id: -(index + 1),
    restoredHistory: true as const,
    role: 'user' as const,
    content: `Synthetic message ${index}`,
  }));
  const props = {
    sessionId: 1,
    pendingMessage: null,
    error: '',
    onOpenSource: jest.fn(),
    onLinkError: jest.fn(),
    onLoadOlderHistory: loadOlder,
  };
  const view = await render(
    <ConversationHistory {...props} messages={all.slice(10)} historyHasMore />,
  );
  const history = () => screen.getByTestId('rag-conversation-history');
  const scroll = (y: number, height: number) =>
    fireEvent.scroll(history(), {
      nativeEvent: {
        contentOffset: { x: 0, y },
        contentSize: { width: 300, height },
        layoutMeasurement: { width: 300, height: 600 },
      },
    });
  await fireEvent(history(), 'layout', {
    nativeEvent: { layout: { height: 600 } },
  });
  await fireEvent(history(), 'scrollBeginDrag');
  await scroll(20, 1200);
  await fireEvent(history(), 'scrollEndDrag');
  expect(loadOlder).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('conversation-jump-latest')).toBeTruthy();
  await fireEvent(screen.getByTestId('conversation-earlier-anchor'), 'layout', {
    nativeEvent: { layout: { y: 24 } },
  });
  await view.rerender(
    <ConversationHistory {...props} messages={all} historyHasMore={false} />,
  );
  await act(async () => finish());
  await fireEvent(screen.getByTestId('conversation-earlier-anchor'), 'layout', {
    nativeEvent: { layout: { y: 724 } },
  });
  expect(move).toHaveBeenLastCalledWith({ y: 720, animated: false });
  await scroll(720, 1900);
  expect(screen.getByTestId('conversation-jump-latest')).toBeTruthy();
  follow.mockClear();
  await fireEvent(history(), 'contentSizeChange', 300, 2000);
  expect(follow).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('conversation-jump-latest'));
  expect(move).toHaveBeenLastCalledWith({ y: 1400, animated: true });
  expect(screen.queryByTestId('conversation-jump-latest')).toBeNull();
  await scroll(1400, 2000);
  await fireEvent(history(), 'contentSizeChange', 300, 2100);
  expect(follow).toHaveBeenCalledTimes(1);
  expect(loadOlder).toHaveBeenCalledTimes(1);
});
