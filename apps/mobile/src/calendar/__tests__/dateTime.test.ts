import { formatCalendarEventRange } from '../dateTime';
import type { CalendarEvent } from '../types';

function calendarEvent(
  effectiveAt: string,
  endsAt: string,
  isAllDay: boolean,
): CalendarEvent {
  return {
    calendarEventIdentifier: 'event-1',
    effectiveAt,
    endsAt,
    calendarEventSnapshot: {
      title: 'Outpatient visit',
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay,
      occurrenceDate: null,
      isDetached: false,
      recurrenceRules: [],
    },
  };
}

describe('Calendar event date display', () => {
  it('formats timed events in their stored calendar timezone', () => {
    expect(
      formatCalendarEventRange(
        calendarEvent(
          '2027-06-02T00:00:00.000Z',
          '2027-06-02T01:00:00.000Z',
          false,
        ),
      ),
    ).toBe('2027년 6월 2일 09:00–10:00 · Asia/Seoul');
  });

  it('keeps an all-day event on its calendar date', () => {
    expect(
      formatCalendarEventRange(
        calendarEvent(
          '2027-06-01T15:00:00.000Z',
          '2027-06-02T15:00:00.000Z',
          true,
        ),
      ),
    ).toBe('2027년 6월 2일 · 하루 종일');
  });
});
