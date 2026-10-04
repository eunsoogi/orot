import { describe, expect, it } from '@jest/globals';
import {
  AppointmentSchema,
  CalendarAppointmentSnapshotSchema,
  cancelAppointment,
  createAppointment,
  updateAppointment,
} from '../src';
import { metadata } from './fixtures';

const timestamp = '2026-02-03T09:30:00Z';

function manualAppointment() {
  return createAppointment({
    ...metadata('manual-appointment-1', {
      effectiveAt: '2027-03-01T10:00:00-05:00',
    }),
    clinicLabel: '  Cardiology clinic  ',
    note: 'Bring the test results.',
  });
}

const selectedCalendarSnapshot = {
  title: '외래 진료',
  timeZoneIdentifier: 'Asia/Seoul',
  isAllDay: false,
  occurrenceDate: '2027-03-01T00:00:00.000Z',
  isDetached: false,
  recurrenceRules: [
    {
      frequency: 'weekly' as const,
      interval: 2,
      firstDayOfTheWeek: 2,
      daysOfTheWeek: [{ dayOfTheWeek: 2, weekNumber: 0 }],
      daysOfTheMonth: null,
      monthsOfTheYear: null,
      weeksOfTheYear: null,
      daysOfTheYear: null,
      setPositions: null,
      end: { kind: 'count' as const, occurrenceCount: 12 },
    },
  ],
};

describe('appointment domain API', () => {
  it('creates a validated manual appointment and accepts imported provenance', () => {
    const manual = manualAppointment();
    const imported = createAppointment({
      ...metadata('imported-appointment-1', {
        provenance: { origin: 'imported', sourceRecordIds: ['calendar-event-1'] },
      }),
      status: 'rescheduled',
    });

    expect(manual).toMatchObject({
      status: 'scheduled',
      clinicLabel: 'Cardiology clinic',
      note: 'Bring the test results.',
    });
    expect(imported.provenance).toEqual({
      origin: 'imported',
      sourceRecordIds: ['calendar-event-1'],
    });
    expect(AppointmentSchema.safeParse(imported).success).toBe(true);
  });

  it('stores only the confirmed Calendar event identity and schedule semantics together', () => {
    const confirmed = createAppointment({
      ...metadata('calendar-appointment-1', {
        effectiveAt: '2027-03-01T01:00:00Z',
      }),
      endsAt: '2027-03-01T02:00:00Z',
      calendarEventIdentifier: 'event-selected-by-user',
      calendarEventSnapshot: selectedCalendarSnapshot,
    });

    expect(confirmed).toMatchObject({
      effectiveAt: '2027-03-01T01:00:00Z',
      endsAt: '2027-03-01T02:00:00Z',
      calendarEventIdentifier: 'event-selected-by-user',
      calendarEventSnapshot: selectedCalendarSnapshot,
    });
    expect(AppointmentSchema.safeParse(confirmed).success).toBe(true);
    expect(
      AppointmentSchema.safeParse({
        ...confirmed,
        calendarEventSnapshot: undefined,
      }).success,
    ).toBe(false);
  });

  it('validates floating Calendar civil times and recurrence end dates', () => {
    const floatingSnapshot = {
      ...selectedCalendarSnapshot,
      timeZoneIdentifier: null,
      floatingStartAt: '2027-03-01T10:00:00.000',
      floatingEndAt: '2027-03-01T11:00:00.000',
      occurrenceDate: null,
      floatingOccurrenceAt: '2027-03-01T10:00:00.000',
      recurrenceRules: [
        {
          ...selectedCalendarSnapshot.recurrenceRules[0],
          end: {
            kind: 'date' as const,
            date: null,
            floatingDateTime: '2027-06-01T10:00:00.000',
          },
        },
      ],
    };

    expect(CalendarAppointmentSnapshotSchema.safeParse(floatingSnapshot).success).toBe(
      true,
    );
    expect(
      CalendarAppointmentSnapshotSchema.safeParse({
        ...floatingSnapshot,
        floatingStartAt: '2027-02-30T10:00:00.000',
      }).success,
    ).toBe(false);
    expect(
      CalendarAppointmentSnapshotSchema.safeParse({
        ...floatingSnapshot,
        recurrenceRules: [
          {
            ...floatingSnapshot.recurrenceRules[0],
            end: { kind: 'date', date: null, floatingDateTime: null },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('reconfirms a changed event without losing all-day, timezone, or recurrence data', () => {
    const confirmed = createAppointment({
      ...metadata('calendar-appointment-2'),
      calendarEventIdentifier: 'event-selected-by-user',
      calendarEventSnapshot: selectedCalendarSnapshot,
    });
    const allDaySnapshot = {
      ...selectedCalendarSnapshot,
      title: '진료 일정이 변경됨',
      isAllDay: true,
      isDetached: true,
    };

    const reconfirmed = updateAppointment(
      confirmed,
      {
        effectiveAt: '2027-03-08T00:00:00Z',
        endsAt: '2027-03-09T00:00:00Z',
        calendarEventIdentifier: 'event-rescheduled',
        calendarEventSnapshot: allDaySnapshot,
      },
      timestamp,
    );

    expect(reconfirmed).toMatchObject({
      status: 'rescheduled',
      calendarEventIdentifier: 'event-rescheduled',
      effectiveAt: '2027-03-08T00:00:00Z',
      endsAt: '2027-03-09T00:00:00Z',
      calendarEventSnapshot: {
        isAllDay: true,
        isDetached: true,
        timeZoneIdentifier: 'Asia/Seoul',
        recurrenceRules: selectedCalendarSnapshot.recurrenceRules,
      },
    });
    expect(() =>
      updateAppointment(
        confirmed,
        { calendarEventIdentifier: 'without-snapshot' },
        timestamp,
      ),
    ).toThrow();
  });

  it('reschedules an appointment, clears an optional note, and preserves provenance', () => {
    const original = manualAppointment();
    const updated = updateAppointment(
      original,
      {
        effectiveAt: '2027-03-02T11:15:00-05:00',
        clinicLabel: 'Neurology clinic',
        note: null,
      },
      timestamp,
    );

    expect(updated).toMatchObject({
      status: 'rescheduled',
      effectiveAt: '2027-03-02T11:15:00-05:00',
      clinicLabel: 'Neurology clinic',
      recordedAt: timestamp,
      ingestedAt: timestamp,
    });
    expect(updated.note).toBeUndefined();
    expect(updated.provenance).toEqual(original.provenance);
    expect(updated.reviewState).toEqual(original.reviewState);
  });

  it('keeps a content-only edit scheduled and makes cancellation durable', () => {
    const original = manualAppointment();
    const edited = updateAppointment(original, { note: 'Call before arriving.' }, timestamp);
    const cancelled = cancelAppointment(edited, '2026-02-03T10:00:00Z');

    expect(edited.status).toBe('scheduled');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.recordedAt).toBe('2026-02-03T10:00:00Z');
    expect(cancelAppointment(cancelled, timestamp)).toEqual(cancelled);
    expect(() => updateAppointment(cancelled, { clinicLabel: 'Other clinic' }, timestamp)).toThrow(
      'A cancelled appointment cannot be edited.',
    );
  });

  it('moves reviewed appointments to needs-review after an edit or cancellation', () => {
    const reviewed = AppointmentSchema.parse({
      ...manualAppointment(),
      reviewState: {
        status: 'reviewed',
        reviewerId: 'reviewer-1',
        reviewedAt: '2026-02-03T14:05:00Z',
      },
    });
    const changedAt = '2026-02-04T09:30:00Z';

    const updated = updateAppointment(reviewed, { note: 'Updated after review.' }, changedAt);
    const cancelled = cancelAppointment(reviewed, changedAt);

    expect(updated.reviewState).toEqual({
      status: 'needs_review',
      reason: 'Appointment changed after review.',
    });
    expect(cancelled.reviewState).toEqual({
      status: 'needs_review',
      reason: 'Appointment changed after review.',
    });
    expect(AppointmentSchema.safeParse(updated).success).toBe(true);
    expect(AppointmentSchema.safeParse(cancelled).success).toBe(true);
  });
});
