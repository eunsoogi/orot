import { decodeConversationSubmittedInput } from '../../ragConversation/conversationSubmittedInput';

// Content capacity is independent of source binding and schema validation.
test('restores a large submitted question without accepting malformed identity or unknown fields', () => {
  const submitted = {
    schemaVersion: 1,
    inputRevision: 0,
    sessionId: 'session',
    requestId: 'request',
    question: 'q'.repeat(150_000),
  };
  expect(decodeConversationSubmittedInput(submitted)).toEqual(submitted);
  expect(
    decodeConversationSubmittedInput({ ...submitted, sessionId: '' }),
  ).toBeNull();
  expect(
    decodeConversationSubmittedInput({ ...submitted, unsupported: true }),
  ).toBeNull();
});
