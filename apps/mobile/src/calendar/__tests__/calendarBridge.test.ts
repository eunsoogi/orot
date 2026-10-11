import { createCalendarBridge } from '../calendarBridge';
import type { EventKitCalendarBridge } from '../types';
import type { CalendarEvent } from '../types';

// The app's TS target is React Native; these narrow declarations describe Jest's host-only readback.
declare const __dirname: string;
const { readFileSync } = require('node:fs') as {
  readFileSync(path: string, encoding: 'utf8'): string;
};
const { join } = require('node:path') as { join(...parts: string[]): string };

test('native query has no row cap and both bridge reads preserve 137 events and coverage', async () => {
  const event: CalendarEvent = {
    calendarEventIdentifier: 'synthetic',
    effectiveAt: '2035-06-02T00:00:00.000Z',
    endsAt: '2035-06-02T01:00:00.000Z',
    calendarEventSnapshot: {
      title: 'Synthetic visit',
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay: false,
      occurrenceDate: null,
      isDetached: false,
      recurrenceRules: [],
    },
  };
  const result = {
    access: 'fullAccess' as const,
    events: Array.from({ length: 137 }, (_, index) => ({
      ...event,
      calendarEventIdentifier: `synthetic-${index}`,
    })),
    query: {
      fromInclusive: '2035-06-01T00:00:00.000Z',
      toExclusive: '2036-06-01T00:00:00.000Z',
      horizonYears: 1 as const,
      resultLimit: null,
      complete: true,
      omittedEventCount: 0,
    },
  };
  const nativeModule = {
    requestEventAccess: jest.fn(async () => 'fullAccess' as const),
    listUpcomingEvents: jest.fn(async () => result),
    requestAccessAndListUpcomingEvents: jest.fn(async () => result),
    findEvent: jest.fn(async () => ({
      access: 'fullAccess' as const,
      event: null,
    })),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
  const bridge = createCalendarBridge(nativeModule);
  expect(await bridge.listUpcomingEvents()).toEqual(result);
  expect(await bridge.requestAccessAndListUpcomingEvents()).toEqual(result);

  // This source guard complements bridge behavior; it does not prove EventKit permissions or live data.
  const native = readFileSync(
    join(__dirname, '../../../ios/OrotMobile/EventKitCalendarModule.swift'),
    'utf8',
  );
  const query = native.slice(
    native.indexOf('private func upcomingEvents'),
    native.indexOf('private func findEvent'),
  );
  expect(query).not.toMatch(/\.prefix\s*\(/);
  expect(query).toContain('value: 1, to: start');
  expect(query).toContain('"resultLimit": NSNull()');
});

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
