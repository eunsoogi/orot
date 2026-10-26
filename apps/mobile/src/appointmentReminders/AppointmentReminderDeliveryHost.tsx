import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import type { NavigationController } from '../navigation/navigationController';
import type { AppNavigationRoute } from '../routes/appNavigationRoute';
import { useAppointmentReminderRuntime } from './AppointmentReminderContext';
import { createAppointmentReminderDelivery } from './reminderCoordinator';
import { buildAppointmentReminder } from './reminderPlan';
import {
  consumeAppointmentReminderTarget,
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
    const reconcile = () =>
      runtime.coordinator.reconcile().catch(() => undefined);
    const deliver = createAppointmentReminderDelivery({
      consumeTarget: consumeAppointmentReminderTarget,
      loadAppointments: runtime.list,
      confirmNavigation: () => controller.requestTabSwitch(),
      openVisitPreparation: appointment => {
        const plan = buildAppointmentReminder(
          [appointment],
          { appointmentId: appointment.id, leadMinutes: 60 },
          0,
        );
        if (!plan) return false;
        const route = controller.push('appointment-preparation');
        if (!route) return false;
        runtime.targets.set(route.key, {
          appointmentId: appointment.id,
          timeKey: plan.timeKey,
        });
        return true;
      },
      onUnavailable: reason =>
        Alert.alert(
          '진료 준비',
          reason === 'stale'
            ? '예약이 바뀌었거나 취소되어 이 알림을 열 수 없어요. 일정에서 최신 예약을 확인해 주세요.'
            : '예약을 확인하지 못했어요. 앱을 다시 열어 주세요.',
        ),
    });
    const drain = () => {
      deliver().catch(() => undefined);
    };
    let unsubscribe = () => {};
    try {
      unsubscribe = subscribeAppointmentReminderOpened(drain);
    } catch {
      // Reconciliation exposes a missing bridge as an error, never a fake schedule.
    }
    reconcile().catch(() => undefined);
    drain();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        reconcile().catch(() => undefined);
        drain();
      }
    });
    const navigation = controller.subscribe(() => {
      for (const key of runtime.targets.keys()) {
        if (!controller.getSnapshot().routes.some(route => route.key === key))
          runtime.targets.delete(key);
      }
    });
    return () => {
      unsubscribe();
      subscription.remove();
      navigation();
    };
  }, [controller, runtime]);
  return null;
}
