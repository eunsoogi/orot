import {
  createAppointmentRepository,
  createRecordRepository,
  runMigrations,
} from '@orot/storage';
import { providerSuccess } from '@orot/model-runtime';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { input, makeProvider } from '../classificationWorkflowTestFixtures';
import { classifyCalendarEventsIncrementally } from '../incrementalCalendarClassification';
import {
  key,
  native,
  provider,
  record,
} from '../testSupport/incrementalCalendarFixtures';

test('a locally invalid second batch does not reclassify eight independently completed unchanged occurrences', async () => {
  const lane = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(lane.database);
    const records = createRecordRepository(lane.database);
    const cache = createAppointmentRepository(
      records,
      lane.database,
    ).classificationCache!;
    const events = Array.from({ length: 9 }, (_, index) => record(index + 1));
    const decide = provider();
    decide.mockImplementationOnce(async req => {
      const good = provider();
      return good(req);
    });
    decide.mockResolvedValueOnce(
      providerSuccess({
        text: 'not valid JSON',
        toolCalls: [],
        finishReason: 'complete',
      }),
    );
    const options = input(events, {
      bridge: native(events),
      provider: makeProvider(decide),
    });
    const first = await classifyCalendarEventsIncrementally(options, cache);
    expect(first).toMatchObject({
      status: 'partial',
      failure: { status: 'invalid_output' },
      completedBatches: 1,
    });
    expect(
      (
        await cache.read(
          events.map((_, index) => key(index + 1)),
          options.signal,
        )
      ).rows,
    ).toHaveLength(8);
    decide.mockClear();
    const repeated = await classifyCalendarEventsIncrementally(options, cache);
    expect(
      repeated.candidates.filter(row => row.reusedClassification),
    ).toHaveLength(8);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(decide.mock.calls[0])).toContain(
      events[8]!.effectiveAt,
    );
    expect(JSON.stringify(decide.mock.calls[0])).not.toContain(
      events[0]!.effectiveAt,
    );
  } finally {
    lane.close();
  }
});

test.each(['consent', 'abort', 'stale'] as const)(
  'does not commit previous batches if %s retires the run',
  async reason => {
    const lane = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(lane.database);
      const records = createRecordRepository(lane.database);
      const cache = createAppointmentRepository(
        records,
        lane.database,
      ).classificationCache!;
      const events = Array.from({ length: 9 }, (_, index) => record(index + 1));
      const abort = new AbortController();
      const bridge = native(events);
      const decide = provider();
      const actual = provider();
      decide.mockImplementationOnce(async req => {
        if (reason === 'stale') {
          bridge.findEvent.mockImplementation(async (id, occurrence) => ({
            access: 'fullAccess' as const,
            event:
              id === events.at(-1)?.calendarEventIdentifier
                ? null
                : (events.find(
                    event =>
                      event.calendarEventIdentifier === id &&
                      event.calendarEventSnapshot.occurrenceDate === occurrence,
                  ) ?? null),
          }));
        }
        return actual(req);
      });
      const options = input(events, {
        bridge,
        signal: abort.signal,
        provider: makeProvider(decide),
        ...(reason === 'consent'
          ? {
              consent: {
                authorize: jest
                  .fn<Promise<'authorized' | 'renewal_required'>, []>()
                  .mockResolvedValueOnce('authorized')
                  .mockResolvedValue('renewal_required'),
              },
            }
          : {}),
        ...(reason === 'abort'
          ? {
              onProgress: progress => {
                if (progress.completedBatches === 1) abort.abort();
              },
            }
          : {}),
      });
      const result = await classifyCalendarEventsIncrementally(options, cache);
      expect(result.status).not.toBe('complete');
      expect(
        (
          await cache.read(
            events.map((_, index) => key(index + 1)),
            new AbortController().signal,
          )
        ).rows,
      ).toHaveLength(0);
      expect(decide).toHaveBeenCalledTimes(1);
    } finally {
      lane.close();
    }
  },
);

test.each(['edit', 'delete', 'wipe'] as const)(
  'does not publish an admitted partial result retired during cache commit: %s',
  async change => {
    const lane = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(lane.database);
      const records = createRecordRepository(lane.database);
      const cache = createAppointmentRepository(
        records,
        lane.database,
      ).classificationCache!;
      const events = Array.from({ length: 9 }, (_, index) => record(index + 1));
      const current = events.slice();
      const decide = provider();
      const good = provider();
      decide
        .mockImplementationOnce(good)
        .mockResolvedValueOnce(
          providerSuccess({
            text: 'invalid second batch',
            toolCalls: [],
            finishReason: 'complete',
          }),
        );
      const options = input(events, {
        bridge: native(current),
        provider: makeProvider(decide),
      });
      let release!: () => void;
      let committed!: () => void;
      const held = new Promise<void>(resolve => {
        release = resolve;
      });
      const reached = new Promise<void>(resolve => {
        committed = resolve;
      });
      const pending = classifyCalendarEventsIncrementally(options, {
        ...cache,
        async commit(...args) {
          await cache.commit(...args);
          committed();
          await held;
        },
      });
      await reached;
      try {
        if (change === 'edit') current[0] = record(1, 100);
        else if (change === 'delete') current.shift();
        else await records.deleteAllLocalData();
      } finally {
        release();
      }
      const result = await pending;
      expect(result.status).toBe('unavailable');
      expect(
        result.candidates.every(row => row.status === 'unclassified'),
      ).toBe(true);
      expect(decide).toHaveBeenCalledTimes(2);
      const stored = await cache.read([key(1)], options.signal);
      if (change === 'wipe') expect(stored.rows).toHaveLength(0);
      else
        expect(stored.rows).toEqual([
          expect.objectContaining({ revision: key(1) }),
        ]);
    } finally {
      lane.close();
    }
  },
);
