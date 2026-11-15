import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ConversationScreen } from '../ConversationScreen';
import { getRagConversationCopy } from '../copy';
import { conversationComposerLayout } from '../conversationComposerLayout';

test('budgets the observed short viewport without removing navigation clearance', () => {
  const layout = conversationComposerLayout(178, 100, 1);
  expect(layout.compact).toBe(true);
  expect(178 - 100 - layout.maximumInputHeight).toBeGreaterThanOrEqual(24);
  expect(layout.maximumInputHeight).toBeGreaterThanOrEqual(44);
  expect(conversationComposerLayout(800, 52, 1).compact).toBe(false);
});

test('reserves a reading viewport when the keyboard leaves a short content frame', async () => {
  await render(
    <ConversationScreen
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
      onSend={jest.fn()}
    />,
  );
  const history = screen.getByTestId('rag-conversation-history');
  await fireEvent(
    screen.getByTestId('conversation-content-viewport'),
    'layout',
    {
      nativeEvent: { layout: { x: 0, y: 0, width: 700, height: 120 } },
    },
  );
  expect(
    within(history).getByText(getRagConversationCopy().disclaimer),
  ).toBeTruthy();
  const input = screen.getByTestId('rag-conversation-input');
  const style = StyleSheet.flatten(input.props.style);
  expect(style.maxHeight).toBeGreaterThanOrEqual(style.minHeight);
  expect(screen.getByTestId('rag-conversation-send')).toBeTruthy();
  await fireEvent.changeText(input, '보존할 초안');
  await fireEvent(
    screen.getByTestId('conversation-content-viewport'),
    'layout',
    {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } },
    },
  );
  expect(input.props.value).toBe('보존할 초안');
  expect(
    within(history).queryByText(getRagConversationCopy().disclaimer),
  ).toBeNull();
});
