import type { AppointmentRepository } from '@orot/storage';

/** Expose only identities returned by successful real repository creates to the native probe. */
export function observeAppointmentCreates(
  repository: AppointmentRepository,
  onCreated: (id: string) => void,
): AppointmentRepository {
  return {
    ...repository,
    async create(input) {
      const appointment = await repository.create(input);
      onCreated(appointment.id);
      return appointment;
    },
  };
}
