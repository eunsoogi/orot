import type { Appointment } from '@orot/storage';
import { appointment as fixture } from '../../nextVisitQuestions/testSupport/fixtures';
import {
  buildAppointmentReminder,
  resolveAppointmentReminderTarget,
} from '../reminderPlan';

const now = Date.parse('2035-06-01T00:00:00Z');
const selection = { appointmentId: fixture.id, leadMinutes: 60 as const };

describe('local appointment reminder planning', () => {
  it('schedules only the explicitly selected visit without copying health details', () => {
    const other = { ...fixture, id: 'earlier-visit', effectiveAt: '2035-06-01T12:00:00Z' };
    const appointment = { ...fixture, clinicLabel: 'Sensitive clinic', note: 'Sensitive note' };
    expect(buildAppointmentReminder([other, appointment], selection, now)).toEqual({
      ...selection,
      appointmentStartAt: Date.parse(fixture.effectiveAt),
      fireAt: Date.parse('2035-06-02T08:30:00Z'),
      floating: false,
      timeKey: `instant:${Date.parse(fixture.effectiveAt)}`,
    });
    expect(buildAppointmentReminder([fixture], null, now)).toBeNull();
  });

  it('recalculates from a rescheduled committed appointment', () => {
    const moved = { ...fixture, status: 'rescheduled' as const, effectiveAt: '2035-06-03T10:00:00+09:00' };
    expect(buildAppointmentReminder([moved], selection, now)?.fireAt).toBe(
      Date.parse('2035-06-03T00:00:00Z'),
    );
  });

  it.each(['cancelled', 'completed'] as const)('removes reminders for a %s visit', status => {
    expect(buildAppointmentReminder([{ ...fixture, status }], selection, now)).toBeNull();
  });

  it('removes a deleted visit or a reminder whose delivery time has passed', () => {
    expect(buildAppointmentReminder([], selection, now)).toBeNull();
    expect(buildAppointmentReminder([fixture], selection, Date.parse('2035-06-02T08:30:00Z'))).toBeNull();
  });

  it('uses elapsed 24 hours across a daylight-saving transition', () => {
    const appointment = { ...fixture, effectiveAt: '2035-03-11T09:00:00-04:00' };
    expect(buildAppointmentReminder([appointment], { ...selection, leadMinutes: 1440 }, Date.parse('2035-03-01T00:00:00Z'))?.fireAt).toBe(
      Date.parse('2035-03-10T13:00:00Z'),
    );
  });

  it('preserves floating Calendar civil time using the current local time zone', () => {
    const appointment: Appointment = {
      ...fixture,
      effectiveAt: '2035-06-02T00:00:00Z',
      calendarEventSnapshot: {
        timeZoneIdentifier: null,
        floatingStartAt: '2035-06-02T09:30:00.000',
      } as Appointment['calendarEventSnapshot'],
    };
    expect(buildAppointmentReminder([appointment], selection, now)?.fireAt).toBe(
      new Date(2035, 5, 2, 8, 30).getTime(),
    );
  });
});

describe('reminder destination validation', () => {
  const target = { appointmentId: fixture.id, timeKey: `instant:${Date.parse(fixture.effectiveAt)}` };

  it('resolves the named visit even when another visit sorts first', () => {
    const other = { ...fixture, id: 'another-visit' };
    expect(resolveAppointmentReminderTarget(target, [other, fixture], now)).toBe(fixture);
  });

  it('uses civil-time identity for a floating visit instead of a device-zone-dependent instant', () => {
    const appointment: Appointment = {
      ...fixture,
      calendarEventSnapshot: {
        timeZoneIdentifier: null,
        floatingStartAt: '2035-06-02T09:30:00.000',
      } as Appointment['calendarEventSnapshot'],
    };
    const floatingTarget = {
      appointmentId: fixture.id,
      timeKey: 'floating:2035-06-02T09:30:00.000',
    };
    expect(resolveAppointmentReminderTarget(floatingTarget, [appointment], now)).toBe(appointment);
    expect(resolveAppointmentReminderTarget({ ...floatingTarget, timeKey: 'floating:2035-06-03T09:30:00.000' }, [appointment], now)).toBeNull();
  });

  it('rejects rescheduled, cancelled, deleted and elapsed visits without a fallback', () => {
    const moved = { ...fixture, effectiveAt: '2035-06-03T09:30:00Z' };
    for (const appointments of [[moved], [{ ...fixture, status: 'cancelled' as const }], []]) {
      expect(resolveAppointmentReminderTarget(target, appointments, now)).toBeNull();
    }
    expect(resolveAppointmentReminderTarget(target, [fixture], Date.parse(fixture.effectiveAt))).toBeNull();
  });

  it.each([null, 'visit', {}, { appointmentId: fixture.id }, { ...target, timeKey: 12 }])('rejects malformed OS payload %p', value => {
    expect(resolveAppointmentReminderTarget(value, [fixture], now)).toBeNull();
  });
});
