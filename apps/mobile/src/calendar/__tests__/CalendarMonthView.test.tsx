import {
  fireEvent,
  render,
  waitFor,
  within,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { appointmentFor, event } from '../calendarTestUtils';
import { CalendarMonthView } from '../CalendarMonthView';
import { calendarEventDayRange } from '../calendarMonth';

function queryWindow(start: string, end: string) {
  return { startDay: start, endDay: end };
}

describe('calendar month view', () => {
  it('preserves a 44pt date target in a horizontally scrollable seven-column region', async () => {
    const calendar = await render(
      <CalendarMonthView
        appointmentsLoading={false}
        candidatesLoaded={false}
        events={[]}
        initialDate={new Date(2035, 5, 2)}
        linkedAppointment={null}
        onSelectEvent={jest.fn()}
        queryWindow={null}
        resultsMayBeIncomplete={false}
      />,
    );

    expect(
      calendar.getByTestId('calendar-date-grid-scroll').props.horizontal,
    ).toBe(true);
    expect(
      StyleSheet.flatten(
        calendar.getByTestId('calendar-date-grid-content').props.style,
      ).minWidth,
    ).toBe(308);
    expect(
      StyleSheet.flatten(
        calendar.getByTestId('calendar-day-2035-06-02').props.style,
      ).minWidth,
    ).toBe(44);
    // Month actions must remain reachable without horizontally scrolling the 308pt grid.
    const dateScroller = within(
      calendar.getByTestId('calendar-date-grid-scroll'),
    );
    expect(dateScroller.queryByTestId('calendar-next-month')).toBeNull();
    expect(dateScroller.queryByTestId('calendar-previous-month')).toBeNull();
  });

  it('shows multiple events and marks the stored visit on its date', async () => {
    const visit = event('clinic', '2035-06-02T00:00:00.000Z');
    const meeting = event('meeting', '2035-06-02T02:00:00.000Z');
    const allDay = {
      ...event('all-day', '2035-06-01T15:00:00.000Z'),
      endsAt: '2035-06-03T15:00:00.000Z',
      calendarEventSnapshot: {
        ...event('all-day', '2035-06-01T15:00:00.000Z').calendarEventSnapshot,
        isAllDay: true,
      },
    };
    const onSelectEvent = jest.fn();

    const calendar = await render(
      <CalendarMonthView
        appointmentsLoading={false}
        candidatesLoaded
        events={[meeting, allDay, visit]}
        initialDate={new Date(2035, 4, 31)}
        linkedAppointment={appointmentFor(visit)}
        onSelectEvent={onSelectEvent}
        queryWindow={queryWindow('2035-06-01', '2035-06-10')}
        resultsMayBeIncomplete={false}
      />,
    );

    await waitFor(() =>
      expect(calendar.getByTestId('calendar-selected-date')).toHaveTextContent(
        '2035년 6월 2일',
      ),
    );
    // The date button summarizes these marks for screen readers; include the
    // hidden visual children here to verify the calendar indicators themselves.
    expect(
      calendar.getByTestId('calendar-day-event-count-2035-06-02', {
        includeHiddenElements: true,
      }),
    ).toHaveTextContent('3');
    expect(
      calendar.getByTestId('calendar-day-next-visit-2035-06-02', {
        includeHiddenElements: true,
      }),
    ).toBeTruthy();
    expect(
      calendar.getByTestId('calendar-day-2035-06-02').props.accessibilityLabel,
    ).toContain('다음 외래 방문');
    expect(calendar.getByTestId('calendar-next-visit-title')).toHaveTextContent(
      'clinic',
    );
    expect(calendar.getByTestId('calendar-candidate-clinic')).toBeTruthy();
    expect(
      calendar.getByTestId(
        'calendar-event-row-candidate:clinic:2035-06-02T00:00:00.000Z',
      ),
    ).toBeTruthy();
    expect(
      calendar.queryByTestId(
        'calendar-event-row-confirmed:clinic:2035-06-02T00:00:00.000Z',
      ),
    ).toBeNull();
    expect(
      calendar.getByTestId('calendar-selected-date').props.allowFontScaling,
    ).not.toBe(false);

    await fireEvent.press(calendar.getByTestId('calendar-candidate-meeting'));
    expect(onSelectEvent).toHaveBeenCalledWith(meeting);

    await fireEvent.press(calendar.getByTestId('calendar-day-2035-06-03'));
    expect(calendar.getByTestId('calendar-selected-date')).toHaveTextContent(
      '2035년 6월 3일',
    );
    expect(
      calendar.getByTestId('calendar-day-event-count-2035-06-03', {
        includeHiddenElements: true,
      }),
    ).toHaveTextContent('1');
    expect(calendar.getByTestId('calendar-candidate-all-day')).toBeTruthy();
  });

  it('describes an empty result as missing returned candidates', async () => {
    const now = new Date('2035-06-02T00:00:00.000Z');
    const seoulEvent = event('seoul-clinic', '2035-06-01T16:00:00.000Z');
    const newYorkAllDayEvent = {
      ...event('new-york-holiday', '2035-05-31T04:00:00.000Z'),
      endsAt: '2035-06-04T04:00:00.000Z',
      calendarEventSnapshot: {
        ...event('new-york-holiday', '2035-05-31T04:00:00.000Z')
          .calendarEventSnapshot,
        timeZoneIdentifier: 'America/New_York',
        isAllDay: true,
      },
    };
    const dateKey = '2035-06-02';
    const occupiesDate = (candidate: typeof seoulEvent) => {
      const range = calendarEventDayRange(candidate);
      return (
        range !== null && range.startDay <= dateKey && dateKey <= range.endDay
      );
    };

    expect(occupiesDate(seoulEvent)).toBe(true);
    expect(occupiesDate(newYorkAllDayEvent)).toBe(true);
    // EventKit's upcoming query drops events whose start predates the read instant.
    const returnedEvents = [seoulEvent, newYorkAllDayEvent].filter(
      candidate => new Date(candidate.effectiveAt).getTime() >= now.getTime(),
    );
    expect(returnedEvents).toEqual([]);

    const calendar = await render(
      <CalendarMonthView
        appointmentsLoading={false}
        candidatesLoaded
        events={returnedEvents}
        initialDate={new Date(2035, 5, 2, 12)}
        linkedAppointment={null}
        onSelectEvent={jest.fn()}
        queryWindow={queryWindow('2035-06-01', '2036-06-01')}
        resultsMayBeIncomplete={false}
      />,
    );

    expect(calendar.getByTestId('calendar-empty')).toHaveTextContent(
      '조회된 일정이 없어요.',
    );
    expect(calendar.getByTestId('calendar-empty-query-note')).toHaveTextContent(
      '이미 시작했지만 이 날짜까지 이어지는 일정은 조회되지 않을 수 있어요.',
    );
    await fireEvent.press(calendar.getByTestId('calendar-day-2035-05-31'));
    expect(calendar.getByTestId('calendar-outside-query')).toBeTruthy();
    expect(calendar.queryByTestId('calendar-empty')).toBeNull();
  });

  it('does not call an unlisted day empty when the bridge result reached its cap', async () => {
    const calendar = await render(
      <CalendarMonthView
        appointmentsLoading={false}
        candidatesLoaded
        events={[]}
        initialDate={new Date(2035, 5, 2)}
        linkedAppointment={null}
        onSelectEvent={jest.fn()}
        queryWindow={queryWindow('2035-06-01', '2035-06-10')}
        resultsMayBeIncomplete
      />,
    );

    expect(calendar.getByTestId('calendar-result-limit')).toBeTruthy();
    expect(calendar.queryByTestId('calendar-empty')).toBeNull();
  });

  it('navigates year boundaries and opens a date from the adjacent month', async () => {
    const calendar = await render(
      <CalendarMonthView
        appointmentsLoading={false}
        candidatesLoaded={false}
        events={[]}
        initialDate={new Date(2035, 11, 31)}
        linkedAppointment={null}
        onSelectEvent={jest.fn()}
        queryWindow={null}
        resultsMayBeIncomplete={false}
      />,
    );

    await fireEvent.press(calendar.getByTestId('calendar-next-month'));
    expect(calendar.getByTestId('calendar-month-title')).toHaveTextContent(
      '2036년 1월',
    );
    expect(calendar.getByTestId('calendar-selected-date')).toHaveTextContent(
      '2036년 1월 31일',
    );
    await fireEvent.press(calendar.getByTestId('calendar-previous-month'));
    expect(calendar.getByTestId('calendar-month-title')).toHaveTextContent(
      '2035년 12월',
    );
    await fireEvent.press(calendar.getByTestId('calendar-day-2036-01-01'));
    expect(calendar.getByTestId('calendar-month-title')).toHaveTextContent(
      '2036년 1월',
    );
    expect(calendar.getByTestId('calendar-selected-date')).toHaveTextContent(
      '2036년 1월 1일',
    );
  });
});
