import { fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView, Text } from 'react-native';
import { ConversationHistory } from '../ConversationHistory';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { FloatingComposerSurface } from '../FloatingComposerSurface';

// Keep native button props visible; actual UIKit geometry is validated separately.
jest.mock('../../layout/GlassIconButton', () => {
  const { Pressable } = require('react-native');
  return { GlassIconButton: (props: object) => <Pressable {...props} /> };
});
const props = {
  messages: [{ id: 1, role: 'user' as const, content: 'Synthetic question' }],
  pendingMessage: null,
  error: '',
  onOpenSource: jest.fn(),
  onLinkError: jest.fn(),
};
const jump = () => screen.queryByTestId('conversation-jump-latest');
const history = () => screen.getByTestId('rag-conversation-history');
const scroll = (offset: number, height = 400, contentHeight = 1000) =>
  fireEvent.scroll(history(), {
    nativeEvent: {
      contentOffset: { x: 0, y: offset },
      contentSize: { width: 300, height: contentHeight },
      layoutMeasurement: { width: 300, height },
    },
  });
const layout = (height: number) =>
  fireEvent(history(), 'layout', {
    nativeEvent: { layout: { height } },
  });
const end = (y: number) =>
  fireEvent(screen.getByTestId('rag-conversation-message-end'), 'layout', {
    nativeEvent: { layout: { y } },
  });

afterEach(() => jest.restoreAllMocks());

test('appears only above the latest position and resumes following when activated', async () => {
  const move = jest.spyOn(ScrollView.prototype, 'scrollTo');
  const follow = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  await render(<ConversationHistory {...props} />);
  expect(jump()).toBeNull();
  await layout(400);
  await scroll(600);
  expect(jump()).toBeNull();
  await fireEvent(history(), 'scrollBeginDrag');
  await scroll(100);
  expect(jump()).toHaveProp('accessibilityLabel', '최신 메시지로 이동');
  expect(jump()).toHaveStyle({ width: 44, height: 44 });
  expect(jump()).toHaveProp('visualScale', 0.5);
  follow.mockClear();
  await fireEvent(history(), 'contentSizeChange', 300, 1200);
  expect(follow).not.toHaveBeenCalled();
  await fireEvent.press(jump()!);
  expect(move).toHaveBeenLastCalledWith({ y: 800, animated: true });
  expect(jump()).toBeNull();
  await scroll(800, 400, 1200);
  await fireEvent(history(), 'contentSizeChange', 300, 1300);
  expect(follow).toHaveBeenCalledTimes(1);
});

test('hides for short content and after returning to the bottom manually', async () => {
  await render(<ConversationHistory {...props} />);
  await scroll(0, 400, 200);
  expect(jump()).toBeNull();
  await scroll(100);
  expect(jump()).not.toBeNull();
  await scroll(600);
  expect(jump()).toBeNull();
});

test('targets the message end before footer and tracks measured composer growth', async () => {
  const move = jest.spyOn(ScrollView.prototype, 'scrollTo');
  await render(
    <FloatingComposerSurface composer={<Text>Composer</Text>}>
      <ConversationHistory {...props} compact footer={<Text>Sources</Text>} />
    </FloatingComposerSurface>,
  );
  await layout(400);
  await end(1000);
  await scroll(600, 400, 1400);
  expect(jump()).toBeNull();
  await fireEvent(
    screen.getByTestId('conversation-floating-composer-overlay'),
    'layout',
    {
      nativeEvent: { layout: { height: 120 } },
    },
  );
  expect(jump()).not.toBeNull();
  expect(screen.getByTestId('conversation-jump-latest-position')).toHaveStyle({
    bottom: 128,
    left: 0,
    right: 0,
    alignItems: 'center',
  });
  await fireEvent.press(jump()!);
  expect(move).toHaveBeenLastCalledWith({ y: 720, animated: true });
});

test('reflow updates visibility without stealing the reader position', async () => {
  const move = jest.spyOn(ScrollView.prototype, 'scrollTo');
  await render(<ConversationHistory {...props} compact />);
  await layout(400);
  await end(1000);
  await fireEvent(history(), 'scrollBeginDrag');
  await scroll(200);
  await fireEvent(history(), 'scrollEndDrag');
  move.mockClear();
  await layout(300);
  await end(1200);
  expect(jump()).not.toBeNull();
  expect(move).not.toHaveBeenCalled();
  await fireEvent.press(jump()!);
  expect(move).toHaveBeenLastCalledWith({ y: 900, animated: true });
});

test('does not carry the prior session button into another conversation', async () => {
  const view = await render(<ConversationHistory {...props} sessionId={1} />);
  await scroll(100);
  expect(jump()).not.toBeNull();
  await view.rerender(<ConversationHistory {...props} sessionId={2} />);
  expect(jump()).toBeNull();
});

test('Reduce Motion jumps immediately and preserves the same destination', async () => {
  const move = jest.spyOn(ScrollView.prototype, 'scrollTo');
  await render(
    <NavigationMotionContext.Provider value={true}>
      <ConversationHistory {...props} />
    </NavigationMotionContext.Provider>,
  );
  await layout(400);
  await scroll(100);
  await fireEvent.press(jump()!);
  expect(move).toHaveBeenLastCalledWith({ y: 600, animated: false });
});

test('animation frames do not become reader intent and a fresh drag cancels following', async () => {
  const follow = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  await render(<ConversationHistory {...props} />);
  await layout(400);
  await scroll(100);
  await fireEvent.press(jump()!);
  await scroll(300);
  expect(jump()).toBeNull();
  follow.mockClear();
  await fireEvent(history(), 'contentSizeChange', 300, 1200);
  expect(follow).not.toHaveBeenCalled();
  await fireEvent(history(), 'scrollBeginDrag');
  await scroll(250, 400, 1200);
  expect(jump()).not.toBeNull();
  await fireEvent(history(), 'contentSizeChange', 300, 1300);
  expect(follow).not.toHaveBeenCalled();
});

test('finishes at the new latest position if content grows during the animation', async () => {
  const move = jest.spyOn(ScrollView.prototype, 'scrollTo');
  await render(<ConversationHistory {...props} />);
  await layout(400);
  await scroll(100);
  await fireEvent.press(jump()!);
  await scroll(600, 400, 1200);
  expect(move).toHaveBeenLastCalledWith({ y: 800, animated: true });
  expect(jump()).toBeNull();
  await scroll(800, 400, 1200);
  expect(jump()).toBeNull();
});

test('enabling Reduce Motion during a jump completes it without animation', async () => {
  const move = jest.spyOn(ScrollView.prototype, 'scrollTo');
  const view = await render(
    <NavigationMotionContext.Provider value={false}>
      <ConversationHistory {...props} />
    </NavigationMotionContext.Provider>,
  );
  await layout(400);
  await scroll(100);
  await fireEvent.press(jump()!);
  await scroll(300);
  await view.rerender(
    <NavigationMotionContext.Provider value={true}>
      <ConversationHistory {...props} />
    </NavigationMotionContext.Provider>,
  );
  expect(move).toHaveBeenLastCalledWith({ y: 600, animated: false });
});

test('status-bar scroll to top cancels an in-flight jump and restores its control', async () => {
  const follow = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  await render(<ConversationHistory {...props} />);
  await layout(400);
  await scroll(100);
  await fireEvent.press(jump()!);
  await scroll(300);
  await fireEvent(history(), 'scrollToTop');
  await scroll(0);
  expect(jump()).not.toBeNull();
  follow.mockClear();
  await fireEvent(history(), 'contentSizeChange', 300, 1200);
  expect(follow).not.toHaveBeenCalled();
});

test('a new saved-reply focus cancels the old animated destination', async () => {
  const move = jest.spyOn(ScrollView.prototype, 'scrollTo');
  const messages = [
    {
      id: 1,
      role: 'assistant' as const,
      content: 'Synthetic reply',
      retainedTurnId: 'reply',
    },
  ];
  const view = await render(
    <ConversationHistory {...props} messages={messages} />,
  );
  await layout(400);
  await scroll(100);
  await fireEvent.press(jump()!);
  await scroll(300);
  await view.rerender(
    <ConversationHistory
      {...props}
      messages={messages}
      replyFocus={{
        generation: 1,
        messageId: 'reply',
        canReveal: () => true,
        complete: () => true,
      }}
    />,
  );
  await fireEvent(
    screen.getByTestId('conversation-message-container'),
    'layout',
    { nativeEvent: { layout: { y: 24 } } },
  );
  await fireEvent(screen.getByTestId('conversation-reply-focus'), 'layout', {
    nativeEvent: { layout: { y: 0 } },
  });
  expect(move).toHaveBeenLastCalledWith({ y: 24, animated: false });
  await scroll(24);
  expect(jump()).not.toBeNull();
  expect(move).toHaveBeenLastCalledWith({ y: 24, animated: false });
});
