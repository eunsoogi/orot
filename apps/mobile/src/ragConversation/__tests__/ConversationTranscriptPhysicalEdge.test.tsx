import { fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet, View } from 'react-native';
import {
  NavigationContentFrameContext,
  type NavigationContentFrame,
} from '../../navigation/navigationContentFrame';
import {
  createNavigationGeometrySnapshot,
  type NavigationGeometrySnapshot,
} from '../../navigation/navigationGeometry';
import { ConversationHistory } from '../ConversationHistory';
import { ConversationWorkspace } from '../ConversationWorkspace';
import type { ConversationSession } from '../conversationSessionTypes';

let mockGeometry: NavigationGeometrySnapshot | null;
jest.mock('../../navigation/NavigationGeometryProvider', () => ({
  useNavigationGeometry: () => mockGeometry,
}));
jest.mock('../../assistantAppearance/AssistantAppearanceProvider', () => ({
  useAssistantAppearance: () => ({ ready: true }),
}));
jest.mock('../../assistantAppearance/AssistantHeader', () => ({
  AssistantHeader: () => null,
  activityLabel: () => null,
}));
jest.mock('../../assistantAppearance/FloatingProfileGradient', () => ({
  FloatingProfileGradient: () => null,
}));

const window = { x: 0, y: 0, width: 1000, height: 800 };
const route = { ...window, width: 916 };
const frame: NavigationContentFrame = {
  side: 'right',
  windowFrame: window,
  viewportFrame: window,
  availableContentFrame: route,
  navigationFrame: { ...window, x: 916, width: 84 },
  reservedRegions: [],
};
const session: ConversationSession = {
  id: 1,
  title: '합성 대화',
  createdAt: '2026-11-14T00:00:00Z',
  draft: '',
  busy: false,
  error: '',
  messages: [{ id: 1, role: 'assistant', content: '합성 답변' }],
  pendingMessage: null,
};
const actions = { onOpenSource: jest.fn(), onLinkError: jest.fn() };
const measurable = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};

function scene(contentFrame: NavigationContentFrame, hinge: boolean) {
  mockGeometry = createNavigationGeometrySnapshot({
    windowBounds: window,
    safeAreaInsets: { top: 0, left: 0, right: 0, bottom: 0 },
    hasHinge: hinge,
    navigationSide: 'right',
    reservedRegionsSupported: true,
    reservedRegions: [],
  });
  return (
    <NavigationContentFrameContext.Provider value={contentFrame}>
      <ConversationWorkspace
        session={session}
        sourceActions={actions}
        composer={<View testID="synthetic-composer" />}
      >
        <ConversationHistory
          {...actions}
          messages={session.messages}
          pendingMessage={null}
          error=""
        />
      </ConversationWorkspace>
    </NavigationContentFrameContext.Provider>
  );
}

test('the real rightmost transcript scrolls outside the rail without expanding its inner pane', async () => {
  const originalWindow = Dimensions.get('window');
  Dimensions.set({
    window: {
      ...originalWindow,
      width: window.width,
      height: window.height,
      fontScale: 1,
    },
  });
  const measurement = jest
    .spyOn(measurable.prototype, 'measureInWindow')
    .mockImplementation(callback => callback(0, 0, route.width, route.height));
  try {
    const ui = await render(scene(frame, true));
    try {
      const pane = () => screen.getByTestId('conversation-transcript-pane');
      const history = () => screen.getByTestId('rag-conversation-history');
      const mounted = history();
      const composer = screen.getByTestId('synthetic-composer');
      const width = () =>
        StyleSheet.flatten(pane().props.style)?.width as number;
      const measureTranscript = async (measuredWidth = width()) => {
        const host = history().parent;
        if (!host)
          throw new Error('Expected the stable transcript scroll host');
        await fireEvent(host, 'layout', {
          nativeEvent: {
            layout: { width: measuredWidth, height: 600, x: 0, y: 0 },
          },
        });
      };
      expect(screen.getByTestId('conversation-activity-pane')).toBeVisible();
      expect(width()).toBeLessThan(route.width);
      const inner = width();
      await measureTranscript();
      expect(history().props.scrollIndicatorInsets).toMatchObject({ right: 0 });
      expect(StyleSheet.flatten(history().props.style)).toHaveProperty(
        'marginRight',
        -84,
      );
      expect(
        StyleSheet.flatten(history().props.contentContainerStyle),
      ).toHaveProperty('paddingRight', 84);
      expect(width()).toBe(inner);
      await measureTranscript(inner - 40);
      expect(history().props.scrollIndicatorInsets).toBeUndefined();
      await measureTranscript();
      expect(history().props.scrollIndicatorInsets).toMatchObject({ right: 0 });
      expect(screen.getByTestId('synthetic-composer')).toBe(composer);

      // An adjacent scene with the same height must never borrow the window edge.
      await ui.rerender(
        scene(
          { ...frame, viewportFrame: { ...window, width: route.width } },
          true,
        ),
      );
      await measureTranscript();
      expect(history().props.scrollIndicatorInsets).toBeUndefined();
      expect(history()).toBe(mounted);

      await ui.rerender(scene(frame, false));
      await measureTranscript();
      expect(width()).toBe(route.width);
      expect(history().props.scrollIndicatorInsets).toMatchObject({ right: 0 });
      expect(history()).toBe(mounted);
      expect(screen.getByTestId('synthetic-composer')).toBe(composer);
    } finally {
      await ui.unmount();
    }
  } finally {
    measurement.mockRestore();
    Dimensions.set({ window: originalWindow });
  }
});
