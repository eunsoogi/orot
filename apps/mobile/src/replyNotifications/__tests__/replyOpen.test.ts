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
  let passiveRestoreAllowed = true;
  const onReplyOpened = jest.fn(() => {
    passiveRestoreAllowed = false;
  });
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
    onReplyOpened,
  });
  expect(await open(identity)).toBe('opened');
  expect(select).toHaveBeenCalledWith(2);
  expect(attachExisting).not.toHaveBeenCalled();
  expect(push).toHaveBeenCalledWith('rag-conversation');
  expect(replyFocus.get()).toEqual({
    sessionId: 2,
    messageId: 'answer',
    generation: expect.any(Number),
  });
  expect(onReplyOpened).toHaveBeenCalledTimes(1);
  expect(passiveRestoreAllowed).toBe(false);
  replyFocus.clear(replyFocus.get()!);
});

test('defers while entry is closed and reports a deleted reply without selecting a session', async () => {
  const select = jest.fn();
  const onReplyOpened = jest.fn();
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
    onReplyOpened,
  });
  expect(await closed(identity)).toBe('deferred');
  const missing = createReplyOpen({
    sessions,
    retention,
    controller,
    read: async () => null,
    canEnter: () => true,
    confirm: jest.fn(),
    onReplyOpened,
  });
  expect(await missing(identity)).toBe('missing');
  expect(select).not.toHaveBeenCalled();
  expect(onReplyOpened).not.toHaveBeenCalled();
});

test('distinguishes explicit cancellation and fences stale work after a read', async () => {
  const select = jest.fn();
  const onReplyOpened = jest.fn();
  const sessions = { select } as unknown as ConversationSessions;
  const retention = {} as ConversationSessionOptions['retention'];
  const controller = {
    getSnapshot: () => ({
      currentRoute: { key: 'home', name: 'home' },
      isTransitioning: false,
    }),
  } as unknown as NavigationController<AppNavigationRoute>;
  const cancelled = createReplyOpen({
    sessions,
    retention,
    controller,
    read: async () => ({ createdAt: '2026-11-13T00:00:00.000Z' }),
    canEnter: () => true,
    confirm: async () => 'declined',
    onReplyOpened,
  });
  expect(await cancelled(identity)).toBe('cancelled');
  let current = true;
  const stale = createReplyOpen({
    sessions,
    retention,
    controller,
    read: async () => {
      current = false;
      return { createdAt: '2026-11-13T00:00:00.000Z' };
    },
    canEnter: () => true,
    isCurrent: () => current,
    confirm: jest.fn(),
    onReplyOpened,
  });
  expect(await stale(identity)).toBe('deferred');
  expect(select).not.toHaveBeenCalled();
  expect(onReplyOpened).not.toHaveBeenCalled();
});

test('preserves an explicit decline when the entry gate closes during confirmation', async () => {
  let allowed = true;
  const onReplyOpened = jest.fn();
  const open = createReplyOpen({
    sessions: {} as ConversationSessions,
    retention: {} as ConversationSessionOptions['retention'],
    controller: {
      getSnapshot: () => ({ currentRoute: { key: 'home' } }),
    } as unknown as NavigationController<AppNavigationRoute>,
    read: async () => ({ createdAt: '2026-11-13T00:00:00.000Z' }),
    canEnter: () => allowed,
    confirm: async () => {
      allowed = false;
      return 'declined';
    },
    onReplyOpened,
  });
  expect(await open(identity)).toBe('cancelled');
  expect(onReplyOpened).not.toHaveBeenCalled();
});

test('does not select or focus after synchronous navigation replaces the observer', async () => {
  let current = true;
  const select = jest.fn();
  const sessions = {
    getSnapshot: () => ({
      sessions: [
        { id: 2, messages: [{ role: 'assistant', retainedTurnId: 'answer' }] },
      ],
    }),
    select,
  } as unknown as ConversationSessions;
  const retention = {
    activeLease: () => ({ id: 'saved', version: 2 }),
  } as unknown as ConversationSessionOptions['retention'];
  const controller = {
    getSnapshot: () => ({
      currentRoute: { key: 'home', name: 'home' },
      isTransitioning: false,
    }),
    push: () => {
      current = false;
      return { key: 'conversation' };
    },
  } as unknown as NavigationController<AppNavigationRoute>;
  const open = createReplyOpen({
    sessions,
    retention,
    controller,
    read: async () => ({ createdAt: '2026-11-13T00:00:00.000Z' }),
    canEnter: () => true,
    isCurrent: () => current,
    confirm: async () => 'approved',
  });
  expect(await open(identity)).toBe('deferred');
  expect(select).not.toHaveBeenCalled();
  expect(replyFocus.get()).toBeNull();
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
    expect.any(Function),
    undefined,
  );
  expect(draft.draft).toBe('다른 입력');
  expect(select).toHaveBeenCalledWith(2);
  replyFocus.clear(replyFocus.get()!);
});
