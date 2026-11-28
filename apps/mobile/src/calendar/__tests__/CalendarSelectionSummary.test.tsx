import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { CalendarSelectionSummary } from '../CalendarSelectionSummary';
import { appointmentFor, event } from '../calendarLinkingTestFixtures';

jest.mock('../../layout/AppSymbol', () => ({
  AppSymbol: ({ name }: { name: string }) =>
    require('react').createElement(require('react-native').View, {
      testID: `symbol-${name}`,
    }),
}));

test('shows the saved visit with a shared title and countdown, without an action or a time zone name', async () => {
  const saved = event('Synthetic visit');
  const view = await render(
    <CalendarSelectionSummary
      calendar={{
        nextVisitAppointment: appointmentFor(saved),
        linkedAppointment: null,
        selectedEvent: null,
        saving: false,
        confirmSelectedEvent: jest.fn(),
        clearSelection: jest.fn(),
      }}
      showNextVisit
      flat
    />,
  );
  const summary = within(screen.getByTestId('schedule-next-visit-summary'));
  expect(summary.getByRole('header', { name: '다음 외래 방문' })).toBeVisible();
  const titleRow = summary.getByTestId('schedule-next-visit-title-row');
  expect(StyleSheet.flatten(titleRow.props.style).flexDirection).toBe('row');
  const title = within(titleRow).getByTestId('schedule-next-visit-title');
  expect(title).toHaveTextContent(saved.calendarEventSnapshot.title);
  expect(
    within(titleRow).getByTestId('schedule-next-visit-countdown'),
  ).toHaveTextContent(/^D(?:[-+]\d+|-day)$/);
  const timeRow = within(summary.getByTestId('schedule-next-visit-time-row'));
  expect(timeRow.getByTestId('symbol-calendar')).toBeTruthy();
  const time = timeRow.getByTestId('schedule-next-visit-time');
  expect(time).toHaveTextContent(/09:00–10:00$/);
  expect(time).not.toHaveTextContent(/Asia\/Seoul|현지 시간/);
  expect(StyleSheet.flatten(title.props.style).fontSize).toBeGreaterThan(
    StyleSheet.flatten(time.props.style).fontSize,
  );
  expect(summary.queryByRole('button')).toBeNull();

  const draft = event('Synthetic draft');
  const confirmSelectedEvent = jest.fn();
  await view.rerender(
    <CalendarSelectionSummary
      calendar={{
        nextVisitAppointment: appointmentFor(saved),
        linkedAppointment: null,
        selectedEvent: draft,
        saving: false,
        confirmSelectedEvent,
        clearSelection: jest.fn(),
      }}
      showNextVisit
      flat
    />,
  );
  expect(screen.queryByTestId('schedule-next-visit-summary')).toBeNull();
  expect(screen.getByTestId('calendar-selected-event-title')).toHaveTextContent(
    draft.calendarEventSnapshot.title,
  );
  expect(confirmSelectedEvent).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('calendar-confirm-selected'));
  expect(confirmSelectedEvent).toHaveBeenCalledTimes(1);
});
