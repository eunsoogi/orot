import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import { t } from '../i18n';
import type { NavigationController } from '../navigation/navigationController';
import type { AppNavigationRoute } from '../routes/appNavigationRoute';
import { useAppointmentReminderRuntime } from './AppointmentReminderContext';
import { createAppointmentReminderDelivery } from './reminderCoordinator';
import { buildAppointmentReminder } from './reminderPlan';
import { createDailyReminderDelivery } from './dailyReminderDelivery';
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
    const reconcile = () =>
      runtime.coordinator.reconcile().catch(() => undefined);
    const deliverDaily = createDailyReminderDelivery({
      consume: consumeDailyReminderTarget,
      acknowledge: acknowledgeDailyReminderTarget,
      onBusy: () => {
        retryWhenNavigationAvailable = true;
      },
      confirm: async () => {
        if (controller.getSnapshot().isTransitioning) {
          retryWhenNavigationAvailable = true;
          return 'busy';
        }
        return (await controller.requestTabSwitch()) ? 'approved' : 'declined';
      },
      unavailable: () =>
        Alert.alert(t('dailyReminder.openTitle'), t('dailyReminder.openError')),
    });
    const deliver = createAppointmentReminderDelivery({
      consumeTarget: consumeAppointmentReminderTarget,
      loadAppointments: runtime.list,
      confirmNavigation: async () => {
        // Distinguish a temporary transition from the user's leave decision.
        if (controller.getSnapshot().isTransitioning) {
          retryWhenNavigationAvailable = true;
          return 'busy';
        }
        return (await controller.requestTabSwitch()) ? 'approved' : 'declined';
      },
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
    // Serialize both families so two simultaneous taps cannot race leave guards.
    let drainQueue = Promise.resolve();
    const drain = () => {
      drainQueue = drainQueue
        .then(async () => {
          await deliver();
          await deliverDaily();
        })
        .catch(() => undefined);
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
      for (const targets of [runtime.targets, runtime.homePreparationTargets]) {
        for (const key of targets.keys()) {
          if (!snapshot.routes.some(route => route.key === key))
            targets.delete(key);
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
      unsubscribe();
      subscription.remove();
      navigation();
    };
  }, [controller, runtime]);
  return null;
}
