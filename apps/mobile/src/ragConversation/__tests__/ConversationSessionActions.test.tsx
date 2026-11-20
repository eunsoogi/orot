import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Button, View } from 'react-native';
import { ConversationScreen } from '../ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import type { ConversationSessions } from '../conversationSessions';
import { getRagConversationCopy } from '../copy';
import type { RagConversationOutcome } from '../service';
import { NavigationOcclusionContext } from '../../navigation/useNavigationContentInset';
import { NavigationGeometryProvider } from '../../navigation/NavigationGeometryProvider';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';

/** Session navigation is removed without changing transcript typography or input. */
test('does not expose history or manual new chat in the header', async () => {
  const onOpenHistory = jest.fn();
  await render(
    <ConversationScreen
      onBack={jest.fn()}
      onOpenHistory={onOpenHistory}
      onOpenSource={jest.fn()}
      onSend={jest.fn()}
    />,
  );
  const copy = getRagConversationCopy();
  expect(screen.queryByText(copy.title)).toBeNull();
  expect(screen.queryByLabelText(copy.sessions)).toBeNull();
  expect(screen.queryByLabelText(copy.newConversation)).toBeNull();
  expect(onOpenHistory).not.toHaveBeenCalled();
});

test('omits session actions on a Duo rail without interrupting generation', async () => {
  let store: ConversationSessions | null = null;
  let requestSignal: AbortSignal | undefined;
  let finish!: (outcome: RagConversationOutcome) => void;
  const onOpenHistory = jest.fn();
  const send = jest.fn<
    ReturnType<React.ComponentProps<typeof ConversationScreen>['onSend']>,
    Parameters<React.ComponentProps<typeof ConversationScreen>['onSend']>
  >();
  send.mockImplementation((_question, _messages, signal) => {
    requestSignal = signal;
    return new Promise(resolve => {
      finish = resolve;
    });
  });
  const copy = getRagConversationCopy();
  const duoRailOcclusion = {
    placement: 'right' as const,
    systemInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    viewportInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    scrollContentInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  };

  function StoreObserver() {
    store = useConversationSessions();
    return null;
  }

  function Fixture() {
    const { host, actions } = useNavigationPrimaryActionHost('conversation');
    return (
      <NavigationGeometryProvider>
        <ConversationSessionsProvider>
          <StoreObserver />
          <NavigationOcclusionContext.Provider value={duoRailOcclusion}>
            <NavigationPrimaryActionContext.Provider value={host}>
              <ConversationScreen
                navigationRouteKey="conversation"
                onBack={jest.fn()}
                onOpenHistory={onOpenHistory}
                onOpenSource={jest.fn()}
                onSend={send}
              />
              <View>
                {actions.map(action => (
                  <Button
                    key={action.id}
                    title={action.label}
                    accessibilityLabel={action.accessibilityLabel}
                    disabled={action.disabled}
                    testID={`dock-${action.id}`}
                    onPress={() => action.onPress()}
                  />
                ))}
              </View>
            </NavigationPrimaryActionContext.Provider>
          </NavigationOcclusionContext.Provider>
        </ConversationSessionsProvider>
      </NavigationGeometryProvider>
    );
  }

  await render(<Fixture />);
  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    {
      nativeEvent: {
        windowBounds: { x: 0, y: 0, width: 800, height: 800 },
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
        reservedRegionsSupported: true,
        hasHinge: true,
        reservedRegions: [],
      },
    },
  );
  expect(screen.queryByTestId('dock-conversation-history')).toBeNull();
  expect(screen.queryByTestId('dock-conversation-new-session')).toBeNull();
  expect(screen.queryByText(copy.title)).toBeNull();
  expect(screen.queryByLabelText(copy.sessions)).toBeNull();
  expect(screen.queryByLabelText(copy.newConversation)).toBeNull();
  const conversationId = store!.getSnapshot().activeId;
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '진행 중인 질문',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(
    screen.queryByTestId('rag-conversation-activity-bubble', {
      includeHiddenElements: true,
    }),
  ).toBeNull();
  expect(
    store!.getSnapshot().sessions.find(session => session.id === conversationId)
      ?.busy,
  ).toBe(true);

  expect(onOpenHistory).not.toHaveBeenCalled();
  expect(store!.getSnapshot().activeId).toBe(conversationId);
  expect(requestSignal?.aborted).toBe(false);
  expect(send).toHaveBeenCalledTimes(1);

  await act(async () => {
    finish({ status: 'answer', answer: '완료된 이전 대화', citations: [] });
  });
  await waitFor(() =>
    expect(
      store!
        .getSnapshot()
        .sessions.find(session => session.id === conversationId)?.busy,
    ).toBe(false),
  );
  expect(
    store!
      .getSnapshot()
      .sessions.find(session => session.id === conversationId)
      ?.messages.map(message => message.content),
  ).toEqual(['진행 중인 질문', '완료된 이전 대화']);
});
