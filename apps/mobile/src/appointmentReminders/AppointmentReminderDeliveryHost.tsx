import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import { t } from '../i18n';
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
import { restoreDailyReportConversation } from '../aiFeatures/integration/restoreDailyReportConversation';
import { dailyReportConversationIntentStore } from '../aiFeatures/integration/dailyReportConversationIntentStore';
import { createDailyConversationRouteCleanup } from '../aiFeatures/integration/dailyConversationRouteCleanup';
import {
  consumeAppointmentReminderTarget,
  consumeDailyReminderTarget,
  acknowledgeDailyReminderTarget,
  subscribeAppointmentReminderOpened,
} from './nativeReminderBridge';

/** One inbox drain lives outside retained navigation scenes. */
export function AppointmentReminderDeliveryHost({
  controller,
}: {
  readonly controller: NavigationController<AppNavigationRoute>;
}) {
  const runtime = useAppointmentReminderRuntime();
  useEffect(() => {
    if (!runtime) return;
    let retryWhenNavigationAvailable = false;
    const navigationDecisions = createReminderNavigationDecisions(
      controller,
      runtime,
      () => {
        retryWhenNavigationAvailable = true;
      },
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
      unavailable: () =>
        Alert.alert(t('dailyReminder.openTitle'), t('dailyReminder.openError')),
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
      onUnavailable: reason =>
        Alert.alert(
          t('medicalAppointments.reminder.openTitle'),
          reason === 'stale'
            ? t('medicalAppointments.reminder.stale')
            : t('medicalAppointments.reminder.unavailable'),
        ),
    });
    // Inbox storage is independent; only navigation decisions share a queue.
    let appointmentQueue = Promise.resolve();
    let dailyQueue = Promise.resolve();
    let conversationQueue = Promise.resolve();
    let restorePending = true;
    let conversationRestorePending = true;
    let conversationRestoreDeferred = false;
    const cleanupConversation = createDailyConversationRouteCleanup({
      runtime,
      routeExists: key =>
        controller.getSnapshot().routes.some(route => route.key === key),
    });
    const drain = () => {
      appointmentQueue = appointmentQueue
        .then(async () => {
          await deliver();
        })
        .catch(() => undefined);
      conversationQueue = conversationQueue
        .then(async () => {
          await dailyReportConversationIntentStore.retryDismissals();
          if (!conversationRestorePending) return;
          const result = await restoreDailyReportConversation({
            controller,
            runtime,
            confirm: navigationDecisions.conversation,
          });
          if (result === 'busy') retryWhenNavigationAvailable = true;
          else {
            conversationRestorePending = false;
            conversationRestoreDeferred = result === 'deferred';
          }
        })
        .catch(() => {
          retryWhenNavigationAvailable = true;
        });
      dailyQueue = dailyQueue
        .then(async () => {
          if (restorePending) {
            const restored = await destination.restore();
            if (restored === 'busy') {
              retryWhenNavigationAvailable = true;
              return;
            }
            restorePending = false;
          }
          await deliverDaily();
        })
        .catch(() => {
          retryWhenNavigationAvailable = true;
        });
    };
    let unsubscribe = () => {};
    try {
      unsubscribe = subscribeAppointmentReminderOpened(drain);
    } catch {
      // Reconciliation exposes a missing bridge as an error, never a fake schedule.
    }
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        cleanupConversation();
        if (conversationRestoreDeferred) {
          conversationRestorePending = true;
          conversationRestoreDeferred = false;
        }
        reconcile().catch(() => undefined);
        drain();
      }
    });
    const navigation = controller.subscribe(() => {
      const snapshot = controller.getSnapshot();
      // Route lifetime, not a rendered view's mount, owns targets through provider/source detours.
      for (const targets of [
        runtime.targets,
        runtime.homePreparationTargets,
        runtime.dailyReportFollowUps,
      ]) {
        for (const key of targets.keys()) {
          if (!snapshot.routes.some(route => route.key === key))
            targets.delete(key);
        }
      }
      cleanupConversation();
      for (const [key, entry] of runtime.dailyReportTargets) {
        if (!snapshot.routes.some(route => route.key === key)) {
          runtime.dailyReportTargets.delete(key);
          destination.dismiss(entry.entryKey).catch(() => undefined);
        }
      }
      if (retryWhenNavigationAvailable && !snapshot.isTransitioning) {
        retryWhenNavigationAvailable = false;
        drain();
      }
    });
    reconcile().catch(() => undefined);
    drain();
    return () => {
      unregisterDaily();
      unsubscribe();
      subscription.remove();
      navigation();
    };
  }, [controller, runtime]);
  return null;
}
