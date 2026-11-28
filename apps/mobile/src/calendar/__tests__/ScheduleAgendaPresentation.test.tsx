import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { appColors } from '../../layout/appColors';
import { CalendarMonthView } from '../CalendarMonthView';
import { appointmentFor, event } from '../calendarTestUtils';
import {
  formatCalendarAgendaTime,
  formatCalendarEventRange,
} from '../dateTime';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

it('renders a flat agenda with full accessible time and a Liquid Glass selection action', async () => {
  const visit = event('clinic', '2035-06-02T00:00:00.000Z');
  const onSelectEvent = jest.fn();
  const screen = await render(
    <CalendarMonthView
      flat
      appointmentsLoading={false}
      candidatesLoaded
      events={[visit]}
      initialDate={new Date(2035, 5, 2)}
      linkedAppointment={null}
      onSelectEvent={onSelectEvent}
      queryWindow={{ startDay: '2035-06-01', endDay: '2035-06-10' }}
      resultsMayBeIncomplete={false}
    />,
  );

  expect(screen.getByTestId('calendar-selected-date')).toHaveTextContent(
    '6월 2일 토요일',
  );
  const time = screen.getByText(formatCalendarAgendaTime(visit, '2035-06-02'));
  expect(time).not.toHaveTextContent('6월 2일');
  expect(time.props.accessibilityLabel).toBe(formatCalendarEventRange(visit));
  const selection = screen.getByTestId('calendar-candidate-clinic');
  expect(selection).toHaveStyle({ borderRadius: 28, minHeight: 44 });
  expect(
    screen.getByTestId('calendar-candidate-clinic-glass').props.pointerEvents,
  ).toBe('none');
  expect(
    StyleSheet.flatten(screen.getByTestId('calendar-next-month').props.style),
  ).toMatchObject({ backgroundColor: 'transparent', height: 44, width: 44 });
  expect(
    StyleSheet.flatten(
      screen.getByTestId('calendar-day-face-2035-06-02').props.style,
    ),
  ).toMatchObject({ backgroundColor: appColors.primaryAction });
  await fireEvent.press(selection);
  expect(onSelectEvent).toHaveBeenCalledWith(visit);
});

it('keeps both dates when a timed agenda item crosses midnight', () => {
  const visit = event('clinic', '2035-06-02T14:45:00.000Z');
  const label = formatCalendarAgendaTime(visit, '2035-06-02');
  expect(label).toBe(formatCalendarEventRange(visit));
  expect(label).toContain('6월 2일');
  expect(label).toContain('6월 3일');
});

it('marks only the exact saved occurrence as selected without creating a draft', async () => {
  const earliest = event('other-event', '2035-06-02T00:00:00.000Z');
  const visit = event('clinic', '2035-06-02T01:00:00.000Z');
  const sameSeries = event('clinic', '2035-06-02T05:00:00.000Z');
  const onSelectEvent = jest.fn();
  const screen = await render(
    <CalendarMonthView
      flat
      appointmentsLoading={false}
      candidatesLoaded
      events={[earliest, visit, sameSeries]}
      initialDate={new Date(2035, 5, 2)}
      linkedAppointment={appointmentFor(visit)}
      onSelectEvent={onSelectEvent}
      queryWindow={null}
      resultsMayBeIncomplete={false}
    />,
  );

  const selected = screen.getByRole('button', {
    name: /clinic.*다음 외래 방문.*선택됨/,
    selected: true,
  });
  expect(selected).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /이 일정 선택/ })).toHaveLength(
    2,
  );
  expect(onSelectEvent).not.toHaveBeenCalled();
});

it('marks the saved snapshot rather than a changed, unconfirmed live occurrence', async () => {
  const visit = event('clinic', '2035-06-02T01:00:00.000Z');
  const changed = {
    ...visit,
    calendarEventSnapshot: {
      ...visit.calendarEventSnapshot,
      title: 'Updated clinic',
    },
  };
  const onSelectEvent = jest.fn();
  const screen = await render(
    <CalendarMonthView
      flat
      appointmentsLoading={false}
      candidatesLoaded
      events={[changed]}
      initialDate={new Date(2035, 5, 2)}
      linkedAppointment={appointmentFor(visit)}
      onSelectEvent={onSelectEvent}
      queryWindow={null}
      resultsMayBeIncomplete={false}
    />,
  );

  const saved = screen.getByTestId('schedule-saved-visit-selection');
  expect(saved.props.accessibilityLabel).toMatch(/다음 외래 방문.*선택됨/);
  expect(saved.props.accessibilityRole).toBeUndefined();
  const candidate = screen.getByRole('button', {
    name: /Updated clinic.*이 일정 선택/,
    selected: false,
  });
  await fireEvent.press(candidate);
  expect(onSelectEvent).toHaveBeenCalledWith(changed);
});

it('keeps a saved visit labeled separately while a different draft is selected', async () => {
  const visit = event('clinic', '2035-06-02T01:00:00.000Z');
  const draft = event('new-clinic', '2035-06-02T05:00:00.000Z');
  const onSelectEvent = jest.fn();
  const renderMonth = (selectedEvent?: typeof draft) => (
    <CalendarMonthView
      flat
      appointmentsLoading={false}
      candidatesLoaded
      events={[visit, draft]}
      initialDate={new Date(2035, 5, 2)}
      linkedAppointment={appointmentFor(visit)}
      onSelectEvent={onSelectEvent}
      queryWindow={null}
      resultsMayBeIncomplete={false}
      selectedEvent={selectedEvent}
    />
  );
  const screen = await render(renderMonth());
  await fireEvent.press(screen.getByTestId('calendar-candidate-new-clinic'));
  expect(onSelectEvent).toHaveBeenCalledWith(draft);
  await screen.rerender(renderMonth(draft));

  expect(
    screen.getByRole('button', {
      name: /^clinic.*다음 외래 방문$/,
      selected: false,
    }),
  ).toBeTruthy();
  expect(
    screen
      .getAllByRole('button', { name: /선택됨$/, selected: true })
      .map(button => button.props.testID),
  ).toEqual(['calendar-candidate-new-clinic']);
});
