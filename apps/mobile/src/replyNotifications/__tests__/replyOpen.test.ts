import { createReplyOpen } from '../replyOpen';
import { replyFocus } from '../replyFocus';
import type { ConversationSessions } from '../../ragConversation/conversationSessions';
import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';
import type { NavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';

const identity = {
  requestId: 'r',
  sessionId: 'saved',
  messageId: 'answer',
  sessionVersion: 2,
};

test('selects the matching existing session without attaching or sending another conversation', async () => {
  const select = jest.fn();
  const attachExisting = jest.fn();
  const sessions = {
    getSnapshot: () => ({
      sessions: [
        { id: 1, draft: 'unrelated draft', messages: [] },
        {
          id: 2,
          draft: 'saved draft',
          messages: [{ role: 'assistant', retainedTurnId: 'answer' }],
        },
      ],
    }),
    select,
    attachExisting,
  } as unknown as ConversationSessions;
  const retention = {
    activeLease: (id: number) =>
      id === 2 ? { id: 'saved', version: 2 } : null,
  } as ConversationSessionOptions['retention'];
  const push = jest.fn().mockReturnValue({ key: 'conversation' });
  const controller = {
    getSnapshot: () => ({
      currentRoute: { key: 'home', name: 'home' },
      isTransitioning: false,
    }),
    push,
  } as unknown as NavigationController<AppNavigationRoute>;
  const open = createReplyOpen({
    sessions,
    retention,
    controller,
    read: async () => ({ createdAt: '2026-11-13T00:00:00.000Z' }),
    canEnter: () => true,
    confirm: async () => 'approved',
  });
  expect(await open(identity)).toBe('opened');
  expect(select).toHaveBeenCalledWith(2);
  expect(attachExisting).not.toHaveBeenCalled();
  expect(push).toHaveBeenCalledWith('rag-conversation');
  expect(replyFocus.get()).toEqual({ sessionId: 2, messageId: 'answer' });
  replyFocus.clear(replyFocus.get()!);
});

test('defers while entry is closed and reports a deleted reply without selecting a session', async () => {
  const select = jest.fn();
  const sessions = { select } as unknown as ConversationSessions;
  const retention = {} as ConversationSessionOptions['retention'];
  const controller = {} as NavigationController<AppNavigationRoute>;
  const closed = createReplyOpen({
    sessions,
    retention,
    controller,
    read: jest.fn(),
    canEnter: () => false,
    confirm: jest.fn(),
  });
  expect(await closed(identity)).toBe('deferred');
  const missing = createReplyOpen({
    sessions,
    retention,
    controller,
    read: async () => null,
    canEnter: () => true,
    confirm: jest.fn(),
  });
  expect(await missing(identity)).toBe('missing');
  expect(select).not.toHaveBeenCalled();
});

test('restores a cold saved conversation without changing the existing draft', async () => {
  const draft = { id: 1, draft: '다른 입력', messages: [] };
  const restored = {
    id: 2,
    draft: '',
    messages: [{ role: 'assistant', retainedTurnId: 'answer' }],
  };
  const list: Array<typeof draft | typeof restored> = [draft];
  const select = jest.fn();
  const attachExisting = jest.fn(async () => {
    list.push(restored);
    return 2;
  });
  const sessions = {
    getSnapshot: () => ({ sessions: list }),
    select,
    attachExisting,
  } as unknown as ConversationSessions;
  const retention = {
    activeLease: () => null,
  } as unknown as ConversationSessionOptions['retention'];
  const controller = {
    getSnapshot: () => ({
      currentRoute: { key: 'home', name: 'home' },
      isTransitioning: false,
    }),
    push: jest.fn().mockReturnValue({ key: 'conversation' }),
  } as unknown as NavigationController<AppNavigationRoute>;
  const open = createReplyOpen({
    sessions,
    retention,
    controller,
    read: async () => ({ createdAt: '2026-11-13T00:00:00.000Z' }),
    canEnter: () => true,
    confirm: async () => 'approved',
  });
  expect(await open(identity)).toBe('opened');
  expect(attachExisting).toHaveBeenCalledWith(
    'saved',
    2,
    '2026-11-13T00:00:00.000Z',
    false,
  );
  expect(draft.draft).toBe('다른 입력');
  expect(select).toHaveBeenCalledWith(2);
  replyFocus.clear(replyFocus.get()!);
});
