import {
  replaceColdConversationAnswer,
  coldPausedMessages,
} from '../replaceColdConversationAnswer';
import type { ConversationSession } from '../conversationSessionTypes';
const owner = {
  sessionId: 'session',
  sessionVersion: 0,
  requestId: 'request',
  operationRunId: 'run',
};
const user = {
  id: -1,
  role: 'user' as const,
  content: 'original question',
  failed: true,
};
const bubble = {
  id: -2,
  role: 'assistant' as const,
  content: 'old preview',
  incomplete: true,
  interruptionReason: 'expired' as const,
  toolMessageId: 'request',
  toolEvents: [],
};
const session = {
  id: 1,
  draft: 'next unsent draft',
  messages: [user, bubble],
  pendingMessage: null,
} as unknown as ConversationSession;
function replace(value = session, committed = true) {
  return replaceColdConversationAnswer({
    session: value,
    requestId: 'request',
    responseId: -2,
    userMessageId: -1,
    owner,
    committed,
    outcome: { status: 'answer', answer: 'validated answer', citations: [] },
  });
}
test('replaces the original bubble without duplicating the question or touching the composer', () => {
  const changed = replace()!;
  expect(changed.messages).toHaveLength(2);
  expect(changed.messages[0]).toEqual({ ...user, failed: undefined });
  expect(changed.messages[1]).toEqual(
    expect.objectContaining({
      id: -2,
      content: 'validated answer',
      incomplete: undefined,
      retainedTurnId: 'request',
      sourceOwner: owner,
      toolEvents: bubble.toolEvents,
    }),
  );
  expect('draft' in changed).toBe(false);
  expect(session.messages[1]).toBe(bubble);
  expect(replace({ ...session, ...changed })).toBeUndefined();
});
test('an uncommitted answer never becomes retained history', () => {
  expect(replace(session, false)?.messages[1]?.retainedTurnId).toBeUndefined();
});
test.each(['removed', 'duplicate', 'quarantined', 'other-request'])(
  'rejects stale bubble ownership: %s',
  mode => {
    const changed = {
      ...session,
      ...(mode === 'removed' ? { messages: [user] } : {}),
      ...(mode === 'duplicate'
        ? { messages: [user, bubble, { ...bubble, id: -3 }] }
        : {}),
      ...(mode === 'quarantined' ? { quarantined: true } : {}),
      ...(mode === 'other-request'
        ? { messages: [user, { ...bubble, toolMessageId: 'different' }] }
        : {}),
    };
    expect(replace(changed)).toBeUndefined();
  },
);

test.each([false, true])(
  're-pause keeps the current draft and never reveals withheld body (%s)',
  withheld => {
    const pending = {
      ...session,
      pendingMessage: {
        id: -2,
        content: 'newer draft',
        activity: '',
        withholdHealthBody: withheld,
      },
    };
    const messages = coldPausedMessages(
      pending,
      -2,
      { attempt: 2, reason: 'expired' },
      owner,
    );
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      id: -2,
      content: withheld ? '' : 'newer draft',
      incomplete: true,
      coldResume: { attempt: 2 },
    });
    expect(messages[1]?.retainedTurnId).toBeUndefined();
    if (withheld) expect(messages[1]?.citations).toEqual([]);
    const other = coldPausedMessages(
      { ...pending, pendingMessage: { ...pending.pendingMessage, id: 99 } },
      -2,
      { attempt: 2, reason: 'expired' },
      owner,
    );
    expect(other[1]?.content).toBe('old preview');
  },
);
