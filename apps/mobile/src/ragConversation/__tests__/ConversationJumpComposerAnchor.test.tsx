import { fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView, Text } from 'react-native';
import { ConversationHistory } from '../ConversationHistory';
import { trackJumpLatestMotion } from '../testSupport/jumpLatestMotion';
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

beforeEach(() => {
  trackJumpLatestMotion(true);
});
afterEach(() => jest.restoreAllMocks());

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
    bottom: 120,
    left: 0,
    right: 0,
    alignItems: 'center',
  });
  await fireEvent.press(jump()!);
  expect(move).toHaveBeenLastCalledWith({ y: 720, animated: true });
});

test.each([true, false])(
  'anchors to the composer as attachments and multiline layout change (compact: %s)',
  async compact => {
    await render(
      <FloatingComposerSurface composer={<Text>Composer</Text>}>
        <ConversationHistory {...props} compact={compact} />
      </FloatingComposerSurface>,
    );
    await layout(400);
    await scroll(100);
    expect(jump()).toBeNull();
    const overlay = screen.getByTestId(
      'conversation-floating-composer-overlay',
    );
    for (const height of [72, 164, 112, 72]) {
      await fireEvent(overlay, 'layout', {
        nativeEvent: { layout: { height } },
      });
      expect(
        screen.getByTestId('conversation-jump-latest-position'),
      ).toHaveStyle({
        bottom: height,
      });
      expect(jump()).toHaveStyle({ width: 44, height: 44 });
      expect(history().props.contentContainerStyle).toMatchObject({
        paddingBottom: height + (compact ? 0 : 20),
      });
    }
    await scroll(600);
    expect(jump()).toBeNull();
  },
);
