import {
  calendarEventDayRange,
  calendarMonthGrid,
  calendarQueryWindow,
  formatCalendarMonth,
} from '../calendarMonth';
import type { CalendarEvent } from '../types';

function event(
  effectiveAt: string,
  endsAt: string,
  overrides: Partial<CalendarEvent['calendarEventSnapshot']> = {},
): CalendarEvent {
  return {
    calendarEventIdentifier: 'event-1',
    effectiveAt,
    endsAt,
    calendarEventSnapshot: {
      title: 'Clinic visit',
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay: false,
      occurrenceDate: null,
      isDetached: false,
      recurrenceRules: [],
      ...overrides,
    },
  };
}

describe('calendar month date model', () => {
  it('places a timed event across a month boundary in its stored timezone', () => {
    expect(
      calendarEventDayRange(
        event('2035-05-31T14:00:00.000Z', '2035-05-31T15:30:00.000Z'),
      ),
    ).toEqual({ startDay: '2035-05-31', endDay: '2035-06-01' });
  });

  it('treats an all-day end as exclusive on the calendar date', () => {
    expect(
      calendarEventDayRange(
        event('2035-06-01T15:00:00.000Z', '2035-06-03T15:00:00.000Z', {
          isAllDay: true,
        }),
      ),
    ).toEqual({ startDay: '2035-06-02', endDay: '2035-06-03' });
  });

  it('keeps floating event dates independent of the device timezone', () => {
    const floating = event(
      '2035-06-01T15:00:00.000Z',
      '2035-06-02T16:00:00.000Z',
      {
        timeZoneIdentifier: null,
        floatingStartAt: '2035-06-02T23:30:00.000',
        floatingEndAt: '2035-06-03T00:30:00.000',
      },
    );
    expect(calendarEventDayRange(floating)).toEqual({
      startDay: '2035-06-02',
      endDay: '2035-06-03',
    });
  });

  it('builds adjacent month cells across the year boundary', () => {
    const december = calendarMonthGrid(2035, 11);

    expect(december).toContainEqual({
      dateKey: '2035-12-31',
      dayNumber: 31,
      belongsToMonth: true,
    });
    expect(december).toContainEqual({
      dateKey: '2036-01-01',
      dayNumber: 1,
      belongsToMonth: false,
    });
    expect(formatCalendarMonth(2036, 0)).toBe('2036년 1월');
  });

  it('keeps query coverage bounded to one local calendar year', () => {
    const start = new Date(2036, 1, 29, 12, 30);

    expect(calendarQueryWindow(start)).toEqual({
      startDay: '2036-02-29',
      endDay: '2037-02-28',
    });
  });
});
