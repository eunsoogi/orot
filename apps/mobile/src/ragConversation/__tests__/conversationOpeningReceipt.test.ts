import { createConversationTurnActivity } from '../conversationTurnActivity';
import type { ConversationSession } from '../conversationSessionTypes';

function setup() {
  let current = true;
  let session = {
    id: 1,
    messages: [
      {
        id: 10,
        role: 'user',
        content: 'Synthetic question',
        deliveryPending: true,
        delivery: { submittedAt: '2035-01-01T00:00:00Z' },
      },
      {
        id: 12,
        role: 'user',
        content: 'Another question',
        delivery: { submittedAt: '2035-01-01T00:00:00Z' },
      },
    ],
    pendingMessage: {
      id: 11,
      content: '',
      initialResponse: { text: 'Local receipt', source: 'receipt' },
    },
  } as unknown as ConversationSession;
  const activity = createConversationTurnActivity({
    id: 1,
    responseId: 11,
    userMessageId: 10,
    find: () => session,
    update: (_id, change) => {
      session = { ...session, ...change };
    },
    current: () => current,
  });
  const opening = (text = 'Synthetic generated opening') =>
    activity.observer.onTaskStreamEvent({
      type: 'initial_response',
      callId: 'synthetic-opening',
      text,
    });
  return {
    activity,
    opening,
    session: () => session,
    stop: () => {
      current = false;
    },
    changePending: (change: object) => {
      session = {
        ...session,
        pendingMessage: { ...session.pendingMessage!, ...change },
      };
    },
  };
}

test('a local receipt and dispatch do not mark read, but accepted generated opening marks only its question', () => {
  const f = setup();
  f.activity.observer.onTaskStreamEvent({ type: 'started' });
  expect(f.session().messages[0].delivery?.readAt).toBeUndefined();
  f.opening();
  expect(f.session().messages[0].delivery?.readAt).toEqual(expect.any(String));
  expect(f.session().messages[0].deliveryPending).toBe(false);
  expect(f.session().messages[1].delivery?.readAt).toBeUndefined();
  expect(f.session().pendingMessage?.initialResponse?.text).toBe(
    'Synthetic generated opening',
  );
});

test('opening replay and subsequent provider observations preserve the first read timestamp', () => {
  const f = setup();
  f.opening();
  const first = f.session().messages[0].delivery?.readAt;
  f.opening('Ignored replay');
  f.activity.observer.onProviderReceipt('response_started');
  expect(f.session().messages[0].delivery?.readAt).toBe(first);
  expect(f.session().pendingMessage?.initialResponse?.text).toBe(
    'Synthetic generated opening',
  );
});

test.each(['cancelled', 'newer_request', 'withheld', 'empty'])(
  'rejects %s opening without a false read',
  state => {
    const f = setup();
    if (state === 'cancelled') f.stop();
    if (state === 'newer_request') f.changePending({ id: 99 });
    if (state === 'withheld') f.changePending({ withholdHealthBody: true });
    f.opening(state === 'empty' ? '  ' : undefined);
    expect(f.session().messages[0].delivery?.readAt).toBeUndefined();
    expect(f.session().pendingMessage?.initialResponse?.source).toBe('receipt');
  },
);
