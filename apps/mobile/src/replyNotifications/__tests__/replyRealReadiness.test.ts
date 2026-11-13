import { NativeModules } from 'react-native';
import { createNavigationController } from '../../navigation/navigationController';
import { createConversationSessions } from '../../ragConversation/conversationSessions';
import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import { observeReplyDelivery } from '../observeReplyDelivery';

jest.mock('../../appointmentReminders/nativeReminderBridge', () => ({
  subscribeAppointmentReminderOpened: () => () => {},
}));

test.each(['unavailable guard', 'restore failure'] as const)(
  'does not retry its own %s publications or unrelated drafts',
  async failure => {
    const previous = NativeModules.ReplyNotificationModule;
    const consumeTarget = jest.fn(async () => ({
      requestId: failure,
      sessionId: 'saved',
      messageId: 'answer',
      sessionVersion: '2',
    }));
    NativeModules.ReplyNotificationModule = {
      consumeTarget,
      acknowledgeTarget: jest.fn(),
    };
    const leases = new Map<number, { id: string; version: number }>();
    const retention = {
      activeLease: (id: number) => leases.get(id),
      activeIdentity: (id: number) => leases.get(id)?.id ?? null,
      attachExisting: async (
        id: number,
        durableId: string,
        version: number,
      ) => {
        leases.set(id, { id: durableId, version });
      },
      invalidate: () => leases.clear(),
    } as unknown as NonNullable<ConversationSessionOptions['retention']>;
    const restoreSession = jest.fn(async () => {
      throw new Error('restore unavailable');
    });
    const sessions = createConversationSessions({ retention, restoreSession });
    const controller = createNavigationController<AppNavigationRoute>('home');
    if (failure === 'restore failure')
      controller.registerLeaveGuard(
        controller.getSnapshot().currentRoute.key,
        async () => true,
      );
    const confirm = jest.fn(() => controller.requestTabSwitchDecision());
    const storage = {
      listCompletionIdentities: async () => [
        {
          requestId: failure,
          sessionId: 'saved',
          messageId: 'answer',
          sessionVersion: 2,
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
      retention,
      confirm,
      loadLocalData: async () =>
        ({ openConversationArtifactStorage: async () => storage }) as never,
      canEnter: () => true,
      execute: async work => work(),
    });
    try {
      for (let i = 0; i < 200; i += 1) await Promise.resolve();
      expect(confirm).toHaveBeenCalledTimes(1);
      if (failure === 'restore failure')
        expect(restoreSession).toHaveBeenCalledTimes(2);
      sessions.setDraft(sessions.getSnapshot().activeId, 'unrelated');
      for (let i = 0; i < 200; i += 1) await Promise.resolve();
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(consumeTarget).toHaveBeenCalledTimes(1);
    } finally {
      stop();
      sessions.dispose();
      NativeModules.ReplyNotificationModule = previous;
    }
  },
);

test('rechecks a real controller after a route change during the final read and coalesces publications', async () => {
  const previous = NativeModules.ReplyNotificationModule;
  let target: unknown = {
    requestId: 'real-route',
    sessionId: 'saved',
    messageId: 'answer',
    sessionVersion: '2',
  };
  const acknowledgeTarget = jest.fn(async () => {
    target = null;
  });
  NativeModules.ReplyNotificationModule = {
    consumeTarget: async () => target,
    acknowledgeTarget,
  };
  const leases = new Map<number, { id: string; version: number }>();
  const retention = {
    activeLease: (id: number) => leases.get(id),
    activeIdentity: (id: number) => leases.get(id)?.id ?? null,
    attachExisting: async (id: number, durableId: string, version: number) => {
      leases.set(id, { id: durableId, version });
    },
    invalidate: () => leases.clear(),
  } as unknown as NonNullable<ConversationSessionOptions['retention']>;
  const sessions = createConversationSessions({
    retention,
    restoreSession: async () => [
      { question: 'q', answer: 'a', citations: [], toolMessageId: 'answer' },
    ],
  });
  const controller = createNavigationController<AppNavigationRoute>('home');
  const approve = async () => true;
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    approve,
  );
  const confirm = jest.fn(() => controller.requestTabSwitchDecision());
  let signalRead = () => {};
  const reading = new Promise<void>(resolve => {
    signalRead = resolve;
  });
  let release = () => {};
  const hold = new Promise<void>(resolve => {
    release = resolve;
  });
  let reads = 0;
  const storage = {
    listCompletionIdentities: async () => [
      {
        requestId: 'real-route',
        sessionId: 'saved',
        messageId: 'answer',
        sessionVersion: 2,
        status: 'completed',
      },
    ],
    readSessionMany: async () => {
      if (++reads === 2) {
        signalRead();
        await hold;
      }
      return [{ status: 'complete', createdAt: '2026-11-13T00:00:00.000Z' }];
    },
  };
  const stop = observeReplyDelivery({
    controller,
    sessions,
    retention,
    confirm,
    loadLocalData: async () =>
      ({ openConversationArtifactStorage: async () => storage }) as never,
    canEnter: () => true,
    execute: async work => work(),
  });
  try {
    await reading;
    controller.push('rag-conversation');
    controller.registerLeaveGuard(
      controller.getSnapshot().currentRoute.key,
      approve,
    );
    sessions.setDraft(sessions.getSnapshot().activeId, 'unrelated');
    sessions.setDraft(sessions.getSnapshot().activeId, 'another');
    release();
    for (let i = 0; i < 300; i += 1) await Promise.resolve();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(acknowledgeTarget).toHaveBeenCalledTimes(1);
    expect(acknowledgeTarget).toHaveBeenCalledWith('real-route');
  } finally {
    release();
    stop();
    sessions.dispose();
    NativeModules.ReplyNotificationModule = previous;
  }
});
