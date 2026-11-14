import { fireEvent, render, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { CalendarMonthView } from '../CalendarMonthView';

let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  default: () => ({
    width: 393,
    height: 852,
    scale: 3,
    fontScale: mockFontScale,
  }),
}));

const props = {
  appointmentsLoading: false,
  candidatesLoaded: false,
  events: [],
  initialDate: new Date(2035, 5, 2),
  linkedAppointment: null,
  onSelectEvent: jest.fn(),
  queryWindow: null,
  resultsMayBeIncomplete: false,
};

afterEach(() => {
  mockFontScale = 1;
});

it('uses natural height weekday/date rows only for large text and preserves selection across size changes', async () => {
  const screen = await render(<CalendarMonthView {...props} />);
  expect(screen.getByTestId('calendar-date-grid')).toBeTruthy();
  expect(screen.queryByTestId('calendar-accessible-date-list')).toBeNull();
  await fireEvent.press(screen.getByTestId('calendar-day-2035-06-03'));
  mockFontScale = 2;
  await screen.rerender(<CalendarMonthView {...props} />);
  expect(screen.queryByTestId('calendar-date-grid')).toBeNull();
  expect(screen.queryByTestId('calendar-date-grid-scroll')).toBeNull();
  const selected = screen.getByTestId('calendar-day-2035-06-03');
  expect(selected.props.accessibilityState.selected).toBe(true);
  expect(within(selected).getByText('3일 일요일')).toBeTruthy();
  const style = StyleSheet.flatten(selected.props.style);
  expect(style.minHeight).toBe(44);
  expect(style.height).toBeUndefined();
  expect(style.maxHeight).toBeUndefined();
  await fireEvent.press(screen.getByTestId('calendar-day-2035-06-04'));
  expect(
    screen.getByTestId('calendar-day-2035-06-04').props.accessibilityState
      .selected,
  ).toBe(true);
  mockFontScale = 1;
  await screen.rerender(<CalendarMonthView {...props} />);
  expect(screen.getByTestId('calendar-date-grid')).toBeTruthy();
  expect(
    screen.getByTestId('calendar-day-2035-06-04').props.accessibilityState
      .selected,
  ).toBe(true);
});

it('keeps today context in large-text date labels', async () => {
  mockFontScale = 2;
  const today = new Date();
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const screen = await render(
    <CalendarMonthView {...props} initialDate={today} />,
  );
  const day = screen.getByTestId(`calendar-day-${key}`);
  expect(day.props.accessibilityLabel).toContain('오늘');
  expect(within(day).getByText('오늘')).toBeTruthy();
  expect(day.props.accessibilityState.selected).toBe(true);
});
