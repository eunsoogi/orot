import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet, View } from 'react-native';
import CalendarLinkingScreen from '../CalendarLinkingScreen';
import {
  bridge,
  event,
  repository,
  syncedCalendar,
} from '../calendarLinkingTestFixtures';

const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
const measuredBounds = new Map<
  string,
  { readonly x: number; readonly width: number }
>();
const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};

function viewport(width: number, fontScale = 1) {
  return { ...originalWindow, width, height: 800, scale: 1, fontScale };
}

function layoutAxis() {
  return StyleSheet.flatten(
    screen.getByTestId('schedule-adaptive-columns').props.style,
  )?.flexDirection;
}

beforeEach(() => {
  measuredBounds.clear();
  Dimensions.set({ window: viewport(1600), screen: viewport(1600) });
  jest
    .spyOn(measurableView.prototype, 'measureInWindow')
    .mockImplementation(function (
      this: { readonly props: { readonly testID?: string } },
      callback,
    ) {
      const bounds = measuredBounds.get(this.props.testID ?? '');
      if (bounds) callback(bounds.x, 0, bounds.width, 800);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});

test('keeps explicit event confirmation through measured narrow large-text reflow', async () => {
  const selected = event('selected-calendar-event');
  const requestAccessAndListUpcomingEvents = jest.fn(async () => ({
    access: 'fullAccess' as const,
    events: [selected],
  }));
  const calendarBridge = bridge({
    requestAccessAndListUpcomingEvents,
    findEvent: jest.fn(async () => ({
      access: 'fullAccess' as const,
      event: selected,
    })),
  });
  const appointments = repository(async () => []);
  measuredBounds.set('schedule-adaptive-columns-host', {
    x: 24,
    width: 1500,
  });

  // ScheduleRoute opts into this layout; measure its parent host instead of using window width.
  await render(
    <CalendarLinkingScreen
      adaptiveScheduleLayout
      repository={appointments}
      bridge={calendarBridge}
      calendarSync={syncedCalendar([selected])}
    />,
  );
  await fireEvent(
    screen.getByTestId('schedule-adaptive-columns-host'),
    'layout',
    { nativeEvent: { layout: { x: 24, y: 0, width: 1500, height: 800 } } },
  );

  expect(requestAccessAndListUpcomingEvents).not.toHaveBeenCalled();
  await fireEvent.press(
    await screen.findByTestId('calendar-candidate-selected-calendar-event'),
  );
  expect(layoutAxis()).toBe('row');
  expect(screen.getByTestId('calendar-selected-event-title')).toBeTruthy();
  expect(screen.queryByTestId('schedule-next-visit-summary')).toBeNull();
  expect(appointments.confirmCalendarEvent).not.toHaveBeenCalled();

  await act(async () => {
    measuredBounds.set('schedule-adaptive-columns-host', {
      x: 24,
      width: 552,
    });
    Dimensions.set({ window: viewport(600, 2), screen: viewport(600, 2) });
  });
  await fireEvent(
    screen.getByTestId('schedule-adaptive-columns-host'),
    'layout',
    { nativeEvent: { layout: { x: 24, y: 0, width: 552, height: 800 } } },
  );

  expect(layoutAxis()).toBe('column');
  expect(screen.getByTestId('calendar-selected-event-title')).toBeTruthy();
  expect(screen.getByTestId('calendar-confirm-selected')).toBeTruthy();
  expect(appointments.confirmCalendarEvent).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('calendar-confirm-selected'));
  expect(appointments.confirmCalendarEvent).toHaveBeenCalledWith(selected);
});
