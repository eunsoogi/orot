import { fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView, Text } from 'react-native';
import { ConversationComposer } from '../ConversationComposer';
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

test('the above-field hit target floats over only passive padding and still uses the history jump', async () => {
  const move = jest.spyOn(ScrollView.prototype, 'scrollTo');
  const scenario = (status = '') => (
    <FloatingComposerSurface
      composer={
        <ConversationComposer
          value="Synthetic multiline text"
          busy={false}
          onChangeText={jest.fn()}
          onSend={jest.fn()}
          onCancel={jest.fn()}
          status={status}
        />
      }
    >
      <ConversationHistory {...props} />
    </FloatingComposerSurface>
  );
  const view = await render(scenario());
  const measured = (id: string, frame: { y: number; height: number }) =>
    fireEvent(screen.getByTestId(id), 'layout', {
      nativeEvent: { layout: { x: 0, width: 300, ...frame } },
    });
  const overlayId = 'conversation-floating-composer-overlay';
  const frameId = 'rag-conversation-composer';
  const fieldId = 'rag-conversation-composer-field';
  const position = () =>
    screen.getByTestId('conversation-jump-latest-position');
  await layout(400);
  await scroll(100);
  await measured(overlayId, { y: 0, height: 168 });
  await measured(frameId, { y: 0, height: 168 });
  await measured(fieldId, { y: 16, height: 120 });
  expect(position()).toHaveStyle({ bottom: 152 });
  expect(jump()).toHaveStyle({ width: 44, height: 44 });
  const overlay = screen.getByTestId(overlayId);
  const siblings = overlay.parent!.children;
  expect(position().parent).toBe(overlay.parent);
  expect(siblings.indexOf(position())).toBeGreaterThan(
    siblings.indexOf(overlay),
  );
  expect(history().props.contentContainerStyle).toMatchObject({
    paddingBottom: 188,
  });

  await view.rerender(scenario('A protected status row'));
  await measured(overlayId, { y: 0, height: 248 });
  await measured(fieldId, { y: 96, height: 120 });
  expect(position()).toHaveStyle({ bottom: 248 });
  expect(screen.getByText('A protected status row')).toBeVisible();

  await view.rerender(scenario());
  await measured(frameId, { y: 44, height: 168 });
  await measured(fieldId, { y: 16, height: 120 });
  await measured(overlayId, { y: 0, height: 212 });
  expect(position()).toHaveStyle({ bottom: 212 });

  await fireEvent.press(jump()!);
  expect(move).toHaveBeenLastCalledWith({ y: 600, animated: true });
  expect(jump()).toBeNull();
});
