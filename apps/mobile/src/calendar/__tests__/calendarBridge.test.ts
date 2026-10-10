import { createCalendarBridge } from '../calendarBridge';
import type { EventKitCalendarBridge } from '../types';

test('exposes separate EventKit consent and lookup calls while retaining the Calendar API', async () => {
  const nativeModule = {
    requestEventAccess: jest.fn(async () => 'fullAccess' as const),
    listUpcomingEvents: jest.fn(async () => ({
      access: 'fullAccess' as const,
      events: [],
    })),
    requestAccessAndListUpcomingEvents: jest.fn(async () => ({
      access: 'fullAccess' as const,
      events: [],
    })),
    findEvent: jest.fn(async () => ({
      access: 'fullAccess' as const,
      event: null,
    })),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
  const bridge: EventKitCalendarBridge = createCalendarBridge(nativeModule);

  await bridge.requestEventAccess();
  await bridge.listUpcomingEvents();
  await bridge.requestAccessAndListUpcomingEvents();

  expect(nativeModule.requestEventAccess).toHaveBeenCalledTimes(1);
  expect(nativeModule.listUpcomingEvents).toHaveBeenCalledTimes(1);
  expect(nativeModule.requestAccessAndListUpcomingEvents).toHaveBeenCalledTimes(
    1,
  );
});
