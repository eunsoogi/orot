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

test.each(['navigation', 'session'] as const)(
  '%s publications during an unavailable guard do not retry until an external wake',
  async source => {
    const prior = NativeModules.ReplyNotificationModule;
    NativeModules.ReplyNotificationModule = {
      consumeTarget: jest.fn().mockResolvedValue({
        requestId: 'r',
        sessionId: 's',
        messageId: 'm',
        sessionVersion: '0',
      }),
    };
    let navigationChanged = () => {};
    let sessionChanged = () => {};
    let wake = () => {};
    let notifyFirst = () => {};
    let notifySecond = () => {};
    const first = new Promise<void>(resolve => {
      notifyFirst = resolve;
    });
    const second = new Promise<void>(resolve => {
      notifySecond = resolve;
    });
    let calls = 0;
    const confirm = jest.fn(async () => {
      calls += 1;
      if (source === 'navigation') navigationChanged();
      else sessionChanged();
      if (calls === 1) notifyFirst();
      if (calls === 2) notifySecond();
      return 'unavailable' as const;
    });
    const controller = {
      subscribe: (listener: () => void) => {
        navigationChanged = listener;
        return () => {};
      },
      getSnapshot: () => ({
        isTransitioning: false,
        currentRoute: { key: 'home' },
      }),
    } as unknown as NavigationController<AppNavigationRoute>;
    const sessions = {
      subscribe: (listener: () => void) => {
        sessionChanged = listener;
        return () => {};
      },
    } as unknown as ConversationSessions;
    const storage = {
      listCompletionIdentities: async () => [
        {
          requestId: 'r',
          sessionId: 's',
          messageId: 'm',
          sessionVersion: 0,
          status: 'completed',
        },
      ],
      readSessionMany: async () => [
        { status: 'complete', createdAt: '2026-11-13T00:00:00.000Z' },
      ],
    };
    const stop = observeReplyDelivery({
      controller,
      sessions,
      retention: {} as ConversationSessionOptions['retention'],
      loadLocalData: async () =>
        ({ openConversationArtifactStorage: async () => storage }) as never,
      canEnter: () => true,
      confirm,
      execute: async work => work(),
      subscribeReady: listener => {
        wake = listener;
        return () => {};
      },
    });
    try {
      await first;
      for (let i = 0; i < 100; i += 1) await Promise.resolve();
      expect(confirm).toHaveBeenCalledTimes(1);
      wake();
      await second;
      for (let i = 0; i < 100; i += 1) await Promise.resolve();
      expect(confirm).toHaveBeenCalledTimes(2);
    } finally {
      stop();
      NativeModules.ReplyNotificationModule = prior;
    }
  },
);
