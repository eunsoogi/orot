import { NativeModules } from 'react-native';
import { createNavigationController } from '../../navigation/navigationController';
import { createConversationSessions } from '../../ragConversation/conversationSessions';
import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import { observeReplyDelivery } from '../observeReplyDelivery';

jest.mock('../../appointmentReminders/nativeReminderBridge', () => ({
  subscribeAppointmentReminderOpened: () => () => {},
}));

test('a real target restoration settling before executor release retries once', async () => {
  const previous = NativeModules.ReplyNotificationModule;
  let target: unknown = {
    requestId: 'session-ready',
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
  let restoreStarted = () => {};
  const started = new Promise<void>(resolve => {
    restoreStarted = resolve;
  });
  let finishRestore = () => {};
  const holdRestore = new Promise<void>(resolve => {
    finishRestore = resolve;
  });
  const sessions = createConversationSessions({
    retention,
    restoreSession: async () => {
      restoreStarted();
      await holdRestore;
      return [
        { question: 'q', answer: 'a', citations: [], toolMessageId: 'answer' },
      ];
    },
  });
  const attaching = sessions.attachExisting(
    'saved',
    2,
    '2026-11-13T00:00:00.000Z',
    false,
  );
  await started;
  const controller =
    createNavigationController<AppNavigationRoute>('rag-conversation');
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    async () => true,
  );
  const confirm = jest.fn(() => controller.requestTabSwitchDecision());
  let deferred = () => {};
  const firstFinished = new Promise<void>(resolve => {
    deferred = resolve;
  });
  let release = () => {};
  const hold = new Promise<void>(resolve => {
    release = resolve;
  });
  let executions = 0;
  const storage = {
    listCompletionIdentities: async () => [
      {
        requestId: 'session-ready',
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
    execute: async work => {
      executions += 1;
      await work();
      if (executions === 1) {
        deferred();
        await hold;
      }
    },
  });
  try {
    await firstFinished;
    expect(acknowledgeTarget).not.toHaveBeenCalled();
    finishRestore();
    await attaching;
    release();
    for (let i = 0; i < 250; i += 1) await Promise.resolve();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(acknowledgeTarget).toHaveBeenCalledTimes(1);
    expect(acknowledgeTarget).toHaveBeenCalledWith('session-ready');
  } finally {
    finishRestore();
    release();
    stop();
    sessions.dispose();
    NativeModules.ReplyNotificationModule = previous;
  }
});
