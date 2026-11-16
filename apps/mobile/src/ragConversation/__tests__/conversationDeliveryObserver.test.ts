import { createConversationSessions } from '../conversationSessions';
import { createConversationDeliveryObserver } from '../conversationDeliveryObserver';
import {
  parseConversationMessageDelivery,
  observeConversationDelivery,
} from '../conversationMessageDelivery';

/** The isolated observer proves identity and monotonic state, not provider comprehension. */
test('retains only actual first receipts for the owning prompt and ignores callbacks after ownership ends', () => {
  const sessions = createConversationSessions();
  const original = sessions.getSnapshot().sessions[0]!;
  let session = {
    ...original,
    messages: [
      {
        id: 1,
        role: 'user' as const,
        content: 'Synthetic question',
        delivery: { submittedAt: '2026-10-01T10:00:00Z' },
        deliveryPending: true,
      },
    ],
  };
  let current = true;
  const retain = jest.fn();
  const observer = createConversationDeliveryObserver({
    sessionId: session.id,
    messageId: 1,
    current: () => current,
    find: () => session,
    update: (_id, value) => {
      session = { ...session, ...value } as typeof session;
    },
    retain,
  });
  expect(session.messages[0]?.delivery).not.toHaveProperty('readAt');
  observer.onProviderReceipt('accepted');
  const accepted = { ...session.messages[0]!.delivery };
  observer.onProviderReceipt('response_started');
  const read = { ...session.messages[0]!.delivery };
  expect(read).toHaveProperty('readAt');
  expect(read).toMatchObject(accepted);
  observer.onProviderReceipt('accepted');
  observer.onProviderReceipt('response_started');
  expect(session.messages[0]!.delivery).toEqual(read);
  current = false;
  const count = retain.mock.calls.length;
  observer.onProviderReceipt('response_started');
  expect(retain).toHaveBeenCalledTimes(count);
  expect(session.messages[0]!.deliveryPending).toBe(false);
});

test('settling an unanswered or local-only request stops sending without fabricating delivery', () => {
  const sessions = createConversationSessions();
  const original = sessions.getSnapshot().sessions[0]!;
  let session = {
    ...original,
    messages: [
      {
        id: 1,
        role: 'user' as const,
        content: 'Synthetic',
        delivery: { submittedAt: '2026-10-01T10:00:00Z' },
        deliveryPending: true,
      },
    ],
  };
  createConversationDeliveryObserver({
    sessionId: session.id,
    messageId: 1,
    current: () => false,
    find: () => session,
    update: (_id, value) => {
      session = { ...session, ...value } as typeof session;
    },
  }).settle();
  expect(session.messages[0]?.delivery).toEqual({
    submittedAt: '2026-10-01T10:00:00Z',
  });
  expect(session.messages[0]?.deliveryPending).toBe(false);
});

test('optional corrupt or unsupported historical receipts remain unavailable instead of inventing times', () => {
  for (const value of [
    {},
    { submittedAt: 'bad' },
    { submittedAt: '2026-10-01T10:00:00' },
    { submittedAt: '2026-10-01T10:00:00Z', readAt: '2026-10-01T10:01:00Z' },
    { submittedAt: '2026-10-01T10:00:00Z', privateText: 'Synthetic' },
  ])
    expect(parseConversationMessageDelivery(value)).toBeUndefined();
});

test('backward device-clock movement never fabricates adjusted times or regresses a read phase', () => {
  const submittedAt = '2026-11-16T10:00:00.000Z';
  const readAt = '2026-11-16T09:00:00.000Z';
  const read = observeConversationDelivery(
    { submittedAt },
    'response_started',
    readAt,
  );
  expect(parseConversationMessageDelivery(read)).toEqual({
    submittedAt,
    acceptedAt: readAt,
    readAt,
  });
  expect(
    observeConversationDelivery(read, 'accepted', '2026-11-16T08:00:00.000Z'),
  ).toEqual(read);
});
