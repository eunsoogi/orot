import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportService } from '../dailyReportService';
import { selectDailyReportFacts } from '../dailyReportModel';
import { createDailyReportDeadlineContext } from '../dailyReportDeadline';
import {
  prepareReportDatabase,
  reportProvider,
  reportRequest,
  selectedReportProvider,
} from '../testSupport/dailyReportFailureStageFixtures';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => jest.useRealTimers());

test.each(['finish', 'cancel'] as const)(
  'default service keeps slow provider work live past 90 seconds and respects %s',
  async mode => {
    const connection = openSqliteTestDatabase(':memory:');
    const gate = deferred<void>();
    const started = deferred<void>();
    try {
      await prepareReportDatabase(connection.database);
      const provider = reportProvider();
      const generate = provider.generate.bind(provider);
      jest.spyOn(provider, 'generate').mockImplementation(async request => {
        started.resolve();
        await gate.promise;
        return generate(request);
      });
      const service = createDailyReportService({
        database: connection.database,
        now: () => '2035-01-01T12:00:00Z',
        createRunId: () => 'unbounded-report',
        resolveSelected: async () => selectedReportProvider(provider),
        consent: { authorize: async () => 'authorized' },
      });
      const controller = new AbortController();
      jest.useFakeTimers();
      let settled = false;
      const pending = service(reportRequest(controller.signal)).then(result => {
        settled = true;
        return result;
      });
      await started.promise;
      await jest.advanceTimersByTimeAsync(180_000);
      expect(settled).toBe(false);
      if (mode === 'cancel') controller.abort();
      gate.resolve();
      const outcome = await pending;
      if (mode === 'cancel')
        expect(outcome).toEqual({ status: 'failed', code: 'cancelled' });
      else expect(outcome.status).toBe('completed');
    } finally {
      gate.resolve();
      jest.useRealTimers();
      connection.close();
    }
  },
);

test('large model requests retain exact consent and source checks instead of a local byte ceiling', async () => {
  const provider = reportProvider();
  const selected = selectedReportProvider(provider, true);
  if (selected.status !== 'ready') throw new Error('fixture');
  const authorize = jest.fn(async () => 'authorized' as const);
  const revalidate = jest.fn(async () => true);
  const input = {
    selected,
    consent: { authorize },
    runId: 'large-report',
    facts: [{ text: 'x'.repeat(80_000), role: 'evidence' as const }],
    signal: new AbortController().signal,
    timeoutMs: null,
    deadlineContext: createDailyReportDeadlineContext(),
    revalidate,
  };
  expect((await selectDailyReportFacts(input)).status).toBe('selected');
  expect(authorize).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(authorize.mock.calls[0])).toContain('x'.repeat(80_000));
  expect(revalidate).toHaveBeenCalledTimes(1);
  revalidate.mockResolvedValue(false);
  expect(await selectDailyReportFacts(input)).toEqual({
    status: 'failed',
    code: 'source_revision_changed',
  });
});

test('default service keeps slow provider selection alive without a preparation deadline', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const gate = deferred<void>();
  const started = deferred<void>();
  try {
    await prepareReportDatabase(connection.database);
    const service = createDailyReportService({
      database: connection.database,
      now: () => '2035-01-01T12:00:00Z',
      createRunId: () => 'slow-selection',
      consent: { authorize: async () => 'authorized' },
      resolveSelected: async () => {
        started.resolve();
        await gate.promise;
        return selectedReportProvider(reportProvider());
      },
    });
    jest.useFakeTimers();
    let settled = false;
    const pending = service(reportRequest()).then(result => {
      settled = true;
      return result;
    });
    await started.promise;
    await jest.advanceTimersByTimeAsync(180_000);
    expect(settled).toBe(false);
    gate.resolve();
    expect((await pending).status).toBe('completed');
  } finally {
    gate.resolve();
    jest.useRealTimers();
    connection.close();
  }
});
