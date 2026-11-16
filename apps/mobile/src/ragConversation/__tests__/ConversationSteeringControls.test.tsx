import { render } from '@testing-library/react-native';
import { ConversationSteeringControls } from '../ConversationSteeringControls';
import { ConversationSteeringMessages } from '../ConversationSteeringMessages';
import type { ConversationSession } from '../conversationSessionTypes';
const session = { busy: true, steeringAvailable: true } as ConversationSession;

test.each(['live', 'limit_reached', undefined] as const)(
  'does not present mode %s as an unsupported ChatGPT connection',
  async mode => {
    const view = await render(
      <ConversationSteeringControls
        session={{ ...session, steeringDeliveryMode: mode }}
      />,
    );
    expect(view.toJSON()).toBeNull();
    expect(view.queryByTestId('conversation-steering-send')).toBeNull();
  },
);
test('keeps local save failure next to the untouched draft', async () => {
  const view = await render(
    <ConversationSteeringControls
      session={{ ...session, steeringError: true }}
    />,
  );
  expect(
    view.getByText(
      '추가 지시를 저장하지 못했어요. 입력한 내용은 그대로 두었어요.',
    ),
  ).toBeTruthy();
});
test.each(['queued', 'prepared', 'delivery_pending'] as const)(
  'local %s does not invent sent or read',
  async status => {
    const view = await render(
      <ConversationSteeringMessages
        instructions={[
          { id: 'a', text: 'Synthetic instruction', sequence: 1, status },
        ]}
      />,
    );
    expect(view.getByText('Synthetic instruction')).toBeTruthy();
    expect(view.queryByText('보냄')).toBeNull();
    expect(view.queryByText('읽음')).toBeNull();
  },
);
test('renders one user bubble with accepted then applied receipts, never an ordinal queue', async () => {
  const row = {
    id: 'a',
    text: 'Synthetic instruction',
    sequence: 1,
    status: 'delivery_pending' as const,
    serverAccepted: true,
  };
  const view = await render(
    <ConversationSteeringMessages instructions={[row]} />,
  );
  expect(view.getByText('보냄')).toBeTruthy();
  expect(view.queryByText('읽음')).toBeNull();
  expect(view.getAllByTestId('conversation-steering-message')).toHaveLength(1);
  await view.rerender(
    <ConversationSteeringMessages
      instructions={[{ ...row, status: 'applied' }]}
    />,
  );
  expect(view.queryByText('보냄')).toBeNull();
  expect(view.getByText('읽음')).toBeTruthy();
  await view.rerender(
    <ConversationSteeringMessages
      instructions={[{ ...row, status: 'not_applied' }]}
    />,
  );
  expect(view.queryByText('읽음')).toBeNull();
  expect(view.queryByText('보냄')).toBeNull();
  expect(view.getByText('전송 실패 · 다시 보내주세요')).toBeTruthy();
});
