import { readCalendarRangeSnapshot } from '../calendarRangeSnapshot';
import type { CalendarRangeBridge, CalendarRangeEvents } from '../types';

const from = '2035-06-01T00:00:00.000Z';
const to = '2035-06-02T00:00:00.000Z';
function fixture() {
  let changed = () => {};
  const result: CalendarRangeEvents = {
    access: 'fullAccess',
    events: [
      {
        calendarEventIdentifier: 'synthetic-visit',
        effectiveAt: from,
        endsAt: to,
        calendarEventSnapshot: {
          title: 'Synthetic visit',
          timeZoneIdentifier: 'UTC',
          isAllDay: true,
          occurrenceDate: null,
          isDetached: false,
          recurrenceRules: [],
        },
      },
    ],
    query: {
      fromInclusive: from,
      toExclusive: to,
      resultLimit: null,
      complete: true,
      omittedEventCount: 0,
    },
  };
  const remove = jest.fn();
  const bridge: CalendarRangeBridge = {
    listEventsInRange: jest.fn(async () => result),
    addEventStoreListener(listener) {
      changed = listener;
      return { remove };
    },
  };
  return { result, bridge, remove, change: () => changed() };
}

test('reads bounded all-calendar snapshot without import or consent and rejects disposal', async () => {
  const f = fixture();
  const value = await readCalendarRangeSnapshot(f.bridge, from, to);
  expect(value.events[0].calendarEventSnapshot.isAllDay).toBe(true);
  expect(await value.revalidate()).toBe(true);
  value.dispose();
  value.dispose();
  expect(f.remove).toHaveBeenCalledTimes(1);
  expect(await value.revalidate()).toBe(false);
});

test.each(['denied', 'writeOnly', 'notDetermined'] as const)(
  'does not confuse %s with empty',
  async access => {
    const f = fixture();
    f.result.access = access;
    await expect(readCalendarRangeSnapshot(f.bridge, from, to)).rejects.toThrow(
      'coverage',
    );
    expect(f.remove).toHaveBeenCalledTimes(1);
  },
);

test('rejects incomplete coverage and invalid windows before a read', async () => {
  const f = fixture();
  f.result.query = { ...f.result.query!, complete: false };
  await expect(readCalendarRangeSnapshot(f.bridge, from, to)).rejects.toThrow(
    'coverage',
  );
  await expect(readCalendarRangeSnapshot(f.bridge, to, from)).rejects.toThrow(
    'window',
  );
  expect(f.bridge.listEventsInRange).toHaveBeenCalledTimes(1);
});

test.each(['delete', 'edit', 'permission', 'notify'] as const)(
  'fails freshness after %s',
  async action => {
    const f = fixture();
    const value = await readCalendarRangeSnapshot(f.bridge, from, to);
    if (action === 'delete') f.result.events = [];
    if (action === 'edit')
      f.result.events[0].calendarEventSnapshot.title = 'Changed';
    if (action === 'permission') f.result.access = 'denied';
    if (action === 'notify') f.change();
    expect(await value.revalidate()).toBe(false);
    value.dispose();
  },
);

test('rejects changes during query and ambiguous recurring occurrences', async () => {
  const f = fixture();
  f.bridge.listEventsInRange = jest.fn(async () => {
    f.change();
    return f.result;
  });
  await expect(readCalendarRangeSnapshot(f.bridge, from, to)).rejects.toThrow(
    'changed',
  );
  const g = fixture();
  g.result.events.push(g.result.events[0]);
  await expect(readCalendarRangeSnapshot(g.bridge, from, to)).rejects.toThrow(
    'ambiguous',
  );
});

// Permission restoration or source restoration must not resurrect a stale snapshot.
test.each(['permission', 'delete', 'edit'] as const)(
  'clears retained data and permanently rejects restoration after %s',
  async action => {
    const f = fixture();
    const original = JSON.parse(JSON.stringify(f.result));
    const snapshot = await readCalendarRangeSnapshot(f.bridge, from, to);
    if (action === 'permission') f.result.access = 'denied';
    if (action === 'delete') f.result.events = [];
    if (action === 'edit')
      f.result.events[0].calendarEventSnapshot.title = 'Changed';
    expect(await snapshot.revalidate()).toBe(false);
    expect(snapshot.events).toEqual([]);
    Object.assign(f.result, original);
    expect(await snapshot.revalidate()).toBe(false);
    expect(snapshot.events).toEqual([]);
    snapshot.dispose();
  },
);
