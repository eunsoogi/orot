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

test('a queued callback cannot consume or navigate after the observer is stopped', async () => {
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
  const callbacks: Array<() => Promise<void>> = [];
  const stop = observeReplyDelivery({
    controller,
    sessions,
    retention: {} as ConversationSessionOptions['retention'],
    canEnter: () => true,
    confirm: async () => 'approved',
    execute: async work => {
      callbacks.push(work);
    },
  });
  try {
    await Promise.resolve();
    await Promise.resolve();
    stop();
    await callbacks[0]!();
    expect(consumeTarget).not.toHaveBeenCalled();
  } finally {
    stop();
    NativeModules.ReplyNotificationModule = prior;
  }
});

test('a readiness wake drains a previously deferred inbox through the same executor', async () => {
  const prior = NativeModules.ReplyNotificationModule;
  let observed = () => {};
  const consumed = new Promise<void>(resolve => {
    observed = resolve;
  });
  const consumeTarget = jest.fn(async () => {
    observed();
    return null;
  });
  NativeModules.ReplyNotificationModule = { consumeTarget };
  const controller = {
    subscribe: () => () => {},
    getSnapshot: () => ({ isTransitioning: false }),
  } as unknown as NavigationController<AppNavigationRoute>;
  const sessions = {
    subscribe: () => () => {},
  } as unknown as ConversationSessions;
  let ready = false;
  let wake = () => {};
  const stop = observeReplyDelivery({
    controller,
    sessions,
    retention: {} as ConversationSessionOptions['retention'],
    canEnter: () => ready,
    confirm: async () => 'approved',
    execute: async work => {
      if (ready) await work();
    },
    subscribeReady: listener => {
      wake = listener;
      return () => {};
    },
  });
  try {
    await Promise.resolve();
    await Promise.resolve();
    expect(consumeTarget).not.toHaveBeenCalled();
    ready = true;
    wake();
    await consumed;
    expect(consumeTarget).toHaveBeenCalledTimes(1);
  } finally {
    stop();
    NativeModules.ReplyNotificationModule = prior;
  }
});
