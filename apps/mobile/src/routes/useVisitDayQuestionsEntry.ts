import { useAppointmentReminderRuntime } from '../appointmentReminders/AppointmentReminderContext';
import type { AppRouteContentProps } from './AppProps';

/** Associate the displayed visit with its guarded route, never with a model session. */
export function useVisitDayQuestionsEntry(
  active: boolean,
  appointment: AppRouteContentProps['nextAppointment'],
  actions: AppRouteContentProps['actions'],
) {
  const runtime = useAppointmentReminderRuntime();
  return () => {
    if (!active || !appointment || !runtime) return;
    const route = actions.push('visit-day-questions');
    if (route)
      runtime.overviewPreparationTargets.set(route.key, appointment.id);
  };
}
