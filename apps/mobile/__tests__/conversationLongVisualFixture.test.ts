import { longVisualSessionOptions } from '../e2e/conversationLongVisualFixture';
import { createConversationSessions } from '../src/ragConversation/conversationSessions';

test('restores a long synthetic transcript without sending a request', async () => {
  const store = createConversationSessions(longVisualSessionOptions());
  await store.synchronizeModel();
  const snapshot = store.getSnapshot();
  const session = snapshot.sessions.find(
    item => item.id === snapshot.activeId,
  )!;
  expect(session.messages).toHaveLength(48);
  expect(session.messages[0]?.content).toContain('합성 질문 1');
  expect(session.messages[47]?.content).toContain('합성 답변 24');
  expect(session.busy).toBe(false);
  store.dispose();
});
