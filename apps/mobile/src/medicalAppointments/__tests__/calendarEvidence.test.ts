import {
  createCalendarEvidenceBatch,
  readUpcomingCalendarCandidates,
} from '../calendarEvidence';
import type { CalendarBridge, CalendarEvent } from '../../calendar/types';

function event(
  identifier: string,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent {
  const base: CalendarEvent = {
    calendarEventIdentifier: identifier,
    effectiveAt: '2035-06-02T00:00:00.000Z',
    endsAt: '2035-06-02T01:00:00.000Z',
    calendarEventSnapshot: {
      title: '외래 진료',
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay: false,
      occurrenceDate: '2035-06-02T00:00:00.000Z',
      isDetached: false,
      recurrenceRules: [],
    },
  };
  return { ...base, ...overrides };
}

function bridge(findEvent: CalendarBridge['findEvent']): CalendarBridge {
  return {
    requestAccessAndListUpcomingEvents: jest.fn(),
    findEvent,
    addEventStoreListener: jest.fn(() => ({ remove: jest.fn() })),
  };
}

describe('Calendar evidence boundary', () => {
  it('preserves the upcoming-event query limit and unknown overflow state', async () => {
    const selected = event('private-calendar-id-1');
    const calendar: CalendarBridge = {
      requestAccessAndListUpcomingEvents: jest.fn(async () => ({
        access: 'fullAccess' as const,
        events: [selected],
      })),
      findEvent: jest.fn(),
      addEventStoreListener: jest.fn(() => ({ remove: jest.fn() })),
    };

    await expect(
      readUpcomingCalendarCandidates(calendar),
    ).resolves.toMatchObject({
      access: 'fullAccess',
      events: [selected],
      resultLimit: 100,
      horizonYears: 1,
      complete: false,
    });
  });

  it('does not return candidate events without full Calendar access', async () => {
    const calendar: CalendarBridge = {
      requestAccessAndListUpcomingEvents: jest.fn(async () => ({
        access: 'writeOnly' as const,
        events: [event('unreadable-event')],
      })),
      findEvent: jest.fn(),
      addEventStoreListener: jest.fn(() => ({ remove: jest.fn() })),
    };

    await expect(
      readUpcomingCalendarCandidates(calendar),
    ).resolves.toMatchObject({
      access: 'writeOnly',
      events: [],
      complete: false,
    });
  });

  it('keeps event identifiers local while exposing only title and time to the model', () => {
    const selected = event('private-calendar-id-1');
    const batch = createCalendarEvidenceBatch(
      bridge(jest.fn()),
      [selected],
      0,
      0,
      1,
    );

    expect(batch.evidence.items).toHaveLength(1);
    expect(batch.evidence.items[0]?.sourceId).toBe('ios-calendar');
    expect(JSON.stringify(batch.evidence.items[0]?.locator)).not.toContain(
      selected.calendarEventIdentifier,
    );
    expect(batch.evidence.items[0]?.content).toContain('외래 진료');
    expect(batch.evidence.items[0]?.content).not.toContain(
      selected.calendarEventIdentifier,
    );
    expect(batch.evidence.coverage[0]).toMatchObject({
      resultLimit: 1,
      returnedCount: 1,
      truncated: false,
    });
  });

  it('requires a current full-access match for the same occurrence and snapshot', async () => {
    const selected = event('event-occurrence-1');
    const findEvent = jest.fn(async () => ({
      access: 'fullAccess' as const,
      event: selected,
    }));
    const batch = createCalendarEvidenceBatch(
      bridge(findEvent),
      [selected],
      0,
      0,
      1,
    );

    await expect(
      batch.revalidateEvidence(
        batch.evidence.items,
        new AbortController().signal,
      ),
    ).resolves.toBe(true);
    expect(findEvent).toHaveBeenCalledWith(
      'event-occurrence-1',
      '2035-06-02T00:00:00.000Z',
      null,
    );
  });

  it.each([
    [
      'permission is no longer full',
      { access: 'writeOnly' as const, event: null },
    ],
    [
      'the occurrence disappeared',
      { access: 'fullAccess' as const, event: null },
    ],
    [
      'the snapshot changed',
      {
        access: 'fullAccess' as const,
        event: event('event-occurrence-1', {
          calendarEventSnapshot: {
            ...event('event-occurrence-1').calendarEventSnapshot,
            title: '다른 일정',
          },
        }),
      },
    ],
  ])('rejects a candidate when %s', async (_name, result) => {
    const selected = event('event-occurrence-1');
    const batch = createCalendarEvidenceBatch(
      bridge(jest.fn(async () => result)),
      [selected],
      0,
      0,
      1,
    );

    await expect(
      batch.revalidateEvidence(
        batch.evidence.items,
        new AbortController().signal,
      ),
    ).resolves.toBe(false);
  });

  it('refuses to build an oversized or malformed batch', () => {
    const selected = Array.from({ length: 9 }, (_, index) =>
      event(`event-${index + 1}`),
    );
    const calendar = bridge(jest.fn());

    expect(() =>
      createCalendarEvidenceBatch(calendar, selected, 0, 0, 2),
    ).toThrow(RangeError);
    expect(() =>
      createCalendarEvidenceBatch(calendar, [selected[0]!], 0, 1, 1),
    ).toThrow(RangeError);
  });
});
