import type { RecordRepository } from '@orot/storage';
import type { CalendarEvent } from '../../calendar/types';
import { healthKitFeatures } from '../types';
import type { UnifiedImportServices } from './types';

export function createTestServices(
  overrides: Partial<UnifiedImportServices> = {},
) {
  const timeline: string[] = [];
  const repository = {} as RecordRepository;
  const calendarEvent: CalendarEvent = {
    calendarEventIdentifier: 'synthetic-calendar-event',
    effectiveAt: '2035-06-02T00:00:00.000Z',
    endsAt: '2035-06-02T01:00:00.000Z',
    calendarEventSnapshot: {
      title: 'Synthetic appointment candidate',
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay: false,
      occurrenceDate: null,
      isDetached: false,
      recurrenceRules: [],
    },
  };
  let clock = 0;
  const services: UnifiedImportServices = {
    healthKit: {
      async requestReadAuthorizations(features) {
        timeline.push(`healthKit.authorization:${features.join(',')}`);
        return {
          availability: 'available',
          requestStatus: 'completed',
          readAuthorization: 'notObservable',
          requestedFeatures: features,
          unsupportedFeatures: [],
        };
      },
    },
    eventKit: {
      async requestEventAccess() {
        timeline.push('eventKit.authorization');
        return 'fullAccess';
      },
      async listUpcomingEvents() {
        timeline.push('eventKit.query');
        return { access: 'fullAccess', events: [calendarEvent] };
      },
    },
    async confirmCalendarEvent() {
      timeline.push('eventKit.confirm');
    },
    async openRepository() {
      timeline.push('storage.open');
      return repository;
    },
    async runFeature(feature, _authorization, _repository, instrumentation) {
      timeline.push(`feature:${feature}`);
      await instrumentation.query(async () => {
        timeline.push(`query:${feature}`);
      });
      await instrumentation.persist(async () => {
        timeline.push(`persist:${feature}`);
      });
      return { status: 'complete', importedCount: 1, deletedCount: 0 };
    },
    monotonicNow() {
      clock += 8;
      return clock;
    },
    ...overrides,
  };
  return { services, timeline, repository, calendarEvent };
}

export function availableBatch(
  features: readonly (typeof healthKitFeatures)[number][],
) {
  return {
    availability: 'available' as const,
    requestStatus: 'completed' as const,
    readAuthorization: 'notObservable' as const,
    requestedFeatures: features,
    unsupportedFeatures: [] as const,
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
}
