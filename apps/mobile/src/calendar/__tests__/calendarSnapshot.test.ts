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
      calendarSnapshotsEqual(stored, { ...current, timeZoneIdentifier: 'UTC' }),
    ).toBe(false);
  });
});
