import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { ConversationHistory } from '../ConversationHistory';
import { ConversationQuickChoices } from '../ConversationQuickChoices';
import { conversationRestoredMessages } from '../conversationRestoredMessages';
import type { DisplayMessage } from '../conversationDisplayMessage';
jest.mock('../../layout/AiResponseText', () => ({
  AiResponseText: require('react-native').Text,
}));
const base = {
  pendingMessage: null,
  error: '',
  onOpenSource: jest.fn(),
  onLinkError: jest.fn(),
};
function Choices() {
  const [selected, setSelected] = useState(false);
  return (
    <ConversationQuickChoices>
      <Pressable accessibilityRole="button" onPress={() => setSelected(true)}>
        <Text>
          {selected ? 'Synthetic selected choice' : 'Synthetic choices'}
        </Text>
      </Pressable>
    </ConversationQuickChoices>
  );
}
let nextId = 100;
const restored = (label: string) =>
  conversationRestoredMessages(
    [
      {
        question: label + ' question',
        answer: label + ' answer',
        citations: [],
      },
    ],
    [],
    () => ++nextId,
  );
const live: DisplayMessage[] = [
  { id: -10, role: 'user', content: 'Synthetic new question' },
  { id: -11, role: 'assistant', content: 'Synthetic new answer' },
];
const history = (messages: DisplayMessage[], sessionId = 1) => (
  <ConversationHistory
    {...base}
    messages={messages}
    sessionId={sessionId}
    onLoadOlderHistory={async () => {}}
    entryChoices={<Choices />}
  />
);
const order = (...strings: string[]) => {
  const serialized = JSON.stringify(screen.toJSON());
  strings.reduce((previous, value) => {
    const position = serialized.indexOf(value);
    expect(position).toBeGreaterThan(previous);
    return position;
  }, -1);
};
test('restored history stays above one stable choice block and later live turns stay below it', async () => {
  const old = restored('Synthetic old');
  expect(old.every(message => message.restoredHistory)).toBe(true);
  const view = await render(history([]));
  await view.rerender(history(old));
  order('Synthetic old answer', 'conversation-quick-choices');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Synthetic choices' }),
  );
  await view.rerender(history([...old, ...live]));
  order(
    'Synthetic old answer',
    'conversation-quick-choices',
    'Synthetic new question',
    'Synthetic new answer',
  );
  expect(screen.getByText('Synthetic selected choice')).toBeTruthy();
  const earlier = restored('Synthetic earlier');
  await view.rerender(history([...earlier, ...old, ...live]));
  order(
    'Synthetic earlier answer',
    'Synthetic old answer',
    'conversation-quick-choices',
    'Synthetic new question',
  );
  expect(screen.getAllByTestId('conversation-quick-choices')).toHaveLength(1);
  expect(screen.getByText('Synthetic selected choice')).toBeTruthy();
  await view.rerender(history(live));
  order('conversation-quick-choices', 'Synthetic new question');
  expect(screen.queryByText('Synthetic old answer')).toBeNull();
});
test('an empty or replacement session has its choices before new messages', async () => {
  const view = await render(history(live));
  order('conversation-quick-choices', 'Synthetic new question');
  await view.rerender(history([], 2));
  expect(screen.queryByText('Synthetic new question')).toBeNull();
  expect(screen.getAllByTestId('conversation-quick-choices')).toHaveLength(1);
  await view.rerender(history(restored('Synthetic replacement'), 2));
  order('Synthetic replacement answer', 'conversation-quick-choices');
});
