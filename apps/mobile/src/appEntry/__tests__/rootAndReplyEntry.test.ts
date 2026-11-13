import { waitFor } from '@testing-library/react-native';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import type { ConversationSessions } from '../../ragConversation/conversationSessions';
import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';
import { observeReplyDelivery } from '../../replyNotifications/observeReplyDelivery';
import { nativeReplyNotifications } from '../../replyNotifications/nativeReplyNotifications';
import { createReplyOpen } from '../../replyNotifications/replyOpen';
import { createEntryArbiter } from '../entryArbiter';
import { createRootURLDelivery } from '../rootURLDelivery';

jest.mock('../../appointmentReminders/nativeReminderBridge', () => ({
  subscribeAppointmentReminderOpened: () => () => {},
}));
jest.mock('../../replyNotifications/nativeReplyNotifications', () => ({
  nativeReplyNotifications: jest.fn(),
}));
jest.mock('../../replyNotifications/replyOpen', () => ({
  createReplyOpen: jest.fn(),
}));

test('a reply tap waits for the complete root URL operation and keeps its exact identity', async () => {
  let release!: (allow: boolean) => void;
  const guard = new Promise<boolean>(resolve => {
    release = resolve;
  });
  const controller = createNavigationController<AppNavigationRoute>('home');
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    () => guard,
  );
  const arbiter = createEntryArbiter();
  const selected = jest.fn();
  const root = createRootURLDelivery({
    arbiter,
    controller,
    peek: async () => ({ id: 'url', destination: 'records' }),
    acknowledge: async () => {},
    canEnter: () => true,
    selectTab: selected,
  });
  const rootAttempt = root();
  await waitFor(() =>
    expect(controller.getSnapshot().isTransitioning).toBe(true),
  );
  const target = {
    requestId: 'request',
    sessionId: 'session',
    messageId: 'message',
    sessionVersion: '3',
  };
  const consume = jest
    .fn()
    .mockResolvedValueOnce(target)
    .mockResolvedValue(null);
  const acknowledge = jest.fn().mockResolvedValue(undefined);
  jest.mocked(nativeReplyNotifications).mockReturnValue({
    consumeTarget: consume,
    acknowledgeTarget: acknowledge,
  } as never);
  const open = jest.fn().mockResolvedValue('opened');
  jest.mocked(createReplyOpen).mockReturnValue(open);
  const stop = observeReplyDelivery({
    controller,
    sessions: { subscribe: () => () => {} } as unknown as ConversationSessions,
    retention: {} as ConversationSessionOptions['retention'],
    confirm: async () => 'approved',
    canEnter: () => true,
    execute: work =>
      arbiter.run(async current => {
        if (current()) await work();
      }),
  });
  try {
    await Promise.resolve();
    await Promise.resolve();
    expect(consume).not.toHaveBeenCalled();
    release(true);
    expect(await rootAttempt).toBe('opened');
    await waitFor(() => expect(acknowledge).toHaveBeenCalledWith('request'));
    expect(selected).toHaveBeenCalledWith('records');
    expect(open).toHaveBeenCalledWith({ ...target, sessionVersion: 3 });
  } finally {
    stop();
  }
});
