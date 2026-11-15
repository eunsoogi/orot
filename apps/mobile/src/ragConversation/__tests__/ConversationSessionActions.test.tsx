import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Button, StyleSheet, View } from 'react-native';
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

/** Header actions follow the chosen mockup without losing accessible session controls. */
test('uses circular glass actions and opens a separate history destination', async () => {
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
  const history = screen.getByLabelText(copy.sessions);
  const create = screen.getByLabelText(copy.newConversation);
  for (const action of [history, create]) {
    expect(StyleSheet.flatten(action.props.style)).toMatchObject({
      width: 44,
      height: 44,
      borderRadius: 0,
      backgroundColor: 'transparent',
      overflow: 'visible',
    });
  }
  expect(history.props.onAction).toEqual(expect.any(Function));
  expect(create.props.onAction).toEqual(expect.any(Function));
  expect(screen.queryByText(copy.sessions)).toBeNull();
  expect(screen.queryByText(copy.newConversation)).toBeNull();
  await fireEvent.press(create);
  await fireEvent.press(history);
  expect(onOpenHistory).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('rag-conversation-sessions')).toBeNull();
});

test('registers history and new-session actions on a Duo rail without interrupting generation', async () => {
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
  await waitFor(() =>
    expect(screen.getByTestId('dock-conversation-history')).toBeTruthy(),
  );
  expect(screen.queryByTestId('rag-conversation-sessions-toggle')).toBeNull();
  expect(screen.queryByTestId('rag-conversation-new-session')).toBeNull();
  expect(screen.getAllByLabelText(copy.sessions)).toHaveLength(1);
  expect(screen.getAllByLabelText(copy.newConversation)).toHaveLength(1);
  expect(
    screen.getByTestId('dock-conversation-history').props.accessibilityLabel,
  ).toBe(copy.sessions);
  expect(
    screen.getByTestId('dock-conversation-new-session').props
      .accessibilityLabel,
  ).toBe(copy.newConversation);

  const conversationId = store!.getSnapshot().activeId;
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '진행 중인 질문',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(
    await screen.findByTestId('rag-conversation-activity-bubble', {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
  expect(
    store!.getSnapshot().sessions.find(session => session.id === conversationId)
      ?.busy,
  ).toBe(true);

  await fireEvent.press(screen.getByTestId('dock-conversation-history'));
  expect(onOpenHistory).toHaveBeenCalledTimes(1);
  expect(requestSignal?.aborted).toBe(false);

  await fireEvent.press(screen.getByTestId('dock-conversation-new-session'));
  expect(store!.getSnapshot().activeId).not.toBe(conversationId);
  expect(
    store!.getSnapshot().sessions.find(session => session.id === conversationId)
      ?.busy,
  ).toBe(true);
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
