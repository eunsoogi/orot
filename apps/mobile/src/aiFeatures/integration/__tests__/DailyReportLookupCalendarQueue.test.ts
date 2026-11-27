jest.mock('../../../agent/execution/consentFingerprint', () => ({
  fingerprintConsentSnapshot: async (input: string) =>
    require('node:crypto').createHash('sha256').update(input).digest('hex'),
}));
import { NativeModules } from 'react-native';
import { openOpSqliteFileQueue } from '../../../../test-support/opSqliteFileQueueFixture';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { calendarFixture } from '../testSupport/dailyReportCalendarTestFixture';
import {
  prepareReportDatabase,
  reportObservation,
  reportProvider,
  reportRequest,
  selectedReportProvider,
} from '../testSupport/dailyReportFailureStageFixtures';
import { createDailyReportService } from '../dailyReportService';

function gate() {
  let release!: () => void;
  const wait = new Promise<void>(resolve => {
    release = resolve;
  });
  return { wait, release };
}

async function nextQueueTurn() {
  await new Promise<void>(resolve =>
    require('node:timers').setImmediate(resolve),
  );
}

test.each([
  'current',
  'silent-change',
  'direct-delete-in-final',
  'deleted',
  'revised',
  'revoked',
  'cancelled',
] as const)(
  'saved Daily lookup releases the queue only for the first Calendar read: %s',
  async mode => {
    const f = openOpSqliteFileQueue();
    const calendar = calendarFixture();
    const model = reportProvider();
    const generate = jest.spyOn(model, 'generate');
    const startNative = gate();
    const releaseNative = gate();
    const startFinal = gate();
    const releaseFinal = gate();
    const native = calendar.bridge.listEventsInRange;
    let counts = 0;
    let holding = false;
    jest
      .spyOn(calendar.bridge, 'listEventsInRange')
      .mockImplementation(async (...args) => {
        if (holding) {
          counts++;
          if (counts === 1) {
            startNative.release();
            await releaseNative.wait;
          } else if (counts === 2) {
            startFinal.release();
            await releaseFinal.wait;
          }
        }
        const response = await native(...args);
        // This edit has no delivered listener event; the final native data read
        // itself, not listener timing, must prevent the old report from returning.
        return holding && counts === 2 && mode === 'silent-change'
          ? { ...response, events: [] }
          : response;
      });
    const original = NativeModules.OrotProviderDiagnostics;
    const report = jest.fn<void, [string, string, string]>();
    const signal = new AbortController();
    const run = createDailyReportService({
      database: f.database,
      now: () => '2035-01-01T12:00:00Z',
      createRunId: () => 'synthetic-calendar-lookup',
      consent: { authorize: async () => 'authorized' },
      resolveSelected: async () => selectedReportProvider(model),
      calendarReader: calendar.read,
    });
    let lookup:
      | ReturnType<ReturnType<typeof createDailyReportStorage>['lookup']>
      | undefined;
    let firstOther: Promise<void> | undefined;
    let secondOther: Promise<void> | undefined;
    try {
      await prepareReportDatabase(f.database);
      const originalRun = await run(reportRequest());
      if (originalRun.status !== 'completed')
        throw new Error('Missing saved fixture');
      expect(originalRun.context.systemCalendar).toBeDefined();
      holding = true;
      NativeModules.OrotProviderDiagnostics = { enabled: true, report };
      lookup = createDailyReportStorage(f.database, calendar.read).lookup(
        originalRun.context.identity,
        signal.signal,
      );
      const reached = (wait: Promise<void>) =>
        Promise.race([
          wait,
          lookup!.then(() => {
            throw new Error('Missing native gate');
          }),
        ]);
      await reached(startNative.wait);
      const firstAdmitted = jest.fn();
      firstOther = f.database.transaction(async tx => {
        const { rows } = await tx.execute(
          'SELECT COUNT(*) AS count FROM health_observations',
        );
        expect(rows[0]?.count).toBe(1);
        if (mode === 'deleted')
          await tx.execute('DELETE FROM health_observations WHERE id = ?', [
            reportObservation.id,
          ]);
        else if (mode === 'revised')
          await tx.execute(
            'UPDATE daily_report_heads SET revision = revision + 1',
          );
        firstAdmitted();
      });
      for (let i = 0; i < 8 && !firstAdmitted.mock.calls.length; i++)
        await nextQueueTurn();
      expect(firstAdmitted).toHaveBeenCalledTimes(1);
      await firstOther;
      if (mode === 'revoked') calendar.revoke();
      if (mode === 'cancelled') signal.abort();
      releaseNative.release();
      if (
        mode === 'current' ||
        mode === 'silent-change' ||
        mode === 'direct-delete-in-final'
      ) {
        await reached(startFinal.wait);
        const secondAdmitted = jest.fn();
        secondOther = f.database.transaction(async tx => {
          await tx.execute('SELECT 1 AS ready');
          secondAdmitted();
        });
        await nextQueueTurn();
        expect(secondAdmitted).not.toHaveBeenCalled();
        expect(
          report.mock.calls.filter(
            ([feature]) => feature === 'report_calendar_daily',
          ),
        ).toEqual([]);
        if (mode === 'direct-delete-in-final')
          await f.database.execute(
            'DELETE FROM health_observations WHERE id = ?',
            [reportObservation.id],
          );
        releaseFinal.release();
        const result = await lookup;
        if (mode === 'current') {
          expect(result).toMatchObject({
            status: 'saved',
            runId: originalRun.runId,
            report: originalRun.report,
          });
        } else if (mode === 'direct-delete-in-final')
          expect(result).toEqual({ status: 'deleted' });
        else expect(result).toMatchObject({ status: 'stale' });
        await secondOther;
        expect(secondAdmitted).toHaveBeenCalledTimes(1);
        expect(counts).toBe(2);
        const stages = report.mock.calls
          .filter(([feature]) => feature === 'report_calendar_daily')
          .map(([, stage]) => stage);
        expect(stages).toEqual(['admission', 'proof', 'other']);
      } else {
        const result = await lookup;
        expect(result.status).not.toBe('saved');
        expect(result).not.toHaveProperty('report');
        if (mode === 'deleted') expect(result).toEqual({ status: 'deleted' });
        if (mode === 'revoked')
          expect(result).toMatchObject({ status: 'stale' });
        if (mode === 'revised' || mode === 'cancelled')
          expect(result).toEqual({ status: 'error' });
        expect(counts).toBe(1);
      }
      expect(calendar.listeners.size).toBe(0);
      expect(generate).toHaveBeenCalledTimes(1);
    } finally {
      releaseNative.release();
      releaseFinal.release();
      await lookup;
      await firstOther;
      await secondOther;
      NativeModules.OrotProviderDiagnostics = original;
      await f.close();
    }
  },
);
