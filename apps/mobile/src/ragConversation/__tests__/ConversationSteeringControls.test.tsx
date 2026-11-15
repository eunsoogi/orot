import { render, fireEvent } from '@testing-library/react-native';
import { ConversationSteeringControls } from '../ConversationSteeringControls';
import type { ConversationSession } from '../conversationSessionTypes';
import { t } from '../../i18n';
const session: ConversationSession = {
  id: 1,
  title: '',
  createdAt: '',
  draft: 'Keep it short',
  messages: [],
  pendingMessage: null,
  busy: true,
  error: '',
  steeringAvailable: true,
};
test('offers a separate steering action and distinguishes queued from applied', async () => {
  const send = jest.fn();
  const view = await render(
    <ConversationSteeringControls
      session={{
        ...session,
        steeringInstructions: [
          { id: 'a', text: 'First', sequence: 1, status: 'queued' },
          { id: 'b', text: 'Second', sequence: 2, status: 'applied' },
        ],
      }}
      onSend={send}
    />,
  );
  await fireEvent.press(view.getByTestId('conversation-steering-send'));
  expect(send).toHaveBeenCalledTimes(1);
  expect(
    view.getByText(`1. First · ${t('conversationSteering.queued')}`),
  ).toBeTruthy();
  expect(
    view.getByText(`2. Second · ${t('conversationSteering.applied')}`),
  ).toBeTruthy();
  await view.rerender(
    <ConversationSteeringControls
      session={{ ...session, draft: '' }}
      onSend={send}
    />,
  );
  await fireEvent.press(view.getByTestId('conversation-steering-send'));
  expect(send).toHaveBeenCalledTimes(1);
});
test('does not expose steering before a durable owner exists', async () => {
  const view = await render(
    <ConversationSteeringControls
      session={{ ...session, steeringAvailable: false }}
      onSend={jest.fn()}
    />,
  );
  expect(view.queryByTestId('conversation-steering-send')).toBeNull();
});
