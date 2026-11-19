import { createReplyOpen } from '../replyOpen';
import { createDailyReportIdentity } from '@orot/domain';
import type { ConversationSessions } from '../../ragConversation/conversationSessions';
import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';
import type { NavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import { replyFocus } from '../replyFocus';

const identity = {
  requestId: 'r',
  sessionId: 'saved',
  sessionVersion: 2,
  messageId: 'answer',
};
const target = {
  identity: createDailyReportIdentity('2026-10-01', 'Asia/Seoul'),
  runId: 'saved-report',
  revision: 3,
};
function fixture(dailyReport: unknown = target) {
  const message = {
    role: 'assistant',
    retainedTurnId: 'answer',
    content: 'daily report',
    dailyReport,
  };
  const select = jest.fn();
  const sessions = {
    getSnapshot: () => ({ sessions: [{ id: 2, messages: [message] }] }),
    select,
  } as unknown as ConversationSessions;
  const retention = {
    activeLease: () => ({ id: 'saved', version: 2 }),
  } as unknown as ConversationSessionOptions['retention'];
  const push = jest.fn(() => ({ key: 'extra' }));
  const controller = {
    getSnapshot: () => ({
      currentRoute: { key: 'existing', name: 'root' },
      isTransitioning: false,
    }),
    push,
  } as unknown as NavigationController<AppNavigationRoute>;
  const openConversationRoot = jest.fn(() => true);
  const read = jest.fn(async () => ({ createdAt: '2026-10-01T00:00:00.000Z' }));
  return {
    sessions,
    retention,
    controller,
    push,
    select,
    openConversationRoot,
    read,
    canEnter: () => true,
    confirm: async () => 'approved' as const,
  };
}
afterEach(() => {
  const focus = replyFocus.get();
  if (focus) replyFocus.clear(focus);
});
test('exact validated daily completion reuses the root and selects the retained message without dispatch', async () => {
  const input = fixture();
  expect(await createReplyOpen(input)(identity)).toBe('opened');
  expect(input.read).toHaveBeenCalledTimes(2);
  expect(input.openConversationRoot).toHaveBeenCalledWith('existing');
  expect(input.push).not.toHaveBeenCalled();
  expect(input.select).toHaveBeenCalledWith(2);
  expect(replyFocus.get()).toMatchObject({ sessionId: 2, messageId: 'answer' });
});
test.each([
  null,
  { ...target, revision: 0 },
  { ...target, payload: 'untrusted' },
])(
  'text or invalid metadata does not classify an ordinary reply as daily',
  async metadata => {
    const input = fixture(metadata);
    expect(await createReplyOpen(input)(identity)).toBe('opened');
    expect(input.openConversationRoot).not.toHaveBeenCalled();
    expect(input.push).toHaveBeenCalledWith('rag-conversation');
  },
);
test('closed canonical entry leaves selection and focus untouched', async () => {
  const input = fixture();
  input.openConversationRoot.mockReturnValue(false);
  expect(await createReplyOpen(input)(identity)).toBe('deferred');
  expect(input.select).not.toHaveBeenCalled();
  expect(input.push).not.toHaveBeenCalled();
  expect(replyFocus.get()).toBeNull();
});
test('a superseded second protected read cannot change tabs or select the restored session', async () => {
  const input = fixture();
  let current = true;
  input.read
    .mockImplementationOnce(async () => ({
      createdAt: '2026-10-01T00:00:00.000Z',
    }))
    .mockImplementationOnce(async () => {
      current = false;
      return { createdAt: '2026-10-01T00:00:00.000Z' };
    });
  expect(
    await createReplyOpen({ ...input, isCurrent: () => current })(identity),
  ).toBe('deferred');
  expect(input.openConversationRoot).not.toHaveBeenCalled();
  expect(input.select).not.toHaveBeenCalled();
});
