import {
  AppointmentSchema,
  createAppointment,
  updateAppointment,
} from '@orot/domain';
import { appointment as fixture } from '../../nextVisitQuestions/testSupport/fixtures';
import { appointmentStartTime } from '../../calendar/appointmentTime';
import {
  buildAppointmentReminder,
  resolveAppointmentReminderTarget,
} from '../reminderPlan';

const now = Date.parse('2035-06-01T00:00:00Z');
const selection = { appointmentId: fixture.id, leadMinutes: 60 as const };
const snapshot = {
  title: '합성 캘린더 예약',
  timeZoneIdentifier: null,
  floatingStartAt: '2035-06-02T09:30:00.000',
  floatingEndAt: '2035-06-02T10:30:00.000',
  isAllDay: false,
  occurrenceDate: null,
  isDetached: false,
  recurrenceRules: [],
};

function importedAppointment() {
  return createAppointment({
    ...fixture,
    effectiveAt: new Date(2035, 5, 2, 9, 30).toISOString(),
    endsAt: new Date(2035, 5, 2, 10, 30).toISOString(),
    calendarEventIdentifier: 'synthetic-floating-event',
    calendarEventSnapshot: snapshot,
  });
}

function manuallyMoved() {
  return updateAppointment(
    importedAppointment(),
    {
      effectiveAt: new Date(2035, 5, 2, 8, 30).toISOString(),
    },
    '2035-06-01T01:00:00Z',
  );
}

it('uses the durable manual start for scheduling, display and target identity', () => {
  const original = importedAppointment();
  const oldPlan = buildAppointmentReminder([original], selection, now)!;
  // Reparse the serialized record as the repository does on a later app launch.
  const moved = AppointmentSchema.parse(
    JSON.parse(JSON.stringify(manuallyMoved())),
  );
  const plan = buildAppointmentReminder([moved], selection, now)!;
  expect(moved).toMatchObject({ startTimeAuthority: 'manual' });
  expect(appointmentStartTime(moved)).toBe(
    new Date(2035, 5, 2, 8, 30).getTime(),
  );
  expect(plan).toMatchObject({
    appointmentStartAt: new Date(2035, 5, 2, 8, 30).getTime(),
    fireAt: new Date(2035, 5, 2, 7, 30).getTime(),
    floating: false,
    timeKey: `instant:${Date.parse(moved.effectiveAt)}`,
  });
  expect(resolveAppointmentReminderTarget(oldPlan, [moved], now)).toBeNull();
  expect(resolveAppointmentReminderTarget(plan, [moved], now)).toBe(moved);
});

it('restores Calendar authority only when its event is explicitly reconfirmed', () => {
  const moved = manuallyMoved();
  const movedPlan = buildAppointmentReminder([moved], selection, now)!;
  const reconfirmed = updateAppointment(
    moved,
    {
      effectiveAt: new Date(2035, 5, 2, 9, 30).toISOString(),
      calendarEventIdentifier: 'synthetic-floating-event',
      calendarEventSnapshot: snapshot,
    },
    '2035-06-01T02:00:00Z',
  );
  const plan = buildAppointmentReminder([reconfirmed], selection, now)!;
  expect(reconfirmed).not.toHaveProperty('startTimeAuthority');
  expect(plan).toMatchObject({
    floating: true,
    fireAt: new Date(2035, 5, 2, 8, 30).getTime(),
    timeKey: 'floating:2035-06-02T09:30:00.000',
  });
  expect(
    resolveAppointmentReminderTarget(movedPlan, [reconfirmed], now),
  ).toBeNull();
});

it('preserves manual authority through note and end edits and equivalent start instants', () => {
  const moved = manuallyMoved();
  for (const changes of [
    { note: '합성 메모' },
    { endsAt: new Date(2035, 5, 2, 11).toISOString() },
    { effectiveAt: moved.effectiveAt.replace('.000Z', 'Z') },
  ]) {
    const edited = updateAppointment(moved, changes, '2035-06-01T02:00:00Z');
    expect(edited).toMatchObject({ startTimeAuthority: 'manual' });
    expect(buildAppointmentReminder([edited], selection, now)?.timeKey).toBe(
      `instant:${Date.parse(moved.effectiveAt)}`,
    );
  }
});

it('does not infer authority for legacy rescheduled records or end-only edits', () => {
  const original = importedAppointment();
  const legacy = AppointmentSchema.parse({
    ...original,
    status: 'rescheduled',
  });
  const endEdited = updateAppointment(
    original,
    {
      endsAt: new Date(2035, 5, 2, 11).toISOString(),
    },
    '2035-06-01T02:00:00Z',
  );
  for (const appointment of [legacy, endEdited]) {
    expect(appointment).not.toHaveProperty('startTimeAuthority');
    expect(
      buildAppointmentReminder([appointment], selection, now)?.timeKey,
    ).toBe('floating:2035-06-02T09:30:00.000');
  }
  expect(
    AppointmentSchema.safeParse({ ...original, startTimeAuthority: 'inferred' })
      .success,
  ).toBe(false);
});
