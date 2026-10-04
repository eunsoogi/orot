import type { CalendarEvent } from '../types';
import { calendarSnapshotsEqual } from '../calendarSnapshot';

describe('calendarSnapshotsEqual', () => {
  it('ignores object key order at every level of a confirmed snapshot', () => {
    const stored: CalendarEvent['calendarEventSnapshot'] = {
      title: '외래 방문',
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay: false,
      occurrenceDate: null,
      isDetached: false,
      recurrenceRules: [
        {
          frequency: 'weekly',
          interval: 1,
          firstDayOfTheWeek: 1,
          daysOfTheWeek: [{ dayOfTheWeek: 2, weekNumber: 0 }],
          daysOfTheMonth: null,
          monthsOfTheYear: null,
          weeksOfTheYear: null,
          daysOfTheYear: null,
          setPositions: null,
          end: { kind: 'count', occurrenceCount: 6 },
        },
      ],
    };
    const current: CalendarEvent['calendarEventSnapshot'] = {
      recurrenceRules: [
        {
          end: { occurrenceCount: 6, kind: 'count' },
          setPositions: null,
          daysOfTheYear: null,
          weeksOfTheYear: null,
          monthsOfTheYear: null,
          daysOfTheMonth: null,
          daysOfTheWeek: [{ weekNumber: 0, dayOfTheWeek: 2 }],
          firstDayOfTheWeek: 1,
          interval: 1,
          frequency: 'weekly',
        },
      ],
      isDetached: false,
      occurrenceDate: null,
      isAllDay: false,
      timeZoneIdentifier: 'Asia/Seoul',
      title: '외래 방문',
    };

    expect(calendarSnapshotsEqual(stored, current)).toBe(true);
    expect(
      calendarSnapshotsEqual(stored, {
        ...current,
        floatingStartAt: null,
        floatingEndAt: null,
        floatingOccurrenceAt: null,
      }),
    ).toBe(true);
    expect(
      calendarSnapshotsEqual(stored, { ...current, timeZoneIdentifier: 'UTC' }),
    ).toBe(false);
  });

  it('compares floating occurrence and recurrence civil times across device zones', () => {
    const stored: CalendarEvent['calendarEventSnapshot'] = {
      title: '외래 방문',
      timeZoneIdentifier: null,
      isAllDay: false,
      floatingStartAt: '2035-06-02T09:00:00.000',
      floatingEndAt: '2035-06-02T10:00:00.000',
      occurrenceDate: '2035-06-02T00:00:00.000Z',
      floatingOccurrenceAt: '2035-06-02T09:00:00.000',
      isDetached: false,
      recurrenceRules: [
        {
          frequency: 'weekly',
          interval: 1,
          firstDayOfTheWeek: 1,
          daysOfTheWeek: [{ dayOfTheWeek: 2, weekNumber: 0 }],
          daysOfTheMonth: null,
          monthsOfTheYear: null,
          weeksOfTheYear: null,
          daysOfTheYear: null,
          setPositions: null,
          end: {
            kind: 'date',
            date: '2035-06-30T00:00:00.000Z',
            floatingDateTime: '2035-06-30T09:00:00.000',
          },
        },
      ],
    };
    const movedZone = {
      ...stored,
      occurrenceDate: '2035-06-02T16:00:00.000Z',
      recurrenceRules: [
        {
          ...stored.recurrenceRules[0],
          end: {
            kind: 'date' as const,
            date: '2035-06-30T16:00:00.000Z',
            floatingDateTime: '2035-06-30T09:00:00.000',
          },
        },
      ],
    };

    expect(calendarSnapshotsEqual(stored, movedZone)).toBe(true);
    expect(
      calendarSnapshotsEqual(stored, {
        ...movedZone,
        floatingStartAt: '2035-06-02T10:00:00.000',
      }),
    ).toBe(false);
  });
});
