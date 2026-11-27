import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet, View } from 'react-native';
import { FloatingComposerSurface } from '../FloatingComposerSurface';
import { ConversationHistory } from '../ConversationHistory';
import { ConversationWorkspace } from '../ConversationWorkspace';
import { ConversationComposer } from '../ConversationComposer';
import {
  conversationIsNearLatest,
  conversationVisibleOffset,
} from '../conversationVisibleOffset';
import { followConversationLatest } from '../followConversationLatest';

jest.mock('../../assistantAppearance/AssistantAppearanceProvider', () => ({
  useAssistantAppearance: () => ({ ready: true }),
}));
jest.mock('../../assistantAppearance/AssistantHeader', () => ({
  AssistantHeader: () => null,
  activityLabel: () => '',
}));
jest.mock('../../navigation/NavigationGeometryProvider', () => ({
  useNavigationGeometry: () => ({
    hasHinge: true,
    reservedRegions: [],
    usableRegions: [],
    safeAreaFrame: { x: 0, y: 0, width: 1000, height: 800 },
  }),
}));
const session = {
  id: 1,
  title: 'Synthetic conversation',
  createdAt: '2035-01-01T00:00:00Z',
  draft: '',
  busy: false,
  error: '',
  messages: [],
  pendingMessage: null,
};
const sourceActions = { onOpenSource: jest.fn(), onLinkError: jest.fn() };
function scene(compact: boolean) {
  return (
    <ConversationWorkspace
      session={session}
      sourceActions={sourceActions}
      composer={
        <ConversationComposer
          compact={compact}
          value="Synthetic draft"
          busy={false}
          onChangeText={jest.fn()}
          onSend={jest.fn()}
          onCancel={jest.fn()}
        />
      }
    >
      {history}
    </ConversationWorkspace>
  );
}
test('retains only the passive profile backdrop with compact and wide composers', async () => {
  let width = 390;
  const window = Dimensions.get('window');
  const measurement = jest
    .spyOn(
      (View as unknown as { prototype: Pick<View, 'measureInWindow'> })
        .prototype,
      'measureInWindow',
    )
    .mockImplementation(callback => callback(0, 0, width, 800));
  Dimensions.set({ window: { ...window, fontScale: 1 } });
  try {
    const view = await render(scene(true));
    const hidden = { includeHiddenElements: true };
    for (const nextWidth of [390, 1000, 390]) {
      width = nextWidth;
      const compact = width === 390;
      await view.rerender(scene(compact));
      await fireEvent(screen.getByTestId('conversation-workspace'), 'layout', {
        nativeEvent: { layout: { width } },
      });
      expect(Boolean(screen.queryByTestId('conversation-activity-pane'))).toBe(
        !compact,
      );
      expect(
        screen.getByTestId('assistant-floating-gradient', hidden).props
          .pointerEvents,
      ).toBe('none');
      expect(
        screen.queryByTestId('conversation-composer-gradient', hidden),
      ).toBeNull();
      expect(
        screen.getByTestId('rag-conversation-composer-glass', hidden),
      ).toBeTruthy();
    }
  } finally {
    measurement.mockRestore();
    await act(() => Dimensions.set({ window }));
  }
});

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
