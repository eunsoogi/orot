import { useEffect } from 'react';
import { AppState } from 'react-native';
import type { NavigationController } from '../navigation/navigationController';
import type { AppNavigationRoute } from '../routes/appNavigationRoute';
import { useAppointmentReminderRuntime } from './AppointmentReminderContext';
import { createAppointmentReminderDelivery } from './reminderCoordinator';
import { buildAppointmentReminder } from './reminderPlan';
import {
  createDailyReminderDelivery,
  registerDailyReminderConsumer,
} from './dailyReminderDelivery';
import { createDailyReminderDestination } from './dailyReminderDestination';
import { createReminderNavigationDecisions } from './reminderNavigationDecisions';
import { dailyReminderIntentStore } from './dailyReminderIntentStore';
import { pruneClosedReminderRoutes } from './dailyReminderRouteCleanup';
import { createDailyReminderDrain } from './dailyReminderDrain';
import { restoreDailyReportConversation } from '../aiFeatures/integration/restoreDailyReportConversation';
import { dailyReportConversationIntentStore } from '../aiFeatures/integration/dailyReportConversationIntentStore';
import { createReminderRouteCleanups } from './reminderRouteCleanups';
import { useConversationSessions } from '../ragConversation/ConversationSessionsContext';
import type { ReplyDeliverySettings } from '../replyNotifications/replyDeliverySettings';
import { observeReplyDelivery } from '../replyNotifications/observeReplyDelivery';
import {
  showDailyReminderUnavailable,
  showReminderUnavailable,
} from './reminderUnavailable';
import {
  consumeAppointmentReminderTarget,
  consumeDailyReminderTarget,
  acknowledgeDailyReminderTarget,
  subscribeAppointmentReminderOpened,
} from './nativeReminderBridge';

/** One inbox drain lives outside retained navigation scenes. */
export function AppointmentReminderDeliveryHost({
  controller,
  retention,
  loadLocalData,
  canEnterReply,
}: {
  readonly controller: NavigationController<AppNavigationRoute>;
} & ReplyDeliverySettings) {
  const runtime = useAppointmentReminderRuntime();
  const sessions = useConversationSessions();
  useEffect(() => {
    if (!runtime) return;
    let retryWhenNavigationAvailable = false;
    const retryNavigation = () => {
      retryWhenNavigationAvailable = true;
    };
    const navigationDecisions = createReminderNavigationDecisions(
      controller,
      runtime,
      retryNavigation,
    );
    const destination = createDailyReminderDestination({
      ...dailyReminderIntentStore,
      canOpen: entry =>
        ![...runtime.dailyReportTargets.values()].some(
          value => value.entryKey !== entry.entryKey,
        ),
      open: async entry => {
        const snapshot = controller.getSnapshot();
        if (
          [...runtime.dailyReportTargets.entries()].some(
            ([key, value]) =>
              value.entryKey === entry.entryKey &&
              snapshot.routes.some(route => route.key === key),
          )
        )
          return 'opened';
        const decision = await navigationDecisions.daily(
          snapshot.currentRoute.key,
        );
        if (decision !== 'approved') return decision;
        const current = controller.getSnapshot();
        if (
          current.isTransitioning ||
          current.currentRoute.key !== snapshot.currentRoute.key ||
          [...runtime.dailyReportTargets.values()].some(
            value => value.entryKey !== entry.entryKey,
          )
        )
          return 'busy';
        const route = controller.push('daily-report');
        if (!route) return 'busy';
        runtime.dailyReportTargets.set(route.key, entry);
        return 'opened';
      },
    });
    runtime.dailyReportSelection.selectReminder = destination.select;
    const unregisterDaily = registerDailyReminderConsumer(destination.accept);
    const reconcile = () =>
      runtime.coordinator.reconcile().catch(() => undefined);
    const deliverDaily = createDailyReminderDelivery({
      consume: consumeDailyReminderTarget,
      acknowledge: acknowledgeDailyReminderTarget,
      alreadyHandled: destination.alreadyHandled,
      onBusy: () => {
        retryWhenNavigationAvailable = true;
      },
      // The destination confirms after durable storage, immediately before pushing the route.
      confirm: async () => 'approved',
      unavailable: showDailyReminderUnavailable,
    });
    const deliver = createAppointmentReminderDelivery({
      consumeTarget: consumeAppointmentReminderTarget,
      loadAppointments: runtime.list,
      confirmNavigation: navigationDecisions.appointment,
      openVisitPreparation: appointment => {
        if (!navigationDecisions.appointmentRouteIsCurrent()) {
          retryWhenNavigationAvailable = true;
          return false;
        }
        const plan = buildAppointmentReminder(
          [appointment],
          { appointmentId: appointment.id, leadMinutes: 60 },
          0,
        );
        if (!plan) return false;
        const route = controller.push('appointment-preparation');
        if (!route) {
          // A transition may begin after the leave check but before the route push.
          retryWhenNavigationAvailable = true;
          return false;
        }
        runtime.targets.set(route.key, {
          appointmentId: appointment.id,
          timeKey: plan.timeKey,
        });
        return true;
      },
      onUnavailable: showReminderUnavailable,
    });
    // Inbox storage is independent; only navigation decisions share a queue.
    let appointmentQueue = Promise.resolve();
    let conversationQueue = Promise.resolve();
    let conversationRestorePending = true;
    let conversationRestoreDeferred = false;
    const cleanups = createReminderRouteCleanups({
      runtime,
      controller,
      dismiss: destination.dismiss,
    });
    const stopReply = observeReplyDelivery({
      controller,
      sessions,
      retention,
      loadLocalData,
      confirm: navigationDecisions.conversation,
      canEnter: () =>
        AppState.currentState === 'active' && canEnterReply?.() === true,
    });
    const drainConversation = () => {
      conversationQueue = conversationQueue
        .then(async () => {
          // A locked dismissal is retried by the next lifecycle, not by navigation guard publications.
          try {
            await dailyReportConversationIntentStore.retryDismissals();
          } catch {
            return;
          }
          if (!conversationRestorePending) return;
          const result = await restoreDailyReportConversation({
            controller,
            runtime,
            confirm: navigationDecisions.conversation,
          });
          if (result === 'busy') {
            // A daily route blocks restoration until its durable dismissal succeeds.
            if (!runtime.dailyReportTargets.size)
              retryWhenNavigationAvailable = true;
          } else {
            conversationRestorePending = false;
            conversationRestoreDeferred = result === 'deferred';
          }
        })
        // A storage read or write failure is retried on a later lifecycle event.
        .catch(() => undefined);
    };
    const drainDaily = createDailyReminderDrain({
      cleanup: cleanups.daily,
      restore: destination.restore,
      deliver: deliverDaily,
      onBusy: retryNavigation,
      onClosed: drainConversation,
    });
    const drain = () => {
      appointmentQueue = appointmentQueue
        .then(async () => {
          await deliver();
        })
        .catch(() => undefined);
      drainConversation();
      drainDaily();
    };
    let unsubscribe = () => {};
    try {
      unsubscribe = subscribeAppointmentReminderOpened(drain);
    } catch {
      // Reconciliation exposes a missing bridge as an error, never a fake schedule.
    }
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        cleanups.conversation();
        if (conversationRestoreDeferred) {
          conversationRestorePending = true;
          conversationRestoreDeferred = false;
        }
        reconcile().catch(() => undefined);
        drain();
      }
    });
    let routeKeys = controller
      .getSnapshot()
      .routes.map(route => route.key)
      .join('|');
    const navigation = controller.subscribe(() => {
      const snapshot = controller.getSnapshot();
      const nextRouteKeys = snapshot.routes.map(route => route.key).join('|');
      const routesChanged = routeKeys !== nextRouteKeys;
      routeKeys = nextRouteKeys;
      pruneClosedReminderRoutes(runtime, key =>
        snapshot.routes.some(route => route.key === key),
      );
      cleanups.conversation();
      const dailyRouteClosed = [...runtime.dailyReportTargets.keys()].some(
        key => !snapshot.routes.some(route => route.key === key),
      );
      if (retryWhenNavigationAvailable && !snapshot.isTransitioning) {
        retryWhenNavigationAvailable = false;
        drain();
      } else if (dailyRouteClosed && routesChanged) drainDaily();
    });
    reconcile().catch(() => undefined);
    drain();
    return () => {
      if (runtime.dailyReportSelection.selectReminder === destination.select)
        runtime.dailyReportSelection.selectReminder = null;
      unregisterDaily();
      unsubscribe();
      subscription.remove();
      navigation();
      stopReply();
    };
  }, [controller, runtime, sessions, retention, loadLocalData, canEnterReply]);
  return null;
}
