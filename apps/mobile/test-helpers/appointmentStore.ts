import type {
  Appointment,
  AppointmentChanges,
  AppointmentRepository,
  ManualAppointmentInput,
} from '@orot/storage';

export function createAppointmentStore(
  initialAppointments: Appointment[] = [],
) {
  let appointments = [...initialAppointments];
  let nextId = 0;
  const recordedAt = '2026-02-03T09:00:00Z';
  const list = jest.fn(async () => [...appointments]);
  const create = jest.fn(async (input: ManualAppointmentInput) => {
    const appointment = {
      id: 'manual-' + ++nextId,
      ...input,
      status: 'scheduled',
      recordedAt,
      ingestedAt: recordedAt,
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
    } as Appointment;
    appointments = [...appointments, appointment];
    return appointment;
  });
  const update = jest.fn(async (id: string, changes: AppointmentChanges) => {
    const current = appointments.find(item => item.id === id);
    if (!current) throw new Error('Appointment not found.');
    const changed: Appointment = {
      ...current,
      ...changes,
      status:
        changes.effectiveAt && changes.effectiveAt !== current.effectiveAt
          ? 'rescheduled'
          : current.status,
      note: changes.note === null ? undefined : changes.note ?? current.note,
      endsAt:
        changes.endsAt === null ? undefined : changes.endsAt ?? current.endsAt,
      recordedAt,
      ingestedAt: recordedAt,
    };
    appointments = appointments.map(item => (item.id === id ? changed : item));
    return changed;
  });
  const cancel = jest.fn(async (id: string) => {
    const current = appointments.find(item => item.id === id);
    if (!current) throw new Error('Appointment not found.');
    const cancelled: Appointment = {
      ...current,
      status: 'cancelled',
      recordedAt,
      ingestedAt: recordedAt,
    };
    appointments = appointments.map(item =>
      item.id === id ? cancelled : item,
    );
    return cancelled;
  });
  return {
    repository: { list, create, update, cancel } as AppointmentRepository,
    list,
    create,
    update,
    cancel,
    getAppointments: () => [...appointments],
  };
}
