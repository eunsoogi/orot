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

test('keeps the expanded header and messages in one scroll owner without history or manual new-chat actions', async () => {
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
    within(history).queryByRole('header', {
      name: getRagConversationCopy().title,
    }),
  ).toBeNull();
  expect(within(history).getByText('합성 제공자')).toBeTruthy();
  expect(history.props.keyboardShouldPersistTaps).toBe('handled');
  expect(
    within(history).queryByTestId('rag-conversation-sessions-toggle'),
  ).toBeNull();
  expect(onOpenHistory).not.toHaveBeenCalled();
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '합성 초안',
  );
  expect(
    within(history).queryByTestId('rag-conversation-new-session'),
  ).toBeNull();
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
    '합성 초안',
  );
});
