import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import type {
  CalendarBridge,
  CalendarEvent,
  UpcomingCalendarEvents,
} from '../types';
import { CalendarAutoSyncController } from '../calendarAutoSync';

function event(identifier: string): CalendarEvent {
  return {
    calendarEventIdentifier: identifier,
    effectiveAt: '2035-06-02T00:00:00.000Z',
    endsAt: '2035-06-02T01:00:00.000Z',
    calendarEventSnapshot: {
      title: identifier,
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay: false,
      occurrenceDate: null,
      isDetached: false,
      recurrenceRules: [],
    },
  };
}

function fullAccess(...events: CalendarEvent[]): UpcomingCalendarEvents {
  return { access: 'fullAccess', events };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => {
    resolve = accept;
  });
  return { promise, resolve };
}

function bridge(overrides: Partial<CalendarBridge> = {}) {
  let eventStoreListener: (() => void) | undefined;
  const value: CalendarBridge = {
    listUpcomingEvents: jest.fn(async () => fullAccess()),
    requestEventAccess: jest.fn(async () => 'notDetermined' as const),
    requestAccessAndListUpcomingEvents: jest.fn(async () => fullAccess()),
    findEvent: jest.fn(async () => ({
      access: 'fullAccess' as const,
      event: null,
    })),
    addEventStoreListener: jest.fn(listener => {
      eventStoreListener = listener;
      return { remove: jest.fn() };
    }),
    ...overrides,
  };
  return {
    value,
    emitEventStoreChange: () => eventStoreListener?.(),
  };
}

function waitForEvents(
  controller: CalendarAutoSyncController,
  identifier: string,
): Promise<void> {
  if (
    controller
      .getSnapshot()
      .events.some(item => item.calendarEventIdentifier === identifier)
  ) {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const unsubscribe = controller.subscribe(() => {
      if (
        controller
          .getSnapshot()
          .events.some(item => item.calendarEventIdentifier === identifier)
      ) {
        unsubscribe();
        resolve();
      }
    });
  });
}

describe('CalendarAutoSyncController', () => {
  it('loads authorized events at startup without requesting access or classifying them', async () => {
    const calendar = bridge({
      listUpcomingEvents: jest.fn(async () =>
        fullAccess(event('initial-event')),
      ),
    });
    const controller = new CalendarAutoSyncController(calendar.value);

    await controller.start();

    expect(controller.getSnapshot().events).toEqual([event('initial-event')]);
    expect(calendar.value.listUpcomingEvents).toHaveBeenCalledTimes(1);
    expect(calendar.value.requestEventAccess).not.toHaveBeenCalled();
    expect(
      calendar.value.requestAccessAndListUpcomingEvents,
    ).not.toHaveBeenCalled();
    controller.stop();
  });

  it('refreshes on foreground return and relevant EventKit changes', async () => {
    let onAppStateChange: ((state: AppStateStatus) => void) | undefined;
    const addAppStateListener = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        onAppStateChange = listener;
        return { remove: jest.fn() } as never;
      });
    const calendar = bridge({
      listUpcomingEvents: jest
        .fn()
        .mockResolvedValueOnce(fullAccess(event('startup')))
        .mockResolvedValueOnce(fullAccess(event('foreground')))
        .mockResolvedValueOnce(fullAccess(event('event-change'))),
    });
    const controller = new CalendarAutoSyncController(calendar.value);

    try {
      await controller.start();
      expect(controller.getSnapshot().events).toEqual([event('startup')]);
      expect(onAppStateChange).toEqual(expect.any(Function));

      onAppStateChange?.('background');
      const foreground = waitForEvents(controller, 'foreground');
      onAppStateChange?.('active');
      await foreground;
      expect(controller.getSnapshot().events).toEqual([event('foreground')]);

      const updated = waitForEvents(controller, 'event-change');
      calendar.emitEventStoreChange();
      await updated;
      expect(calendar.value.listUpcomingEvents).toHaveBeenCalledTimes(3);
    } finally {
      controller.stop();
      addAppStateListener.mockRestore();
    }
  });

  it('serializes overlapping refreshes and publishes only the latest EventKit snapshot', async () => {
    const first = deferred<UpcomingCalendarEvents>();
    const second = deferred<UpcomingCalendarEvents>();
    const started = deferred<void>();
    const listUpcomingEvents = jest
      .fn()
      .mockImplementationOnce(() => {
        started.resolve();
        return first.promise;
      })
      .mockReturnValueOnce(second.promise);
    const calendar = bridge({ listUpcomingEvents });
    const controller = new CalendarAutoSyncController(calendar.value);

    const firstRefresh = controller.start();
    await started.promise;
    calendar.emitEventStoreChange();
    expect(listUpcomingEvents).toHaveBeenCalledTimes(1);

    first.resolve(fullAccess(event('older-snapshot')));
    // The first response is stale; a second read is required before this refresh settles.
    await Promise.resolve();
    await Promise.resolve();
    expect(listUpcomingEvents).toHaveBeenCalledTimes(2);
    expect(
      controller
        .getSnapshot()
        .events.some(item => item.calendarEventIdentifier === 'older-snapshot'),
    ).toBe(false);

    second.resolve(fullAccess(event('latest-snapshot')));
    await firstRefresh;
    expect(controller.getSnapshot().events).toEqual([event('latest-snapshot')]);
    expect(listUpcomingEvents).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it('clears revoked calendar details and reloads after Settings grants access', async () => {
    const listUpcomingEvents = jest
      .fn()
      .mockResolvedValueOnce(fullAccess(event('before-revocation')))
      .mockResolvedValueOnce({ access: 'denied', events: [] })
      .mockResolvedValueOnce(fullAccess(event('authorized-event')));
    const requestEventAccess = jest
      .fn()
      .mockResolvedValueOnce('denied' as const)
      .mockResolvedValueOnce('fullAccess' as const);
    const calendar = bridge({ listUpcomingEvents, requestEventAccess });
    const controller = new CalendarAutoSyncController(calendar.value);
    await controller.start();

    await controller.requestAccess();
    expect(controller.getSnapshot().access).toBe('denied');
    expect(controller.getSnapshot().events).toEqual([]);

    await controller.requestAccess();
    expect(controller.getSnapshot().events).toEqual([
      event('authorized-event'),
    ]);
    expect(requestEventAccess).toHaveBeenCalledTimes(2);
    expect(listUpcomingEvents).toHaveBeenCalledTimes(3);
    controller.stop();
  });
});
