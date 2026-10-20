import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ConversationScreen } from '../ConversationScreen';
import { getRagConversationCopy } from '../copy';

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
