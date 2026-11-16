import { render } from '@testing-library/react-native';
import { ConversationSteeringMessages } from '../ConversationSteeringMessages';

// The device's current zone owns display; fixture assertions remain valid on non-UTC developer Macs.
const localTime = (minute: string) =>
  new Date(`2026-11-16T10:${minute}:00.000Z`).toLocaleTimeString('ko-KR', {
    hour: 'numeric',
    minute: '2-digit',
  });

test('shows submission time without a false receipt, and uses observed receipt times when available', async () => {
  const base = {
    id: 's',
    text: 'Synthetic instruction',
    sequence: 1,
    status: 'queued' as const,
    submittedAt: '2026-11-16T10:00:00.000Z',
  };
  const screen = await render(
    <ConversationSteeringMessages instructions={[base]} />,
  );
  expect(screen.queryByText(/보냄|읽음/)).toBeNull();
  expect(screen.getByText(localTime('00'))).toBeTruthy();
  await screen.rerender(
    <ConversationSteeringMessages
      instructions={[
        {
          ...base,
          status: 'delivery_pending',
          serverAccepted: true,
          sentAt: '2026-11-16T10:01:00.000Z',
        },
      ]}
    />,
  );
  expect(
    screen.getByText(`${localTime('00')} · 보냄 ${localTime('01')}`),
  ).toBeTruthy();
  await screen.rerender(
    <ConversationSteeringMessages
      instructions={[
        { ...base, status: 'applied', readAt: '2026-11-16T10:03:00.000Z' },
      ]}
    />,
  );
  expect(
    screen.getByText(`${localTime('00')} · 읽음 ${localTime('03')}`),
  ).toBeTruthy();
  expect(screen.getByText(/읽음/).props.accessibilityHint).toContain(
    '이해했다는 보장은 아니에요',
  );
});

test('does not invent clock times for legacy or invalid metadata', async () => {
  const screen = await render(
    <ConversationSteeringMessages
      instructions={[
        {
          id: 's',
          text: 'Synthetic old',
          sequence: 1,
          status: 'applied',
          readAt: 'invalid',
        },
      ]}
    />,
  );
  expect(screen.getByText('읽음')).toBeTruthy();
});
