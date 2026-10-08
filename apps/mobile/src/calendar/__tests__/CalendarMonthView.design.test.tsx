import { fireEvent, render, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { event } from '../calendarTestUtils';
import { CalendarMonthView } from '../CalendarMonthView';
import { calendarGridTextScaleLimit, calendarStyles } from '../calendarStyles';

describe('calendar month design', () => {
  it('preserves static styles used by the unassigned calendar screen', () => {
    expect(StyleSheet.flatten(calendarStyles.container)).toEqual({
      flexGrow: 1,
      gap: 14,
      justifyContent: 'center',
      padding: 24,
      backgroundColor: '#f7f8fa',
    });
    expect(StyleSheet.flatten(calendarStyles.title)).toEqual({
      color: '#17212b',
      fontSize: 24,
      fontWeight: '700',
    });
    expect(StyleSheet.flatten(calendarStyles.message)).toEqual({
      color: '#45515f',
      fontSize: 15,
    });
    expect(StyleSheet.flatten(calendarStyles.card)).toEqual({
      backgroundColor: 'white',
      borderRadius: 10,
      gap: 8,
      padding: 14,
    });
    expect(StyleSheet.flatten(calendarStyles.eventTitle)).toEqual({
      color: '#17212b',
      fontSize: 17,
      fontWeight: '600',
    });
    expect(StyleSheet.flatten(calendarStyles.warning)).toEqual({
      color: '#8a4b08',
      fontSize: 15,
    });
    expect(StyleSheet.flatten(calendarStyles.error)).toEqual({
      color: '#a12b25',
      fontSize: 15,
    });
  });

  it('keeps month navigation outside the horizontal date viewport', async () => {
    const screen = await render(
      <CalendarMonthView
        appointmentsLoading={false}
        candidatesLoaded={false}
        events={[]}
        initialDate={new Date(2035, 5, 2, 12)}
        linkedAppointment={null}
        onSelectEvent={jest.fn()}
        queryWindow={null}
        resultsMayBeIncomplete={false}
      />,
    );
    const dateViewport = within(screen.getByTestId('calendar-date-viewport'));

    // Keep weekday headings beside the date cells so their columns scroll together.
    expect(dateViewport.getByText('일')).toBeTruthy();
    expect(dateViewport.getByTestId('calendar-date-grid')).toBeTruthy();
    expect(dateViewport.queryByTestId('calendar-previous-month')).toBeNull();
    expect(dateViewport.queryByTestId('calendar-next-month')).toBeNull();
  });

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
    expect(dayStyle.minWidth).toBeGreaterThanOrEqual(44);
    const dateRegion = StyleSheet.flatten(
      screen.getByTestId('calendar-date-content').props.style,
    );
    // A 320pt screen with 20pt side padding has only 280pt of content space.
    // The scrollable date region must still fit all seven 44pt columns.
    expect(dateRegion.width).toBe(7 * 44);
    const viewport = screen.getByTestId('calendar-date-viewport');
    for (const width of [280, 700, 280]) {
      await fireEvent(viewport, 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width, height: 400 } },
      });
      expect(
        StyleSheet.flatten(
          screen.getByTestId('calendar-date-content').props.style,
        ).width,
      ).toBe(Math.max(width, 7 * 44));
    }
    expect(StyleSheet.flatten(weekday.props.style).minWidth).toBe(
      dayStyle.minWidth,
    );
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
