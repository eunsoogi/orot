import { formatNextVisitTime } from '../format';
import { appointment } from '../testSupport/fixtures';

function calendarAppointment(timeZoneIdentifier: string) {
  return {
    ...appointment,
    calendarEventIdentifier: 'synthetic-calendar-event',
    calendarEventSnapshot: {
      title: '합성 캘린더 예약',
      timeZoneIdentifier,
      isAllDay: false,
      occurrenceDate: null,
      isDetached: false,
      recurrenceRules: [],
    },
  };
}

describe('next visit appointment time', () => {
  it('uses the confirmed Calendar event timezone rather than device timezone', () => {
    // This instant is 02:30 in Los Angeles and 18:30 in Seoul on the same date.
    expect(
      formatNextVisitTime(calendarAppointment('America/Los_Angeles')),
    ).toEqual({
      label: '2035년 6월 2일 토 02:30',
      timeZoneNote: 'calendar',
    });
  });

  it('labels the device-time fallback when a Calendar timezone cannot be read', () => {
    expect(
      formatNextVisitTime(calendarAppointment('Invalid/Timezone'))
        ?.timeZoneNote,
    ).toBe('calendar_unreadable');
  });

  it('identifies device time when there is no linked Calendar snapshot', () => {
    expect(formatNextVisitTime(appointment)?.timeZoneNote).toBe('device');
  });

  it('omits an appointment time when its instant is malformed', () => {
    expect(
      formatNextVisitTime({ ...appointment, effectiveAt: 'not-an-instant' }),
    ).toBeNull();
  });
});
