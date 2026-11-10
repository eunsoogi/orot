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
import { dailyReminderIntentStore } from './dailyReminderIntentStore';
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
    let navigationQueue = Promise.resolve();
    const confirmNavigation = () => {
      const next = navigationQueue.then(async () => {
        if (controller.getSnapshot().isTransitioning) {
          retryWhenNavigationAvailable = true;
          return 'busy' as const;
        }
        return (await controller.requestTabSwitch())
          ? ('approved' as const)
          : ('declined' as const);
      });
      navigationQueue = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    };
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
        const decision = await confirmNavigation();
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
      confirmNavigation,
      openVisitPreparation: appointment => {
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
    let restorePending = true;
    const drain = () => {
      appointmentQueue = appointmentQueue
        .then(async () => {
          await deliver();
        })
        .catch(() => undefined);
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
        runtime.dailyConversationTargets,
      ]) {
        for (const key of targets.keys()) {
          if (!snapshot.routes.some(route => route.key === key))
            targets.delete(key);
        }
      }
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
