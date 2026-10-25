import { fireEvent, render } from '@testing-library/react-native';
import { appointmentFor, event } from '../calendarTestUtils';
import { CalendarMonthView } from '../CalendarMonthView';

function queryWindow(start: string, end: string) {
  return { startDay: start, endDay: end };
}

describe('calendar month visit reconciliation', () => {
  it('keeps a changed same-occurrence candidate separate from the saved visit', async () => {
    const confirmed = event('clinic', '2035-06-02T10:00:00.000Z');
    const occurrenceDate = '2035-06-02T10:00:00.000Z';
    const saved = {
      ...confirmed,
      calendarEventSnapshot: {
        ...confirmed.calendarEventSnapshot,
        title: 'Confirmed clinic',
        occurrenceDate,
      },
    };
    const changed = {
      ...confirmed,
      calendarEventSnapshot: {
        ...confirmed.calendarEventSnapshot,
        title: 'Unconfirmed changed clinic',
        occurrenceDate,
      },
    };
    const calendar = await render(
      <CalendarMonthView
        appointmentsLoading={false}
        candidatesLoaded
        events={[changed]}
        initialDate={new Date(2035, 5, 2, 12)}
        linkedAppointment={appointmentFor(saved)}
        onSelectEvent={jest.fn()}
        queryWindow={queryWindow('2035-06-01', '2036-06-01')}
        resultsMayBeIncomplete={false}
      />,
    );

    expect(calendar.getByTestId('calendar-next-visit-title')).toHaveTextContent(
      'Confirmed clinic',
    );
    expect(calendar.getByText('Unconfirmed changed clinic')).toBeTruthy();
    expect(calendar.getByTestId('calendar-candidate-clinic')).toBeTruthy();
    expect(
      calendar.getByTestId(
        'calendar-event-row-confirmed:clinic:2035-06-02T10:00:00.000Z',
      ),
    ).toBeTruthy();
    expect(
      calendar.getByTestId(
        'calendar-event-row-candidate:clinic:2035-06-02T10:00:00.000Z',
      ),
    ).toBeTruthy();
  });

  it('keeps a rescheduled recurring occurrence at its saved time until reconfirmed', async () => {
    const occurrenceDate = '2035-06-02T10:00:00.000Z';
    const weeklyRule = {
      frequency: 'weekly' as const,
      interval: 1,
      firstDayOfTheWeek: 2,
      daysOfTheWeek: [{ dayOfTheWeek: 2, weekNumber: 0 }],
      daysOfTheMonth: null,
      monthsOfTheYear: null,
      weeksOfTheYear: null,
      daysOfTheYear: null,
      setPositions: null,
      end: null,
    };
    const source = event('recurring-clinic', '2035-06-02T10:00:00.000Z');
    const savedEvent = {
      ...source,
      calendarEventSnapshot: {
        ...source.calendarEventSnapshot,
        occurrenceDate,
        recurrenceRules: [weeklyRule],
      },
    };
    const rescheduledCandidate = {
      ...savedEvent,
      effectiveAt: '2035-06-03T10:00:00.000Z',
      endsAt: '2035-06-03T11:00:00.000Z',
    };
    const calendar = await render(
      <CalendarMonthView
        appointmentsLoading={false}
        candidatesLoaded
        events={[rescheduledCandidate]}
        initialDate={new Date(2035, 5, 2, 12)}
        linkedAppointment={appointmentFor(savedEvent)}
        onSelectEvent={jest.fn()}
        queryWindow={queryWindow('2035-06-01', '2036-06-01')}
        resultsMayBeIncomplete={false}
      />,
    );

    expect(
      calendar.getByTestId(
        'calendar-event-row-confirmed:recurring-clinic:2035-06-02T10:00:00.000Z',
      ),
    ).toBeTruthy();
    await fireEvent.press(calendar.getByTestId('calendar-day-2035-06-03'));
    expect(
      calendar.getByTestId('calendar-candidate-recurring-clinic'),
    ).toBeTruthy();
    expect(calendar.queryByTestId('calendar-next-visit')).toBeNull();
    expect(
      calendar.getByTestId(
        'calendar-event-row-candidate:recurring-clinic:2035-06-02T10:00:00.000Z',
      ),
    ).toBeTruthy();
  });
});
