import { render } from '@testing-library/react-native';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
const row = {
  id: 's1',
  text: 'First steering',
  sequence: 1,
  status: 'applied' as const,
};
const props = {
  messageProps: { onOpenSource: jest.fn(), onLinkError: jest.fn() },
  replyFocus: undefined,
  onLayout: jest.fn(),
};
test('retained and live receipts stay before their own answer without duplication', async () => {
  const live = {
    ...row,
    id: 's2',
    text: 'Second steering',
    status: 'delivery_pending' as const,
    serverAccepted: true,
  };
  const messages = [
    { id: 1, role: 'user' as const, content: 'First question' },
    {
      id: 2,
      role: 'assistant' as const,
      content: 'First answer',
      steeringInstructions: [row],
    },
    { id: 3, role: 'user' as const, content: 'Second question' },
    {
      id: 4,
      role: 'assistant' as const,
      content: 'Second answer',
      steeringInstructions: [live],
    },
  ];
  const screen = await render(
    <ConversationTranscriptMessages
      {...props}
      messages={messages}
      pendingId={4}
      instructions={[live]}
    />,
  );
  const text = JSON.stringify(screen.toJSON());
  expect(text.indexOf('First steering')).toBeLessThan(
    text.indexOf('First answer'),
  );
  expect(text.indexOf('First answer')).toBeLessThan(
    text.indexOf('Second question'),
  );
  expect(text.indexOf('Second steering')).toBeLessThan(
    text.indexOf('Second answer'),
  );
  expect(screen.getAllByText('Second steering')).toHaveLength(1);
  expect(screen.getAllByText('읽음')).toHaveLength(1);
  expect(screen.getAllByText('보냄')).toHaveLength(1);
  await screen.rerender(
    <ConversationTranscriptMessages
      {...props}
      messages={messages}
      instructions={[]}
    />,
  );
  expect(screen.getAllByText('Second steering')).toHaveLength(1);
});
