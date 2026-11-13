import { NativeModules } from 'react-native';
import type { NavigationController } from '../../navigation/navigationController';
import type { ConversationSessions } from '../../ragConversation/conversationSessions';
import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import { observeReplyDelivery } from '../observeReplyDelivery';

jest.mock('../../appointmentReminders/nativeReminderBridge', () => ({
  subscribeAppointmentReminderOpened: () => () => {},
}));

test.each([
  'navigation',
  'late-navigation',
  'settled-route',
  'session',
  'final-session',
] as const)(
  'retries when external %s readiness arrives before the deferred executor returns',
  async blockedBy => {
    const previous = NativeModules.ReplyNotificationModule;
    let target: unknown = {
      requestId: `wake-${blockedBy}`,
      sessionId: 'retained',
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
    let navigationListener = () => {};
    let sessionListener = () => {};
    let transitioning = blockedBy === 'navigation';
    let routeKey = 'home';
    let busy = blockedBy === 'session';
    const controller = {
      subscribe: (listener: () => void) => {
        navigationListener = listener;
        return () => {};
      },
      getSnapshot: () => ({
        isTransitioning: transitioning,
        currentRoute: { key: routeKey, name: 'rag-conversation' },
      }),
    } as unknown as NavigationController<AppNavigationRoute>;
    const session = () => ({
      id: 1,
      busy,
      messages: [{ role: 'assistant', retainedTurnId: 'answer' }],
    });
    const sessions = {
      subscribe: (listener: () => void) => {
        sessionListener = listener;
        return () => {};
      },
      getSnapshot: () => ({ sessions: [session()] }),
      select: jest.fn(),
    } as unknown as ConversationSessions;
    const retention = {
      activeLease: () => ({ id: 'retained', version: 2 }),
    } as unknown as ConversationSessionOptions['retention'];
    let signalSecondRead = () => {};
    const secondRead = new Promise<void>(resolve => {
      signalSecondRead = resolve;
    });
    let releaseRead = () => {};
    const holdRead = new Promise<void>(resolve => {
      releaseRead = resolve;
    });
    let reads = 0;
    const storage = {
      listCompletionIdentities: async () => [
        {
          requestId: `wake-${blockedBy}`,
          sessionId: 'retained',
          messageId: 'answer',
          sessionVersion: 2,
          status: 'completed',
        },
      ],
      readSessionMany: async () => {
        reads += 1;
        if (
          (blockedBy === 'late-navigation' ||
            blockedBy === 'settled-route' ||
            blockedBy === 'final-session') &&
          reads === 2
        ) {
          signalSecondRead();
          await holdRead;
        }
        return [{ status: 'complete', createdAt: '2026-11-13T00:00:00.000Z' }];
      },
    };
    let deferred = () => {};
    const firstFinished = new Promise<void>(resolve => {
      deferred = resolve;
    });
    let release = () => {};
    const hold = new Promise<void>(resolve => {
      release = resolve;
    });
    let executionCount = 0;
    const confirm = jest.fn(async () =>
      transitioning ? ('busy' as const) : ('approved' as const),
    );
    const stop = observeReplyDelivery({
      controller,
      sessions,
      retention,
      loadLocalData: async () =>
        ({ openConversationArtifactStorage: async () => storage }) as never,
      canEnter: () => true,
      confirm,
      execute: async work => {
        executionCount += 1;
        await work();
        if (executionCount === 1) {
          deferred();
          await hold;
        }
      },
    });
    try {
      if (
        blockedBy === 'late-navigation' ||
        blockedBy === 'settled-route' ||
        blockedBy === 'final-session'
      ) {
        await secondRead;
        if (blockedBy === 'final-session') {
          busy = true;
          sessionListener();
        } else {
          transitioning = true;
          navigationListener();
        }
        if (blockedBy === 'settled-route') {
          routeKey = 'other';
          transitioning = false;
          navigationListener();
        }
        releaseRead();
      }
      await firstFinished;
      expect(acknowledgeTarget).not.toHaveBeenCalled();
      transitioning = false;
      busy = false;
      if (blockedBy === 'settled-route') {
        // The only readiness publication already occurred during the protected read.
      } else if (blockedBy !== 'session' && blockedBy !== 'final-session')
        navigationListener();
      else sessionListener();
      release();
      for (let i = 0; i < 100; i += 1) await Promise.resolve();
      expect(acknowledgeTarget).toHaveBeenCalledWith(`wake-${blockedBy}`);
      expect(acknowledgeTarget).toHaveBeenCalledTimes(1);
      if (blockedBy === 'settled-route') {
        expect(confirm).toHaveBeenCalledTimes(2);
        expect(sessions.select).toHaveBeenCalledTimes(1);
      }
    } finally {
      releaseRead();
      release();
      stop();
      NativeModules.ReplyNotificationModule = previous;
    }
  },
);
