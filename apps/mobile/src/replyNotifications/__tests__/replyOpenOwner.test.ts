import { createReplyOpen } from '../replyOpen';
import type { ConversationSessions } from '../../ragConversation/conversationSessions';
import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';
import type { NavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';

test('does not apply a decline from an observer replaced during confirmation', async () => {
  let current = true;
  const open = createReplyOpen({
    sessions: {} as ConversationSessions,
    retention: {} as ConversationSessionOptions['retention'],
    controller: {
      getSnapshot: () => ({ currentRoute: { key: 'home' } }),
    } as unknown as NavigationController<AppNavigationRoute>,
    read: async () => ({ createdAt: '2026-11-13T00:00:00.000Z' }),
    canEnter: () => true,
    isCurrent: () => current,
    confirm: async () => {
      current = false;
      return 'declined';
    },
  });
  expect(
    await open({
      requestId: 'r',
      sessionId: 's',
      messageId: 'm',
      sessionVersion: 0,
    }),
  ).toBe('deferred');
});
