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
  record,
  native,
  provider,
} from '../testSupport/incrementalCalendarFixtures';

test('SQLite restart reuses excluded and included recurring occurrences with zero model or consent; edited and new only are sent', async () => {
  const lane = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(lane.database);
    const records = createRecordRepository(lane.database);
    const appointment = () =>
      createAppointmentRepository(records, lane.database);
    const first = record(1);
    const excluded = {
      ...record(2),
      calendarEventIdentifier: first.calendarEventIdentifier,
      calendarEventSnapshot: {
        ...record(2).calendarEventSnapshot,
        occurrenceDate: record(2).effectiveAt,
      },
    };
    const original = [first, excluded, record(3)];
    const decide = provider();
    const representative = makeProvider(decide);
    const one = input(original, {
      bridge: native(original),
      provider: representative,
    });
    const completed = await classifyCalendarEventsIncrementally(
      one,
      appointment().classificationCache,
    );
    expect(completed.status).toBe('complete');
    expect(completed.candidates[1]?.classification).toBe('non_medical');
    expect(decide).toHaveBeenCalledTimes(1);
    const two = input(original, {
      bridge: native(original),
      provider: representative,
    });
    const repeated = await classifyCalendarEventsIncrementally(
      two,
      appointment().classificationCache,
    );
    expect(repeated).toMatchObject({ status: 'complete', totalBatches: 0 });
    expect(
      repeated.candidates.map(row => [
        row.classification,
        row.reusedClassification,
      ]),
    ).toEqual([
      ['medical', true],
      ['non_medical', true],
      ['non_medical', true],
    ]);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(two.consent.authorize).not.toHaveBeenCalled();

    const edited = {
      ...first,
      classificationWitness: { occurrence: key(1), revision: key(21) },
      calendarEventSnapshot: {
        ...first.calendarEventSnapshot,
        title: 'Changed synthetic event',
      },
    };
    const addition = {
      ...record(4),
      calendarEventSnapshot: {
        ...record(4).calendarEventSnapshot,
        title: 'New synthetic event',
      },
    };
    const selected = [excluded, edited, addition];
    const three = input(selected, {
      bridge: native(selected),
      provider: representative,
    });
    const mixed = await classifyCalendarEventsIncrementally(
      three,
      appointment().classificationCache,
    );
    expect(mixed.candidates.map(row => row.event)).toEqual(selected);
    expect(mixed.candidates.map(row => row.reusedClassification)).toEqual([
      true,
      undefined,
      undefined,
    ]);
    expect(decide).toHaveBeenCalledTimes(2);
    const sent = JSON.stringify(decide.mock.calls[1]?.[0]);
    expect(sent).toContain('Changed synthetic event');
    expect(sent).toContain('New synthetic event');
    expect(sent).not.toContain(excluded.calendarEventSnapshot.title);
    expect(sent).not.toContain('private-calendar-id');
    const cache = appointment().classificationCache!;
    const persisted = await cache.read(
      [key(1), key(2), key(3), key(4)],
      new AbortController().signal,
    );
    expect(persisted.rows.map(row => row.occurrence)).not.toContain(key(3));
    expect(JSON.stringify(persisted)).not.toContain('Changed synthetic event');
  } finally {
    lane.close();
  }
});

test('denial, stale native revision, or clear during a pending answer cannot reuse or revive evidence', async () => {
  const lane = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(lane.database);
    const records = createRecordRepository(lane.database);
    const cache = createAppointmentRepository(
      records,
      lane.database,
    ).classificationCache!;
    const rows = [record(1)];
    const decide = provider();
    const representative = makeProvider(decide);
    for (const bridge of [native(rows, false), native([record(1, 2)])]) {
      const attempt = await classifyCalendarEventsIncrementally(
        input(rows, { bridge, provider: representative }),
        cache,
      );
      expect(attempt.status).toBe('unavailable');
      expect(attempt.candidates[0]?.status).toBe('unclassified');
    }
    expect(decide).not.toHaveBeenCalled();
    const signal = new AbortController().signal;
    const before = await cache.read([key(1)], signal);
    await records.deleteAllLocalData();
    await expect(
      cache.commit(
        before.generation,
        [
          {
            occurrence: key(1),
            revision: key(1),
            classification: 'non_medical',
            uncertainty: 'low',
          },
        ],
        undefined,
        signal,
      ),
    ).rejects.toThrow('owner changed');
    expect((await cache.read([key(1)], signal)).rows).toEqual([]);
    const abort = new AbortController();
    abort.abort();
    expect(
      (
        await classifyCalendarEventsIncrementally(
          input(rows, {
            signal: abort.signal,
            bridge: native(rows),
            provider: representative,
          }),
          cache,
        )
      ).status,
    ).toBe('cancelled');
    expect(decide).not.toHaveBeenCalled();
  } finally {
    lane.close();
  }
});

test('a denied model run cannot publish cached results, and a verified empty calendar prunes all prior decisions', async () => {
  const lane = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(lane.database);
    const records = createRecordRepository(lane.database);
    const cache = createAppointmentRepository(
      records,
      lane.database,
    ).classificationCache!;
    const original = [record(1)];
    const decide = provider();
    const representative = makeProvider(decide);
    const originalResult = await classifyCalendarEventsIncrementally(
      input(original, {
        bridge: native(original),
        provider: representative,
      }),
      cache,
    );
    expect(originalResult.status).toBe('complete');
    const mixed = [...original, record(2)];
    const denied = await classifyCalendarEventsIncrementally(
      input(mixed, {
        bridge: native(mixed),
        provider: representative,
        consent: {
          authorize: jest.fn(async () => 'renewal_required' as const),
        },
      }),
      cache,
    );
    expect(denied.status).toBe('unavailable');
    expect(denied.candidates.every(row => row.status === 'unclassified')).toBe(
      true,
    );
    expect(decide).toHaveBeenCalledTimes(1);
    const signal = new AbortController().signal;
    expect(
      (await cache.read([key(1), key(2)], signal)).rows.map(
        row => row.occurrence,
      ),
    ).toEqual([key(1)]);
    const empty = await classifyCalendarEventsIncrementally(
      input([], {
        bridge: native([]),
        provider: representative,
      }),
      cache,
    );
    expect(empty.status).toBe('empty');
    expect((await cache.read([key(1), key(2)], signal)).rows).toEqual([]);
    expect(decide).toHaveBeenCalledTimes(1);
  } finally {
    lane.close();
  }
});
