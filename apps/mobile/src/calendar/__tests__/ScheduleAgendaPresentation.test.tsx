import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { appColors } from '../../layout/appColors';
import { CalendarMonthView } from '../CalendarMonthView';
import { event } from '../calendarTestUtils';
import {
  formatCalendarAgendaTime,
  formatCalendarEventRange,
} from '../dateTime';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

it('renders a flat agenda with full accessible time and an outlined selection action', async () => {
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
  expect(StyleSheet.flatten(selection.props.style)).toMatchObject({
    backgroundColor: 'transparent',
    borderColor: appColors.primaryText,
    minHeight: 44,
  });
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
