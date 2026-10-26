import type { AppointmentRepository } from '@orot/storage';
import type { AppointmentReminderCoordinator } from './reminderCoordinator';

/**
 * Reconcile only after a durable local mutation. Notification failure is exposed
 * by the coordinator, and must not misreport an already-committed visit as lost.
 * This wrapper never writes to EventKit or requests Calendar authorization.
 */
export function withAppointmentReminders(
  repository: AppointmentRepository,
  reminders: Pick<AppointmentReminderCoordinator, 'reconcile'>,
): AppointmentRepository {
  async function committed<T>(mutation: () => Promise<T>): Promise<T> {
    const result = await mutation();
    try {
      await reminders.reconcile();
    } catch {
      // The reminder status remains an error until a later reconciliation succeeds.
    }
    return result;
  }

  return {
    list: () => repository.list(),
    create: input => committed(() => repository.create(input)),
    confirmCalendarEvent: input =>
      committed(() => repository.confirmCalendarEvent(input)),
    reconfirmCalendarEvent: (id, input) =>
      committed(() => repository.reconfirmCalendarEvent(id, input)),
    update: (id, changes) => committed(() => repository.update(id, changes)),
    cancel: id => committed(() => repository.cancel(id)),
  };
}
