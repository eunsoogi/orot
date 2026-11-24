import type { CalendarRangeEvent } from '../../calendar/types';
import {
  createAppointmentRepository,
  createRecordRepository,
  runMigrations,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { input, makeProvider } from '../classificationWorkflowTestFixtures';
import { classifyCalendarEventsIncrementally } from '../incrementalCalendarClassification';
import {
  key,
  native,
  provider,
  record,
} from '../testSupport/incrementalCalendarFixtures';

test('a wipe that commits during held consent prevents the actual model start without relying on UI abort', async () => {
  const lane = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(lane.database);
    const records = createRecordRepository(lane.database);
    const cache = createAppointmentRepository(
      records,
      lane.database,
    ).classificationCache!;
    const existing = [record(1)];
    const decide = provider();
    const model = makeProvider(decide);
    await classifyCalendarEventsIncrementally(
      input(existing, { bridge: native(existing), provider: model }),
      cache,
    );
    expect(decide).toHaveBeenCalledTimes(1);
    decide.mockClear();

    let consentEntered!: () => void;
    const entered = new Promise<void>(resolve => {
      consentEntered = resolve;
    });
    let resumeConsent!: () => void;
    const held = new Promise<void>(resolve => {
      resumeConsent = resolve;
    });
    const authorize = jest.fn(async () => {
      consentEntered();
      await held;
      return 'authorized' as const;
    });
    const mixed = [...existing, record(2)];
    const options = input(mixed, {
      bridge: native(mixed),
      provider: model,
      consent: { authorize },
    });
    const pending = classifyCalendarEventsIncrementally(options, cache);
    await entered;
    await records.deleteAllLocalData();
    resumeConsent();

    const retired = await pending;
    expect(retired.status).toBe('unavailable');
    expect(
      retired.candidates.every(item => item.status === 'unclassified'),
    ).toBe(true);
    expect(options.signal.aborted).toBe(false);
    expect(decide).not.toHaveBeenCalled();
    expect((await cache.read([key(1), key(2)], options.signal)).rows).toEqual(
      [],
    );

    const current = await classifyCalendarEventsIncrementally(
      input(mixed, { bridge: native(mixed), provider: model }),
      cache,
    );
    expect(current.status).toBe('complete');
    expect(decide).toHaveBeenCalledTimes(1);
  } finally {
    lane.close();
  }
});

test.each([
  'held-hit-read',
  'mixed-consent-edit',
  'mixed-consent-delete',
] as const)(
  '%s never publishes stale hits, prunes, or dispatches after Native changes',
  async race => {
    const lane = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(lane.database);
      const records = createRecordRepository(lane.database);
      const cache = createAppointmentRepository(
        records,
        lane.database,
      ).classificationCache!;
      const saved = record(1);
      const decide = provider();
      const model = makeProvider(decide);
      await classifyCalendarEventsIncrementally(
        input([saved], { bridge: native([saved]), provider: model }),
        cache,
      );
      decide.mockClear();
      const missing = record(2);
      const events = race === 'held-hit-read' ? [saved] : [saved, missing];
      const nativeEvents: CalendarRangeEvent[] = events.slice();
      let release!: () => void;
      const held = new Promise<void>(resolve => {
        release = resolve;
      });
      let pause!: () => void;
      const entered = new Promise<void>(resolve => {
        pause = resolve;
      });
      const read = async (...args: Parameters<typeof cache.read>) => {
        const result = await cache.read(...args);
        if (race === 'held-hit-read') {
          pause();
          await held;
        }
        return result;
      };
      const authorize = jest.fn(async () => {
        pause();
        await held;
        return 'authorized' as const;
      });
      const commit = jest.fn(cache.commit);
      const pending = classifyCalendarEventsIncrementally(
        input(events, {
          bridge: native(nativeEvents),
          provider: model,
          consent: { authorize },
        }),
        { ...cache, read, commit },
      );
      await entered;
      if (race === 'mixed-consent-delete') nativeEvents.shift();
      else nativeEvents[0] = { ...record(1, 100), calendarStatus: 'canceled' };
      release();
      const result = await pending;
      expect(result.status).toBe('unavailable');
      expect(
        result.candidates.every(item => item.status === 'unclassified'),
      ).toBe(true);
      expect(decide).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
      expect(
        (await cache.read([key(1)], new AbortController().signal)).rows,
      ).toHaveLength(1);
    } finally {
      lane.close();
    }
  },
);
