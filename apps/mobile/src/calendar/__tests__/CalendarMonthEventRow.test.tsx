import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { appColors } from '../../layout/appColors';
import { CalendarMonthView } from '../CalendarMonthView';
import { appointmentFor, event } from '../calendarTestUtils';

function queryWindow(start: string, end: string) {
  return { startDay: start, endDay: end };
}

it('uses a neutral next-visit card and a scalable compact selection action', async () => {
  const longTitle =
    'Synthetic Cardiology and Neurology appointment center for follow-up care';
  const source = event('clinic', '2035-06-02T00:00:00.000Z');
  const visit = {
    ...source,
    calendarEventSnapshot: {
      ...source.calendarEventSnapshot,
      title: longTitle,
    },
  };
  const calendar = await render(
    <CalendarMonthView
      appointmentsLoading={false}
      candidatesLoaded
      events={[visit]}
      initialDate={new Date(2035, 5, 2)}
      linkedAppointment={appointmentFor(visit)}
      onSelectEvent={jest.fn()}
      queryWindow={queryWindow('2035-06-01', '2035-06-10')}
      resultsMayBeIncomplete={false}
    />,
  );

  const card = calendar.getByTestId('calendar-next-visit');
  expect(StyleSheet.flatten(card.props.style)).toMatchObject({
    backgroundColor: appColors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 1,
    minWidth: 0,
    padding: 14,
  });
  const title = calendar.getByTestId('calendar-next-visit-title');
  expect(title).toHaveTextContent(longTitle);
  expect(title.props.allowFontScaling).not.toBe(false);
  expect(StyleSheet.flatten(title.props.style)).toMatchObject({
    flexShrink: 1,
    minWidth: 0,
  });

  const badge = calendar.getByText('다음 외래 방문');
  expect(StyleSheet.flatten(badge.props.style)).toMatchObject({
    backgroundColor: appColors.surface,
    color: appColors.text,
    flexShrink: 1,
  });
  const selection = calendar.getByTestId('calendar-candidate-clinic');
  expect(StyleSheet.flatten(selection.props.style)).toMatchObject({
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
  });
  expect(selection.props.accessibilityState).toMatchObject({
    selected: false,
    disabled: false,
  });
  expect(calendar.getByText('이 일정 선택').props.allowFontScaling).not.toBe(
    false,
  );
});

it('exposes the exact selected event and disables choices while confirmation is pending', async () => {
  const selected = event('clinic', '2035-06-02T00:00:00.000Z');
  const other = event('other-clinic', '2035-06-02T01:00:00.000Z');
  const onSelectEvent = jest.fn();
  const calendar = await render(
    <CalendarMonthView
      appointmentsLoading={false}
      candidatesLoaded
      events={[selected, other]}
      initialDate={new Date(2035, 5, 2)}
      linkedAppointment={null}
      onSelectEvent={onSelectEvent}
      queryWindow={queryWindow('2035-06-01', '2035-06-10')}
      resultsMayBeIncomplete={false}
      selectedEvent={selected}
      selectionDisabled
    />,
  );

  const selectedAction = calendar.getByTestId('calendar-candidate-clinic');
  expect(selectedAction.props.accessibilityState).toMatchObject({
    selected: true,
    disabled: true,
  });
  expect(StyleSheet.flatten(selectedAction.props.style)).toMatchObject({
    backgroundColor: appColors.surface,
  });
  expect(calendar.getByText('선택됨')).toBeTruthy();
  const otherAction = calendar.getByTestId('calendar-candidate-other-clinic');
  expect(otherAction.props.accessibilityState).toMatchObject({
    selected: false,
    disabled: true,
  });

  await fireEvent.press(selectedAction);
  expect(onSelectEvent).not.toHaveBeenCalled();
});

// The selected date retains its shape and trait without blue selection paint.
it('keeps selected dates neutral and explicitly selected', async () => {
  const calendar = await render(
    <CalendarMonthView
      appointmentsLoading={false}
      candidatesLoaded
      events={[]}
      initialDate={new Date(2035, 5, 2)}
      linkedAppointment={null}
      onSelectEvent={jest.fn()}
      queryWindow={queryWindow('2035-06-01', '2035-06-10')}
      resultsMayBeIncomplete={false}
    />,
  );
  expect(
    calendar.getByTestId('calendar-day-2035-06-02').props.accessibilityState,
  ).toEqual({ selected: true });
  expect(
    StyleSheet.flatten(
      calendar.getByTestId('calendar-day-face-2035-06-02').props.style,
    ),
  ).toMatchObject({ backgroundColor: appColors.border });
  await fireEvent.press(calendar.getByTestId('calendar-day-2035-06-03'));
  expect(
    calendar.getByTestId('calendar-day-2035-06-03').props.accessibilityState,
  ).toEqual({ selected: true });
  expect(
    calendar.getByTestId('calendar-day-2035-06-02').props.accessibilityState,
  ).toEqual({ selected: false });
});
