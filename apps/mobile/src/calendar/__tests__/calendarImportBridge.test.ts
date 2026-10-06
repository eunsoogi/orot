import { createCalendarImportBridge } from '../calendarBridge';

test('exposes one request-only call and a separate query-only call', async () => {
  const calls: string[] = [];
  const bridge = createCalendarImportBridge({
    async requestAccessIfNeeded() {
      calls.push('request');
      return 'fullAccess';
    },
    async listUpcomingEvents() {
      calls.push('query');
      return { access: 'fullAccess', events: [] };
    },
  });

  await expect(bridge.requestAccessIfNeeded()).resolves.toBe('fullAccess');
  await expect(bridge.listUpcomingEvents()).resolves.toEqual({
    access: 'fullAccess',
    events: [],
  });
  expect(calls).toEqual(['request', 'query']);
});

test('does not fall back to a permission-and-query call when the native bridge is missing', async () => {
  const bridge = createCalendarImportBridge(undefined);

  await expect(bridge.requestAccessIfNeeded()).rejects.toThrow(
    'EventKit calendar access is unavailable.',
  );
  await expect(bridge.listUpcomingEvents()).rejects.toThrow(
    'EventKit calendar access is unavailable.',
  );
});
