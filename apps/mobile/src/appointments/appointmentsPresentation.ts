import type { Appointment } from '@orot/storage';
import { t, type TranslationKey } from '../i18n';

const appointmentStatusKeys = {
  scheduled: 'appointments.status.scheduled',
  rescheduled: 'appointments.status.rescheduled',
  completed: 'appointments.status.completed',
  cancelled: 'appointments.status.cancelled',
} as const satisfies Record<Appointment['status'], TranslationKey>;

/** Shares the same localized name and status across appointment selection and detail views. */
export function appointmentClinicName(appointment: Appointment): string {
  return (
    appointment.clinicLabel ??
    appointment.reason ??
    t('appointments.fallbackTitle')
  );
}

/** Shares localized status wording between appointment lists and details. */
export function appointmentStatusLabel(appointment: Appointment): string {
  return t(appointmentStatusKeys[appointment.status]);
}
