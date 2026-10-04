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

function floatingCalendarEvent(
  effectiveAt: string,
  endsAt: string,
  isAllDay: boolean,
  floatingStartAt: string,
  floatingEndAt: string,
): CalendarEvent {
  const event = calendarEvent(effectiveAt, endsAt, isAllDay);
  return {
    ...event,
    calendarEventSnapshot: {
      ...event.calendarEventSnapshot,
      timeZoneIdentifier: null,
      floatingStartAt,
      floatingEndAt,
      floatingOccurrenceAt: null,
    },
  } as CalendarEvent;
}

function withDeviceTimeZone(timeZone: string, run: () => void): void {
  const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
  const resolvedOptionsSpy = jest
    .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
    .mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...originalResolvedOptions.call(this), timeZone };
    });
  try {
    run();
  } finally {
    resolvedOptionsSpy.mockRestore();
  }
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

  it('keeps floating all-day events on their calendar date after a device timezone change', () => {
    withDeviceTimeZone('America/Los_Angeles', () => {
      expect(
        formatCalendarEventRange(
          floatingCalendarEvent(
            '2035-06-01T15:00:00.000Z',
            '2035-06-02T15:00:00.000Z',
            true,
            '2035-06-02T00:00:00.000',
            '2035-06-03T00:00:00.000',
          ),
        ),
      ).toBe('2035년 6월 2일 · 하루 종일');
    });
  });

  it('keeps floating timed events at the selected local time after a device timezone change', () => {
    withDeviceTimeZone('America/Los_Angeles', () => {
      expect(
        formatCalendarEventRange(
          floatingCalendarEvent(
            '2027-06-02T00:00:00.000Z',
            '2027-06-02T01:00:00.000Z',
            false,
            '2027-06-02T09:00:00.000',
            '2027-06-02T10:00:00.000',
          ),
        ),
      ).toBe('2027년 6월 2일 09:00–10:00 · 현지 시간');
    });
  });
});
