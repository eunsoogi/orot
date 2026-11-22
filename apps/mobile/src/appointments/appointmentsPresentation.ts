import type { Appointment } from '@orot/storage';
import { t, type TranslationKey } from '../i18n';

const appointmentStatusKeys = {
  scheduled: 'appointments.status.scheduled',
  rescheduled: 'appointments.status.rescheduled',
  completed: 'appointments.status.completed',
  cancelled: 'appointments.status.cancelled',
} as const satisfies Record<Appointment['status'], TranslationKey>;

/** Prefer the linked event title already saved on this appointment; do not query Calendar. */
export function appointmentClinicName(appointment: Appointment): string {
  return (
    appointment.calendarEventSnapshot?.title.trim() ||
    appointment.clinicLabel?.trim() ||
    appointment.reason?.trim() ||
    t('appointments.fallbackTitle')
  );
}

/** Shares localized status wording between appointment lists and details. */
export function appointmentStatusLabel(appointment: Appointment): string {
  return t(appointmentStatusKeys[appointment.status]);
}
