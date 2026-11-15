import { CalendarAppointmentSnapshotSchema } from '@orot/domain';
import type { CalendarRangeEvent, CalendarRangeBridge } from './types';

export interface CalendarRangeSnapshot {
  readonly fromInclusive: string;
  readonly toExclusive: string;
  readonly events: readonly CalendarRangeEvent[];
  /** Local freshness check only. A successful check does not grant provider consent. */
  revalidate(signal?: AbortSignal): Promise<boolean>;
  /** Synchronous lease check for the final boundary after asynchronous persistence. */
  isCurrent(): boolean;
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

/** Stop waiting locally; the native read may finish later, but its result is discarded. */
function readWithAbort<T>(
  read: () => Promise<T>,
  signal?: AbortSignal,
  lifetime?: AbortSignal,
): Promise<T> {
  const signals = [
    ...new Set(
      [signal, lifetime].filter((value): value is AbortSignal => !!value),
    ),
  ];
  return new Promise<T>((resolve, reject) => {
    const cleanup = () =>
      signals.forEach(value => value.removeEventListener('abort', abort));
    const abort = () => {
      cleanup();
      reject(new Error('calendar_read_aborted'));
    };
    signals.forEach(value =>
      value.addEventListener('abort', abort, { once: true }),
    );
    if (signals.some(value => value.aborted)) {
      abort();
      return;
    }
    Promise.resolve()
      .then(() => {
        if (signals.some(value => value.aborted))
          throw new Error('calendar_read_aborted');
        return read();
      })
      .then(
        value => {
          cleanup();
          resolve(value);
        },
        error => {
          cleanup();
          reject(error);
        },
      );
  });
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
  signal?: AbortSignal,
): Promise<CalendarRangeSnapshot> {
  if (signal?.aborted) throw new Error('calendar_read_aborted');
  const start = Date.parse(fromInclusive);
  const end = Date.parse(toExclusive);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > 32 * 86400_000
  )
    throw new Error('invalid_calendar_window');
  const lifetime = new AbortController();
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
  const dispose = () => {
    lifetime.abort();
    invalidate();
    if (!disposed) subscription.remove();
    disposed = true;
    signal?.removeEventListener('abort', dispose);
  };
  signal?.addEventListener('abort', dispose, { once: true });
  if (signal?.aborted) dispose();
  const read = async (readSignal = signal) => {
    const result = await readWithAbort(
      () => bridge.listEventsInRange(fromInclusive, toExclusive),
      readSignal,
      lifetime.signal,
    );
    if (disposed || readSignal?.aborted)
      throw new Error('calendar_read_aborted');
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
    const isCurrent = () => {
      if (!invalidated && !disposed && canonical(events) === original)
        return true;
      return invalidate();
    };
    return {
      fromInclusive,
      toExclusive,
      events,
      isCurrent,
      async revalidate(revalidationSignal = signal) {
        if (!isCurrent()) return invalidate();
        const abortRevalidation = () => dispose();
        revalidationSignal?.addEventListener('abort', abortRevalidation, {
          once: true,
        });
        if (revalidationSignal?.aborted) dispose();
        try {
          const current = await read(revalidationSignal);
          if (invalidated || disposed || canonical(current) !== original)
            return invalidate();
          return true;
        } catch {
          return invalidate();
        } finally {
          revalidationSignal?.removeEventListener('abort', abortRevalidation);
        }
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
