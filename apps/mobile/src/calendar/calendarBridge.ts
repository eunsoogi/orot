import { NativeEventEmitter, NativeModules } from 'react-native';
import type { EmitterSubscription } from 'react-native';
import type {
  CalendarAccessState,
  EventKitCalendarBridge,
  CalendarEventLookup,
  UpcomingCalendarEvents,
} from './types';

interface NativeCalendarModule {
  requestEventAccess(): Promise<CalendarAccessState>;
  listUpcomingEvents(): Promise<UpcomingCalendarEvents>;
  requestAccessAndListUpcomingEvents(): Promise<UpcomingCalendarEvents>;
  findEvent(
    calendarEventIdentifier: string,
    occurrenceDate: string | null,
    floatingOccurrenceAt: string | null,
  ): Promise<CalendarEventLookup>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

function unavailable<T>(): Promise<T> {
  return Promise.reject(new Error('EventKit calendar access is unavailable.'));
}

export function createCalendarBridge(
  nativeModule:
    NativeCalendarModule | undefined = NativeModules.EventKitCalendarModule,
): EventKitCalendarBridge {
  const emitter = nativeModule ? new NativeEventEmitter(nativeModule) : null;
  return {
    requestEventAccess: () =>
      nativeModule ? nativeModule.requestEventAccess() : unavailable(),
    listUpcomingEvents: () =>
      nativeModule ? nativeModule.listUpcomingEvents() : unavailable(),
    requestAccessAndListUpcomingEvents: () =>
      nativeModule
        ? nativeModule.requestAccessAndListUpcomingEvents()
        : unavailable(),
    findEvent: (identifier, occurrenceDate, floatingOccurrenceAt) =>
      nativeModule
        ? nativeModule.findEvent(
            identifier,
            occurrenceDate,
            floatingOccurrenceAt,
          )
        : unavailable(),
    addEventStoreListener(listener) {
      if (!emitter) return { remove: () => undefined };
      const subscription: EmitterSubscription = emitter.addListener(
        'eventStoreChanged',
        listener,
      );
      return subscription;
    },
  };
}

export const eventKitCalendarBridge: EventKitCalendarBridge =
  createCalendarBridge();
