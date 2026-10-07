import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { event } from '../calendarTestUtils';
import { CalendarMonthView } from '../CalendarMonthView';
import { calendarGridTextScaleLimit } from '../calendarStyles';

describe('calendar month design', () => {
  it('keeps month navigation and date selection accessible at larger text sizes', async () => {
    expect(calendarGridTextScaleLimit).toBe(1.25);
    const screen = await render(
      <CalendarMonthView
        appointmentsLoading={false}
        candidatesLoaded
        events={[event('clinic', '2035-06-02T00:00:00.000Z')]}
        initialDate={new Date(2035, 5, 2, 12)}
        linkedAppointment={null}
        onSelectEvent={jest.fn()}
        queryWindow={{ startDay: '2035-06-01', endDay: '2035-07-01' }}
        resultsMayBeIncomplete={false}
      />,
    );
    const previousMonth = screen.getByTestId('calendar-previous-month');
    const previousStyle = StyleSheet.flatten(
      typeof previousMonth.props.style === 'function'
        ? previousMonth.props.style({ pressed: false })
        : previousMonth.props.style,
    );
    const day = screen.getByTestId('calendar-day-2035-06-02');
    const dayStyle = StyleSheet.flatten(day.props.style);
    const dayNumber = screen.getByTestId('calendar-day-number-2035-06-02');
    const weekday = screen.getByText('일');

    expect(previousMonth.props.accessibilityRole).toBe('button');
    expect(previousMonth.props.accessibilityLabel).toContain('2035년 5월');
    expect(previousStyle.minHeight).toBeGreaterThanOrEqual(44);
    expect(previousStyle.minWidth).toBeGreaterThanOrEqual(44);
    expect(day.props.accessibilityState.selected).toBe(true);
    expect(day.props.accessibilityLabel).toContain('2035년 6월 2일');
    expect(dayStyle.minHeight).toBeGreaterThanOrEqual(44);
    expect(
      screen.getByTestId('calendar-month-title').props.allowFontScaling,
    ).toBe(true);
    expect(dayNumber.props.allowFontScaling).toBe(true);
    expect(dayNumber.props.maxFontSizeMultiplier).toBe(
      calendarGridTextScaleLimit,
    );
    expect(weekday.props.allowFontScaling).toBe(true);
    expect(weekday.props.maxFontSizeMultiplier).toBe(
      calendarGridTextScaleLimit,
    );
  });

  it('gives event selection a full-size labeled action', async () => {
    const screen = await render(
      <CalendarMonthView
        appointmentsLoading={false}
        candidatesLoaded
        events={[event('clinic', '2035-06-02T00:00:00.000Z')]}
        initialDate={new Date(2035, 5, 2, 12)}
        linkedAppointment={null}
        onSelectEvent={jest.fn()}
        queryWindow={{ startDay: '2035-06-01', endDay: '2035-07-01' }}
        resultsMayBeIncomplete={false}
      />,
    );
    const selectAction = screen.getByTestId('calendar-candidate-clinic');
    const selectStyle = StyleSheet.flatten(
      typeof selectAction.props.style === 'function'
        ? selectAction.props.style({ pressed: false })
        : selectAction.props.style,
    );

    expect(selectAction.props.accessibilityRole).toBe('button');
    expect(selectAction.props.accessibilityLabel).toContain('일정 선택');
    expect(selectStyle.minHeight).toBeGreaterThanOrEqual(44);
  });
});
