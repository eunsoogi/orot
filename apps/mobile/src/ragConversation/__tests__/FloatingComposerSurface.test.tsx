import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { FloatingComposerSurface } from '../FloatingComposerSurface';
import { ConversationHistory } from '../ConversationHistory';
import { ConversationComposer } from '../ConversationComposer';
import {
  conversationIsNearLatest,
  conversationVisibleOffset,
} from '../conversationVisibleOffset';
import { followConversationLatest } from '../followConversationLatest';

const history = (
  <ConversationHistory
    messages={[]}
    pendingMessage={null}
    error=""
    onOpenSource={jest.fn()}
    onLinkError={jest.fn()}
  />
);
test('floats controls and updates transcript clearance from actual multiline height', async () => {
  const view = await render(
    <FloatingComposerSurface
      composer={
        <ConversationComposer
          value="Synthetic draft"
          busy={false}
          onChangeText={jest.fn()}
          onSend={jest.fn()}
          onCancel={jest.fn()}
        />
      }
    >
      {history}
    </FloatingComposerSurface>,
  );
  const overlay = screen.getByTestId('conversation-floating-composer-overlay');
  expect(StyleSheet.flatten(overlay.props.style)).toMatchObject({
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  });
  expect(
    screen.getByTestId('conversation-composer-gradient', {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
  await fireEvent(overlay, 'layout', {
    nativeEvent: { layout: { height: 96 } },
  });
  expect(
    screen.getByTestId('rag-conversation-history').props.contentContainerStyle
      .paddingBottom,
  ).toBe(116);
  await fireEvent(overlay, 'layout', {
    nativeEvent: { layout: { height: 160 } },
  });
  expect(
    screen.getByTestId('rag-conversation-history').props.contentContainerStyle
      .paddingBottom,
  ).toBe(180);
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
    'Synthetic draft',
  );
  await view.rerender(
    <FloatingComposerSurface>{history}</FloatingComposerSurface>,
  );
  expect(
    screen.getByTestId('rag-conversation-history').props.contentContainerStyle
      .paddingBottom,
  ).toBe(20);
});

test('compact follow stays above the overlay and preserves user scrolling ownership', () => {
  expect(conversationVisibleOffset(600, 400, 100)).toBe(300);
  expect(conversationVisibleOffset(100, 400, 100)).toBe(0);
  expect(conversationVisibleOffset(600, 80, 100)).toBe(600);
  expect(conversationIsNearLatest(600, 400, 100, 900, 300)).toBe(true);
  expect(conversationIsNearLatest(600, 400, 100, 900, 200)).toBe(false);
  const scrollTo = jest.fn();
  const input = {
    hasMessages: true,
    compact: true,
    focused: false,
    bottomInset: 100,
    followsBottom: { current: true },
    messageEnd: { current: 600 },
    viewportHeight: { current: 400 },
    expectedOffset: { current: null as number | null },
    historyView: { current: { scrollTo } as never },
    scrollGeometry: { current: null },
  };
  followConversationLatest(input);
  expect(scrollTo).toHaveBeenCalledWith({ y: 300, animated: false });
  input.followsBottom.current = false;
  followConversationLatest(input);
  expect(scrollTo).toHaveBeenCalledTimes(1);
});
