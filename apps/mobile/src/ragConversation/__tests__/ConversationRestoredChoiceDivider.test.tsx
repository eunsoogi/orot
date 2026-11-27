import { NavigationGeometryProvider } from '../../navigation/NavigationGeometryProvider';
import { Dimensions, StyleSheet } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { ConversationScreen } from '../ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import type { ConversationSessions } from '../conversationSessions';
import { appColors } from '../../layout/appColors';

/** Exercise cold hydration rather than marking rendered rows restored by hand. */
test.each([
  {
    width: 390,
    height: 120,
    fontScale: 3.0,
    passiveTop: 0,
    composerHeight: 96,
  },
  {
    width: 951,
    height: 669,
    fontScale: 1,
    passiveTop: 16,
    composerHeight: 112,
  },
])(
  'keeps the restored divider and measured composer clearance: %j',
  async ({ width, height, fontScale, passiveTop, composerHeight }) => {
    const original = Dimensions.get('window');
    Dimensions.set({ window: { ...original, width, height, fontScale } });
    let store!: ConversationSessions;
    let attached = false;
    const options = {
      retention: {
        attachExisting: async () => {
          attached = true;
        },
        activeIdentity: () => (attached ? 'synthetic-session' : null),
        activeLease: () => null,
        beginTurn: async () => undefined,
        invalidate: () => {},
      } as never,
      restoreSession: async () => [
        {
          question: 'Synthetic old question',
          answer: 'Synthetic old answer',
          citations: [],
        },
      ],
    };
    function Capture() {
      store = useConversationSessions();
      return (
        <ConversationScreen
          onBack={jest.fn()}
          onOpenSource={jest.fn()}
          onOpenDailyReport={jest.fn()}
          retainedActions={{
            possibilities: jest.fn(),
            visitQuestions: jest.fn(),
            healthSummary: jest.fn(),
          }}
          onSend={async () => ({
            status: 'answer',
            answer: 'Synthetic new answer',
            citations: [],
          })}
        />
      );
    }
    const mount = () =>
      render(
        <ConversationSessionsProvider options={options}>
          <NavigationGeometryProvider>
            <Capture />
          </NavigationGeometryProvider>
        </ConversationSessionsProvider>,
      );
    // A fresh provider models the app being closed and opened again.
    const first = await mount();
    await first.unmount();
    const view = await mount();
    try {
      const widthWithRail = width - (passiveTop ? 64 : 0);
      const sensor = screen.getByTestId('navigation-window-geometry-sensor');
      await fireEvent(sensor, 'geometryChange', {
        nativeEvent: {
          hasHinge: passiveTop > 0,
          navigationSide: passiveTop ? 'right' : 'bottom',
          windowBounds: { x: 0, y: 0, width, height },
          viewportBounds: { x: 0, y: 0, width: widthWithRail, height },
          safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
          reservedRegionsSupported: true,
          reservedRegions: [],
        },
      });
      expect(Boolean(screen.queryByTestId('conversation-activity-pane'))).toBe(
        Boolean(passiveTop),
      );
      await act(() =>
        store.attachExisting('synthetic-session', 0, '2026-11-17T00:00:00Z'),
      );
      expect(screen.getByText('Synthetic old answer')).toBeTruthy();
      const divider = screen.getByTestId('conversation-choices-divider');
      expect(divider).toHaveStyle({
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
      });
      expect(
        within(divider).getByRole('header', { name: '이전 대화' }),
      ).toHaveStyle({ textAlign: 'center', flexShrink: 1 });
      const rules = divider.children.filter(
        node =>
          typeof node !== 'string' && node.props.accessibilityElementsHidden,
      );
      expect(rules).toHaveLength(2);
      for (const rule of rules)
        expect(rule).toHaveStyle({
          flex: 1,
          height: 1,
          backgroundColor: appColors.border,
        });
      const groupGap = StyleSheet.flatten(
        screen.getByTestId('conversation-quick-choices').props.style,
      ).gap;
      expect(
        StyleSheet.flatten(
          screen.getByTestId('conversation-message-container').props.style,
        ).gap,
      ).toBe(groupGap + 8);
      await fireEvent(
        screen.getByTestId('conversation-content-viewport'),
        'layout',
        { nativeEvent: { layout: { width, height } } },
      );
      const report = async (
        testID: string,
        y: number,
        measuredHeight: number,
      ) =>
        fireEvent(screen.getByTestId(testID), 'layout', {
          nativeEvent: { layout: { x: 0, y, height: measuredHeight, width } },
        });
      await report('conversation-floating-composer-overlay', 0, composerHeight);
      await report('rag-conversation-composer', 0, composerHeight);
      await report('rag-conversation-composer-field', passiveTop, 44);
      const padding = () =>
        StyleSheet.flatten(
          screen.getByTestId('rag-conversation-history').props
            .contentContainerStyle,
        ).paddingBottom;
      expect(padding() + passiveTop - composerHeight).toBe(20);
      expect(divider.props.pointerEvents).toBe('none');
      expect(divider.props.accessible).toBe(false);
      expect(
        within(screen.getByTestId('conversation-quick-choices')).getAllByRole(
          'button',
        ),
      ).toHaveLength(4);
      const serialized = () => JSON.stringify(screen.toJSON());
      expect(serialized().indexOf('Synthetic old answer')).toBeLessThan(
        serialized().indexOf('conversation-choices-divider'),
      );
      await fireEvent.changeText(
        screen.getByTestId('rag-conversation-input'),
        'Synthetic new question',
      );
      await fireEvent.press(screen.getByTestId('rag-conversation-send'));
      expect(
        screen.getAllByTestId('conversation-choices-divider'),
      ).toHaveLength(1);
      expect(serialized().indexOf('conversation-choices-divider')).toBeLessThan(
        serialized().indexOf('Synthetic new question'),
      );
      expect(padding()).toBe(composerHeight + (passiveTop ? 20 : 0));
    } finally {
      await view.unmount();
      Dimensions.set({ window: original });
    }
  },
);
