import type { Appointment } from '@orot/storage';
import type { NavigationController } from '../navigation/navigationController';
import type { AppNavigationRoute } from '../routes/appNavigationRoute';
import type { AppointmentReminderRuntime } from './AppointmentReminderContext';
import { buildAppointmentReminder } from './reminderPlan';

/** Recheck the approved route before associating the exact visit with a pushed destination. */
export function createReminderVisitOpener(input: {
  controller: NavigationController<AppNavigationRoute>;
  runtime: AppointmentReminderRuntime;
  routeIsCurrent: () => boolean;
  onBusy: () => void;
  onOpened?: () => void;
}) {
  return (appointment: Appointment): boolean => {
    if (!input.routeIsCurrent()) {
      input.onBusy();
      return false;
    }
    const plan = buildAppointmentReminder(
      [appointment],
      { appointmentId: appointment.id, leadMinutes: 60 },
      0,
    );
    if (!plan) return false;
    const route = input.controller.push('appointment-preparation');
    if (!route) {
      input.onBusy();
      return false;
    }
    input.runtime.targets.set(route.key, {
      appointmentId: appointment.id,
      timeKey: plan.timeKey,
    });
    input.onOpened?.();
    return true;
  };
}
