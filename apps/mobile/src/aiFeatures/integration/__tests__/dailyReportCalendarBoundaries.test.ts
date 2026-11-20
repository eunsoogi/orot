import {
  createRecordRepository,
  runMigrations,
  type SqlDatabase,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  calendarFixture,
  calendarReportService,
  calendarTestObservation,
  calendarTestRequest,
} from '../testSupport/dailyReportCalendarTestFixture';

import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { createDailyReportCalendarWindow } from '../../../healthEvidence/healthContext/dailyReportWindow';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { createDailyReportDeadlineContext } from '../dailyReportDeadline';
import { generateDailyReportWithCalendar } from '../dailyReportGenerationRun';
import { prepareReportCalendar } from '../dailyReportSystemCalendar';
import {
  reportProvider,
  selectedReportProvider,
} from '../testSupport/dailyReportFailureStageFixtures';

test.each(['denied', 'scoped'] as const)(
  'calendar %s never widens authorization or means no plans',
  async mode => {
    const connection = openSqliteTestDatabase(':memory:');
    const native = calendarFixture();
    const read = jest.fn(native.read);
    try {
      await runMigrations(connection.database);
      await createRecordRepository(connection.database).put(
        'health_observation',
        calendarTestObservation,
      );
      if (mode === 'denied') native.revoke();
      const { run, consent } = calendarReportService(connection.database, {
        ...native,
        read,
      });
      const result = await run({
        ...calendarTestRequest(),
        scope: mode === 'scoped' ? { sourceIds: ['synthetic'] } : {},
      });
      if (result.status !== 'completed')
        throw new Error(JSON.stringify(result));
      expect(result.context.systemCalendar).toBeUndefined();
      expect(result.report.coverage).toContainEqual({
        source: 'system_calendar',
        status: 'unknown',
        limitationCodes: ['calendar_unavailable_or_scoped_out'],
      });
      expect(
        consent.mock.calls[0]?.[0].consentScope?.dataCategories,
      ).not.toContain('calendar_plans');
      if (mode === 'scoped') expect(read).not.toHaveBeenCalled();
      expect(native.listeners.size).toBe(0);
    } finally {
      connection.close();
    }
  },
);

test('native change during SQLite save cannot return or reopen completed prose', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const native = calendarFixture();
  const database: SqlDatabase = {
    execute: (sql, params) => connection.database.execute(sql, params),
    transaction: operation =>
      connection.database.transaction(tx =>
        operation({
          ...tx,
          execute: async (sql, params) => {
            const result = await tx.execute(sql, params);
            if (sql.startsWith('INSERT INTO daily_report_heads'))
              native.change();
            return result;
          },
        }),
      ),
  };
  try {
    await runMigrations(database);
    await createRecordRepository(database).put(
      'health_observation',
      calendarTestObservation,
    );
    const { run } = calendarReportService(database, native);
    expect(await run(calendarTestRequest())).toEqual({
      status: 'failed',
      code: 'source_unconfirmed_after_dispatch',
    });
    expect(
      (
        await database.execute(
          'SELECT id FROM conversation_invalid_summaries WHERE id = ?',
          ['calendar-report'],
        )
      ).rows,
    ).toHaveLength(1);
    expect(native.listeners.size).toBe(0);
  } finally {
    connection.close();
  }
});

test('a Stop racing calendar invalidation after saving still requests a fresh lookup', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const database = connection.database;
  const native = calendarFixture();
  const controller = new AbortController();
  const now = () => '2035-01-01T12:00:00Z';
  const calendar = createDailyReportCalendarWindow({
    localDate: '2035-01-01',
    timeZone: 'UTC',
    requestedAt: now(),
  });
  if (calendar.status !== 'ready') throw new Error('Expected calendar');
  let external: Awaited<ReturnType<typeof prepareReportCalendar>> | undefined;
  try {
    await runMigrations(database);
    await createRecordRepository(database).put(
      'health_observation',
      calendarTestObservation,
    );
    external = await prepareReportCalendar(
      calendar.context,
      native.read,
      controller.signal,
    );
    const storage = createDailyReportStorage(database, native.read);
    const lookup = jest.spyOn(storage, 'lookup');
    const model = reportProvider();
    const generate = jest.spyOn(model, 'generate');
    const result = await generateDailyReportWithCalendar(
      {
        data: createLocalEvidenceData(database),
        storage: {
          ...storage,
          async save(candidate, signal) {
            const saved = await storage.save(candidate, signal);
            expect(saved.status).toBe('saved');
            native.change();
            controller.abort();
            return saved;
          },
        },
        consent: { authorize: async () => 'authorized' },
        now,
        createRunId: () => 'post-save-stop',
        resolveSelected: async () => selectedReportProvider(model),
        deadlineContext: createDailyReportDeadlineContext(),
      },
      { ...calendarTestRequest(), signal: controller.signal },
      calendar,
      external,
    );
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: 'failed',
      code: 'source_unconfirmed_after_dispatch',
    });
    expect(lookup).toHaveBeenCalledWith(calendar.context.identity);
    expect(
      (
        await connection.database.execute(
          'SELECT id FROM conversation_invalid_summaries WHERE id = ?',
          ['post-save-stop'],
        )
      ).rows,
    ).toHaveLength(1);
  } finally {
    external?.snapshot.dispose();
    connection.close();
  }
});

test('cancelling a pending native read clears its listener and never calls the provider', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const native = calendarFixture();
  const controller = new AbortController();
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => {
    markStarted = resolve;
  });
  native.bridge.listEventsInRange = async () => {
    markStarted();
    return new Promise(() => {});
  };
  try {
    await runMigrations(connection.database);
    await createRecordRepository(connection.database).put(
      'health_observation',
      calendarTestObservation,
    );
    const { run, generate } = calendarReportService(
      connection.database,
      native,
    );
    const pending = run({
      ...calendarTestRequest(),
      signal: controller.signal,
    });
    await started;
    controller.abort();
    expect(await pending).toEqual({ status: 'failed', code: 'cancelled' });
    expect(native.listeners.size).toBe(0);
    expect(generate).not.toHaveBeenCalled();
  } finally {
    connection.close();
  }
});

test('reopening aborts a pending native lookup without invalidating an unchanged report', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const native = calendarFixture();
  const controller = new AbortController();
  let started!: () => void;
  const start = new Promise<void>(resolve => {
    started = resolve;
  });
  try {
    await runMigrations(connection.database);
    await createRecordRepository(connection.database).put(
      'health_observation',
      calendarTestObservation,
    );
    const result = await calendarReportService(connection.database, native).run(
      calendarTestRequest(),
    );
    if (result.status !== 'completed') throw new Error('fixture');
    const list = native.bridge.listEventsInRange;
    native.bridge.listEventsInRange = async () => {
      started();
      return new Promise(() => {});
    };
    const store = createDailyReportStorage(connection.database, native.read);
    const pending = store.lookup(result.context.identity, controller.signal);
    await start;
    controller.abort();
    expect(await pending).toEqual({ status: 'error' });
    expect(native.listeners.size).toBe(0);
    native.bridge.listEventsInRange = list;
    expect((await store.lookup(result.context.identity)).status).toBe('saved');
  } finally {
    connection.close();
  }
});
