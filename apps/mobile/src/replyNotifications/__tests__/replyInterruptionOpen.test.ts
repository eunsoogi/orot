import { createReplyOpen } from '../replyOpen';
import type { ConversationSessions } from '../../ragConversation/conversationSessions';
import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';
import type { NavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';

test('an interruption tap opens its incomplete turn without replay or pretending it is a saved answer', async () => {
  const select = jest.fn();
  const send = jest.fn();
  const sessions = {
    getSnapshot: () => ({
      sessions: [
        {
          id: 4,
          draft: 'preserved draft',
          messages: [
            {
              role: 'assistant',
              toolMessageId: 'turn',
              incomplete: true,
              interruptionReason: 'expired',
            },
          ],
        },
      ],
    }),
    select,
    send,
  } as unknown as ConversationSessions;
  const retention = {
    activeLease: () => ({ id: 'session', version: 0 }),
  } as unknown as ConversationSessionOptions['retention'];
  const controller = {
    getSnapshot: () => ({
      currentRoute: { key: 'conversation', name: 'rag-conversation' },
      isTransitioning: false,
    }),
  } as unknown as NavigationController<AppNavigationRoute>;
  const open = createReplyOpen({
    sessions,
    retention,
    controller,
    read: async () => ({ createdAt: '2026-11-14T00:00:00.000Z' }),
    canEnter: () => true,
    confirm: async () => 'approved',
  });
  const result = await open({
    requestId: 'interruption:turn',
    sessionId: 'session',
    messageId: 'turn',
    sessionVersion: 0,
    purpose: 'interruption',
  });
  expect(result).toBe('opened');
  expect(select).toHaveBeenCalledWith(4);
  expect(send).not.toHaveBeenCalled();
  expect(sessions.getSnapshot().sessions[0]?.draft).toBe('preserved draft');
});
