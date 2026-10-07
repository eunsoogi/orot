import { NativeEventEmitter, NativeModules } from 'react-native';
import type { EmitterSubscription } from 'react-native';
import type {
  CalendarBridge,
  CalendarEventLookup,
  UpcomingCalendarEvents,
} from './types';

interface NativeCalendarModule {
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
): CalendarBridge {
  const emitter = nativeModule ? new NativeEventEmitter(nativeModule) : null;
  return {
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

export const eventKitCalendarBridge = createCalendarBridge();
