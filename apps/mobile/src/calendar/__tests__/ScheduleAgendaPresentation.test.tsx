import { fireEvent, render, within } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';
import { CalendarMonthView } from '../CalendarMonthView';
import { CalendarSelectionSummary } from '../CalendarSelectionSummary';
import { appointmentFor, event } from '../calendarTestUtils';
import {
  formatCalendarEventRange,
  formatCalendarEventStart,
} from '../dateTime';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  default: jest.fn(),
}));
const dimensions = jest.mocked(useWindowDimensions);
const slot = (id: string, hour: string) =>
  event(id, `2035-06-02T${hour}:00:00.000Z`);
const date = '2035-06-02';
const clinic = slot('clinic', '00');
const appointment = appointmentFor(clinic);
beforeEach(() => {
  dimensions.mockReturnValue({
    width: 393,
    height: 852,
    scale: 3,
    fontScale: 1,
  });
});
function draw({
  events = [clinic],
  saved = null,
  draft = null,
  select = jest.fn(),
}: {
  events?: ReturnType<typeof event>[];
  saved?: typeof appointment | null;
  draft?: ReturnType<typeof event> | null;
  select?: jest.Mock;
} = {}) {
  return (
    <CalendarMonthView
      flat
      appointmentsLoading={false}
      candidatesLoaded
      events={events}
      initialDate={new Date(2035, 5, 2)}
      linkedAppointment={saved}
      onSelectEvent={select}
      queryWindow={null}
      resultsMayBeIncomplete={false}
      selectedEvent={draft}
    />
  );
}

it('opens only the directly tapped date-owned event and does not select it on open or close', async () => {
  const select = jest.fn();
  const screen = await render(draw({ select }));
  expect(screen.queryByTestId('calendar-events-for-selected-date')).toBeNull();
  const cell = within(screen.getByTestId(`schedule-date-events-${date}`));
  const eventBar = cell.getByTestId(`schedule-event-bar-${date}-clinic`);
  await fireEvent.press(eventBar);
  expect(
    await screen.findByTestId('schedule-event-detail-time'),
  ).toHaveTextContent(formatCalendarEventRange(clinic));
  expect(select).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('schedule-event-sheet-close'));
  expect(screen.queryByTestId('schedule-event-detail-time')).toBeNull();
  expect(select).not.toHaveBeenCalled();

  await fireEvent.press(eventBar);
  await fireEvent.press(await screen.findByTestId('calendar-candidate-clinic'));
  expect(select).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenCalledWith(clinic);
  expect(screen.queryByTestId('schedule-event-detail-time')).toBeNull();
});

it('keeps compact overflows reachable and distinguishes the saved occurrence from a new draft', async () => {
  const next = slot('next', '02');
  const third = slot('third', '04');
  const options = { events: [clinic, next, third], saved: appointment };
  const screen = await render(draw(options));
  const cell = within(screen.getByTestId(`schedule-date-events-${date}`));
  expect(
    cell.getByTestId(`schedule-event-bar-${date}-clinic`).props
      .accessibilityState,
  ).toMatchObject({ selected: true });
  expect(cell.queryByTestId(`schedule-event-bar-${date}-next`)).toBeNull();
  await fireEvent.press(cell.getByTestId('schedule-date-event-overflow'));
  await fireEvent.press(await screen.findByRole('button', { name: /^third,/ }));
  expect(
    await screen.findByTestId('schedule-event-detail-time'),
  ).toHaveTextContent(formatCalendarEventRange(third));
  await fireEvent.press(screen.getByTestId('schedule-event-sheet-close'));
  await screen.rerender(draw({ ...options, draft: third }));
  expect(
    cell.getByTestId(`schedule-event-bar-${date}-third`).props
      .accessibilityState,
  ).toMatchObject({ selected: true });
  expect(
    cell.getByTestId(`calendar-day-${date}`).props.accessibilityState,
  ).toMatchObject({
    selected: true,
  });
  await fireEvent.press(cell.getByTestId('schedule-date-event-overflow'));
  expect(
    await screen.findByRole('button', { name: /^clinic,/, selected: false }),
  ).toBeTruthy();
});

it('shows multiple wide-cell titles and start times without the timezone identifier', async () => {
  dimensions.mockReturnValue({
    width: 900,
    height: 900,
    scale: 2,
    fontScale: 1,
  });
  const next = slot('next', '02');
  const screen = await render(draw({ events: [clinic, next] }));
  const cell = within(screen.getByTestId(`schedule-date-events-${date}`));
  expect(
    cell.getByTestId(`schedule-event-bar-${date}-clinic`),
  ).toHaveTextContent(`clinic${formatCalendarEventStart(clinic)}`);
  expect(cell.getByTestId(`schedule-event-bar-${date}-next`)).toHaveTextContent(
    `next${formatCalendarEventStart(next)}`,
  );
  expect(cell.queryByText(/Asia\/Seoul/)).toBeNull();
  expect(cell.queryByTestId('schedule-date-event-overflow')).toBeNull();
});

it('omits the timezone identifier only from the Next Outpatient Visit summary', async () => {
  const screen = await render(
    <CalendarSelectionSummary
      calendar={{
        nextVisitAppointment: appointment,
        linkedAppointment: appointment,
        selectedEvent: null,
        saving: false,
        confirmSelectedEvent: jest.fn(),
        clearSelection: jest.fn(),
      }}
      showNextVisit
      flat
    />,
  );
  const time = screen.getByTestId('schedule-next-visit-time');
  expect(time).toHaveTextContent('2035년 6월 2일 09:00–10:00');
  expect(time).not.toHaveTextContent('Asia/Seoul');
  expect(formatCalendarEventRange(clinic)).toContain('Asia/Seoul');
});
