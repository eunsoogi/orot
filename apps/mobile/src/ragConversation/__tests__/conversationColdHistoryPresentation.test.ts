import { conversationHistoryActivity } from '../conversationHistoryActivity';
import type { DisplayMessage } from '../ConversationMessage';

/** Synthetic repeated IDs model cold Continue without mutating the retained transcript. */
test('replaces only the pending request visually and preserves its source owner', () => {
  const sourceOwner = {
    sessionId: 'session',
    sessionVersion: 2,
    requestId: 'request',
    operationRunId: 'original-run',
  };
  const original: DisplayMessage = {
    id: 3,
    role: 'assistant',
    content: 'Old draft',
    incomplete: true,
    coldResume: { attempt: 1 },
    sourceOwner,
  };
  const messages: readonly DisplayMessage[] = [
    { id: 2, role: 'user', content: 'Question' },
    original,
  ];
  const pending = { id: 3, content: 'Continued', activity: '', sourceOwner };
  const result = conversationHistoryActivity(messages, pending, 1, null);
  expect(result.visibleMessages).toHaveLength(2);
  expect(result.visibleMessages[1]).toMatchObject({
    id: 3,
    content: 'Continued',
    sourceOwner,
    streaming: true,
  });
  expect(messages[1]).toBe(original);
  expect(original.content).toBe('Old draft');
  expect(
    conversationHistoryActivity(messages, null, 1, null).visibleMessages,
  ).toBe(messages);
});

test('an independent pending response does not hide another interrupted request', () => {
  const messages: readonly DisplayMessage[] = [
    { id: 1, role: 'assistant', content: 'Interrupted', incomplete: true },
  ];
  const pending = { id: 2, content: 'New', activity: '' };
  expect(
    conversationHistoryActivity(messages, pending, 1, null).visibleMessages,
  ).toHaveLength(2);
});
