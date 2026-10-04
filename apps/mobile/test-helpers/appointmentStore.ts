import type {
  Appointment,
  AppointmentChanges,
  AppointmentRepository,
  CalendarAppointmentInput,
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
  const confirmCalendarEvent = jest.fn(async (input: CalendarAppointmentInput) => {
    const appointment = {
      id: 'calendar-' + ++nextId,
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
  const reconfirmCalendarEvent = jest.fn(
    async (id: string, input: CalendarAppointmentInput) => {
      const current = appointments.find(item => item.id === id);
      if (!current) throw new Error('Appointment not found.');
      const changed: Appointment = {
        ...current,
        ...input,
        status:
          input.effectiveAt !== current.effectiveAt || input.endsAt !== current.endsAt
            ? 'rescheduled'
            : current.status,
        recordedAt,
        ingestedAt: recordedAt,
      };
      appointments = appointments.map(item => (item.id === id ? changed : item));
      return changed;
    },
  );
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
      calendarEventIdentifier:
        changes.calendarEventIdentifier === null
          ? undefined
          : changes.calendarEventIdentifier ?? current.calendarEventIdentifier,
      calendarEventSnapshot:
        changes.calendarEventSnapshot === null
          ? undefined
          : changes.calendarEventSnapshot ?? current.calendarEventSnapshot,
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
    repository: {
      list,
      create,
      confirmCalendarEvent,
      reconfirmCalendarEvent,
      update,
      cancel,
    } satisfies AppointmentRepository,
    list,
    create,
    confirmCalendarEvent,
    reconfirmCalendarEvent,
    update,
    cancel,
    getAppointments: () => [...appointments],
  };
}
