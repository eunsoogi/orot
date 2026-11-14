import { fireEvent, render } from '@testing-library/react-native';
import { CalendarMonthView } from '../CalendarMonthView';

// Month navigation retains the ordinary grid independently of Dynamic Type.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

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
