import { CalendarAppointmentSnapshotSchema } from '@orot/domain';
import type { CalendarRangeEvent, CalendarRangeBridge } from './types';

export interface CalendarRangeSnapshot {
  readonly fromInclusive: string;
  readonly toExclusive: string;
  readonly events: readonly CalendarRangeEvent[];
  /** Local freshness check only. A successful check does not grant provider consent. */
  revalidate(): Promise<boolean>;
  dispose(): void;
}

function identity(event: CalendarRangeEvent): string {
  const value = event.calendarEventSnapshot;
  return JSON.stringify([
    event.calendarEventIdentifier,
    value.floatingOccurrenceAt ?? value.occurrenceDate ?? event.effectiveAt,
  ]);
}

/** Canonical comparison includes absolute and floating times, detecting zone changes too. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Read every accessible calendar in a bounded interval without importing events or
 * prompting for permission. Titles stay local until a caller obtains exact payload
 * consent; no notes, attendees or locations are included by the native serializer.
 */
export async function readCalendarRangeSnapshot(
  bridge: CalendarRangeBridge,
  fromInclusive: string,
  toExclusive: string,
): Promise<CalendarRangeSnapshot> {
  const start = Date.parse(fromInclusive);
  const end = Date.parse(toExclusive);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > 32 * 86400_000
  )
    throw new Error('invalid_calendar_window');
  let invalidated = false;
  let disposed = false;
  let retainedEvents: CalendarRangeEvent[] = [];
  // Freshness loss is terminal: restoration requires a newly read snapshot.
  const invalidate = () => {
    invalidated = true;
    retainedEvents.length = 0;
    return false;
  };
  const subscription = bridge.addEventStoreListener(invalidate);
  const read = async () => {
    const result = await bridge.listEventsInRange(fromInclusive, toExclusive);
    if (
      result.access !== 'fullAccess' ||
      !result.query?.complete ||
      result.query.omittedEventCount !== 0 ||
      result.query.resultLimit !== null ||
      Date.parse(result.query.fromInclusive) !== start ||
      Date.parse(result.query.toExclusive) !== end
    )
      throw new Error('calendar_coverage_unavailable');
    const events = result.events.map(event => {
      const snapshot = CalendarAppointmentSnapshotSchema.parse(
        event.calendarEventSnapshot,
      );
      const begins = Date.parse(event.effectiveAt);
      const ends = Date.parse(event.endsAt);
      if (
        !event.calendarEventIdentifier ||
        !Number.isFinite(begins) ||
        !Number.isFinite(ends) ||
        ends < begins ||
        begins >= end ||
        (ends <= start && begins < start)
      ) {
        throw new Error('invalid_calendar_event');
      }
      if (
        event.calendarStatus !== undefined &&
        !['none', 'confirmed', 'tentative', 'canceled'].includes(
          event.calendarStatus,
        )
      )
        throw new Error('invalid_calendar_status');
      return {
        ...(event.calendarStatus !== undefined
          ? { calendarStatus: event.calendarStatus }
          : {}),
        calendarEventIdentifier: event.calendarEventIdentifier,
        effectiveAt: event.effectiveAt,
        endsAt: event.endsAt,
        calendarEventSnapshot: snapshot,
      };
    });
    if (new Set(events.map(identity)).size !== events.length)
      throw new Error('ambiguous_calendar_occurrence');
    return events.sort((a, b) => identity(a).localeCompare(identity(b)));
  };
  try {
    const events = await read();
    if (invalidated) throw new Error('calendar_changed');
    retainedEvents = events;
    const original = canonical(events);
    return {
      fromInclusive,
      toExclusive,
      events,
      async revalidate() {
        if (invalidated || disposed || canonical(events) !== original)
          return invalidate();
        try {
          const current = await read();
          if (invalidated || disposed || canonical(current) !== original)
            return invalidate();
          return true;
        } catch {
          return invalidate();
        }
      },
      dispose() {
        if (!disposed) subscription.remove();
        disposed = true;
        retainedEvents.length = 0;
      },
    };
  } catch (error) {
    subscription.remove();
    throw error;
  }
}
