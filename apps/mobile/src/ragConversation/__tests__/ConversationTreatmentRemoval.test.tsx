import { fireEvent, render, screen } from '@testing-library/react-native';
import { t } from '../../i18n';
import { ConversationScreen } from '../ConversationScreen';
import { ConversationStoredTaskCards } from '../ConversationTaskPanels';
import { createConversationSessions } from '../conversationSessions';
import { createEmptyConversation } from '../conversationEmptySession';

// Synthetic UI fixtures prove removal without altering retained user artifacts.
test('removes treatment exploration and preserves explicit report requests', async () => {
  const request = jest.fn();
  await render(
    <ConversationScreen
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
      onSend={jest.fn()}
      onOpenDailyReport={request}
    />,
  );
  expect(screen.queryByText(t('treatmentSafety.open'))).toBeNull();
  await fireEvent.press(screen.getByTestId('daily-report-request'));
  expect(request).toHaveBeenCalledTimes(1);
});

test('retains historical treatment cards without exposing generation or mutating storage', async () => {
  const store = createConversationSessions();
  const save = jest.spyOn(store, 'saveTaskCard');
  const forget = jest.spyOn(store, 'forgetTaskCard');
  const session = {
    ...createEmptyConversation(1),
    taskCards: [
      {
        id: 'treatment:synthetic',
        createdAt: '2026-11-14T00:00:00Z',
        revision: 1,
        task: { kind: 'treatment' as const, artifactId: 'synthetic' },
      },
    ],
  };
  const original = JSON.stringify(session);
  const view = await render(
    <ConversationStoredTaskCards
      store={store}
      session={session}
      onOpenSource={jest.fn()}
      durableSessionId="synthetic"
    />,
  );
  expect(screen.queryByTestId('inline-treatment-task')).toBeNull();
  expect(screen.queryByText(t('treatmentSafety.saved'))).toBeNull();
  await view.unmount();
  expect(JSON.stringify(session)).toBe(original);
  expect(save).not.toHaveBeenCalled();
  expect(forget).not.toHaveBeenCalled();
  store.dispose();
});
