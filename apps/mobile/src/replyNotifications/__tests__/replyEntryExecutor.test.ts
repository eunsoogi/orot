import { NativeModules } from 'react-native';
import { observeReplyDelivery } from '../observeReplyDelivery';
import type { ConversationSessions } from '../../ragConversation/conversationSessions';
import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';
import type { NavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';

jest.mock('../../appointmentReminders/nativeReminderBridge', () => ({
  subscribeAppointmentReminderOpened: () => () => {},
}));

test('peeks the existing inbox only inside the shared entry executor', async () => {
  const prior = NativeModules.ReplyNotificationModule;
  const consumeTarget = jest.fn().mockResolvedValue(null);
  NativeModules.ReplyNotificationModule = { consumeTarget };
  const controller = {
    subscribe: () => () => {},
    getSnapshot: () => ({ isTransitioning: false }),
  } as unknown as NavigationController<AppNavigationRoute>;
  const sessions = {
    subscribe: () => () => {},
  } as unknown as ConversationSessions;
  const retention = {} as ConversationSessionOptions['retention'];
  const callbacks: Array<() => Promise<void>> = [];
  const stop = observeReplyDelivery({
    controller,
    sessions,
    retention,
    canEnter: () => true,
    confirm: async () => 'approved',
    execute: async work => {
      callbacks.push(work);
    },
  });
  try {
    await Promise.resolve();
    await Promise.resolve();
    expect(consumeTarget).not.toHaveBeenCalled();
    expect(callbacks).toHaveLength(1);
    await callbacks[0]!();
    expect(consumeTarget).toHaveBeenCalledTimes(1);
  } finally {
    stop();
    NativeModules.ReplyNotificationModule = prior;
  }
});
