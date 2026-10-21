import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { AppText } from '../../layout/AppText';
import { ConversationScreen } from '../ConversationScreen';
import { ConversationSessionsProvider } from '../ConversationSessionsContext';
import { getRagConversationCopy } from '../copy';

test('keeps the expanded header and messages in one scroll owner with reachable session actions', async () => {
  const onOpenHistory = jest.fn();
  await render(
    <ConversationSessionsProvider>
      <ConversationScreen
        navigationRouteKey="conversation-visual-route"
        onBack={jest.fn()}
        onOpenHistory={onOpenHistory}
        onOpenSource={jest.fn()}
        onSend={async () => ({ status: 'no_evidence' })}
        providerSelection={<AppText>합성 제공자</AppText>}
      />
    </ConversationSessionsProvider>,
  );
  const history = screen.getByTestId('rag-conversation-history');
  // A fixed scaled header can consume the entire reading viewport; its content
  // and actions must be reachable through the conversation's own scroll owner.
  expect(
    within(history).getByRole('header', {
      name: getRagConversationCopy().title,
    }),
  ).toBeTruthy();
  expect(within(history).getByText('합성 제공자')).toBeTruthy();
  expect(history.props.keyboardShouldPersistTaps).toBe('handled');
  await fireEvent.press(
    within(history).getByTestId('rag-conversation-sessions-toggle'),
  );
  expect(onOpenHistory).toHaveBeenCalledTimes(1);
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '합성 초안',
  );
  await fireEvent.press(
    within(history).getByTestId('rag-conversation-new-session'),
  );
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe('');
});
