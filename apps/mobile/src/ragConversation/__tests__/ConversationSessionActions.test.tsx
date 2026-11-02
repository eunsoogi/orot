import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, StyleSheet, View } from 'react-native';
import { ConversationScreen } from '../ConversationScreen';
import { getRagConversationCopy } from '../copy';
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
      borderRadius: 22,
      backgroundColor: 'transparent',
      overflow: 'hidden',
    });
  }
  expect(
    screen.getByTestId('rag-conversation-history-glass').props.pointerEvents,
  ).toBe('none');
  expect(
    screen.getByTestId('rag-conversation-new-glass').props.pointerEvents,
  ).toBe('none');
  expect(screen.queryByText(copy.sessions)).toBeNull();
  expect(screen.queryByText(copy.newConversation)).toBeNull();
  await fireEvent.press(create);
  await fireEvent.press(history);
  expect(onOpenHistory).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('rag-conversation-sessions')).toBeNull();
});

test('keeps session controls in the accessible header instead of the navigation dock', async () => {
  const onOpenHistory = jest.fn();
  function Fixture() {
    const { host, actions } = useNavigationPrimaryActionHost('conversation');
    return (
      <NavigationPrimaryActionContext.Provider value={host}>
        <ConversationScreen
          navigationRouteKey="conversation"
          onBack={jest.fn()}
          onOpenHistory={onOpenHistory}
          onOpenSource={jest.fn()}
          onSend={jest.fn()}
        />
        <View>
          {actions.map(action => (
            <Button
              key={action.id}
              title={action.label}
              testID={`dock-${action.id}`}
              onPress={action.onPress}
            />
          ))}
        </View>
      </NavigationPrimaryActionContext.Provider>
    );
  }

  await render(<Fixture />);
  const copy = getRagConversationCopy();
  expect(screen.queryByTestId('dock-conversation-history')).toBeNull();
  expect(screen.queryByTestId('dock-new-conversation')).toBeNull();
  expect(screen.getByLabelText(copy.sessions)).toBeTruthy();
  expect(screen.getByLabelText(copy.newConversation)).toBeTruthy();

  await fireEvent(screen.getByTestId('rag-conversation-input'), 'focus');
  await fireEvent.press(screen.getByLabelText(copy.sessions));
  await fireEvent.press(screen.getByLabelText(copy.newConversation));
  expect(onOpenHistory).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe('');
});
