jest.mock('../../../calendar/calendarBridge', () => ({
  createCalendarBridge: jest.fn(),
}));
import { createCalendarBridge } from '../../../calendar/calendarBridge';
import { NativeModules } from 'react-native';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
jest.mock('../../../agent/execution/consentFingerprint', () => ({
  fingerprintConsentSnapshot: async (input: string) =>
    require('node:crypto').createHash('sha256').update(input).digest('hex'),
}));
import { openOpSqliteFileQueue } from '../../../../test-support/opSqliteFileQueueFixture';
import { createDailyReportService } from '../dailyReportService';
import { calendarFixture } from '../testSupport/dailyReportCalendarTestFixture';
import {
  prepareReportDatabase,
  reportProvider,
  reportRequest,
  selectedReportProvider,
} from '../testSupport/dailyReportFailureStageFixtures';

function gate() {
  let release!: () => void;
  const wait = new Promise<void>(resolve => {
    release = resolve;
  });
  return { wait, release };
}

test.each([
  ['daily-reuse', true],
  ['ordinary-linked-reply', true],
  ['daily-reuse', false],
  ['ordinary-linked-reply', false],
] as const)(
  'the stock %s path brackets one Calendar proof without logging by default (%s)',
  async (mode, enabled) => {
    const f = openOpSqliteFileQueue();
    const entered = gate();
    const held = gate();
    const blockAdmission = gate();
    const enteredBlocker = gate();
    const submitted = gate();
    const enteredSql = gate();
    const heldSql = gate();
    const calendar = calendarFixture();
    let block = false;
    const provider = reportProvider();
    const generate = jest.spyOn(provider, 'generate');
    const run = createDailyReportService({
      database: f.database,
      now: () => '2035-01-01T12:00:00Z',
      createRunId: () => 'synthetic-calendar-queue',
      consent: { authorize: async () => 'authorized' },
      resolveSelected: async () => selectedReportProvider(provider),
      calendarReader: async (...args) => {
        if (block) {
          entered.release();
          await held.wait;
        }
        return calendar.read(...args);
      },
    });
    let pending: Promise<unknown> | undefined;
    let blocker: Promise<void> | undefined;
    let mockedTransaction: jest.SpyInstance | undefined;
    let clock: jest.SpyInstance<number, []> | undefined;
    const originalDiagnostics = NativeModules.OrotProviderDiagnostics;
    const report = jest.fn<void, [string, string, string]>();
    const observed = () =>
      report.mock.calls.filter(([feature]) =>
        feature.startsWith('report_calendar_'),
      );
    let other: Promise<void> | undefined;
    try {
      await prepareReportDatabase(f.database);
      const first = await run(reportRequest());
      if (first.status !== 'completed') throw new Error(JSON.stringify(first));
      expect(generate).toHaveBeenCalledTimes(1);
      expect(first.context.systemCalendar).toBeDefined();
      const conversations = createConversationArtifactStorage(f.database);
      await conversations.createSession(
        'synthetic-session',
        await conversations.currentGeneration(),
      );
      const originalNativeRead = calendar.bridge.listEventsInRange;
      jest.mocked(createCalendarBridge).mockReturnValue({
        ...calendar.bridge,
        requestAccessAndListUpcomingEvents: async () => {
          throw new Error('Unexpected calendar access prompt');
        },
        findEvent: async () => {
          throw new Error('Unexpected single-event lookup');
        },
        listEventsInRange: async (...args) => {
          if (block) {
            entered.release();
            await held.wait;
          }
          return originalNativeRead(...args);
        },
      });
      blocker = f.database.transaction(async () => {
        enteredBlocker.release();
        await blockAdmission.wait;
      });
      await enteredBlocker.wait;
      let ticks = 0;
      clock = jest.spyOn(performance, 'now').mockImplementation(() => ticks);
      NativeModules.OrotProviderDiagnostics = enabled
        ? { enabled: true, report }
        : { report };
      const transaction = f.database.transaction.bind(f.database);
      mockedTransaction = jest
        .spyOn(f.database, 'transaction')
        .mockImplementationOnce(work => {
          submitted.release();
          return transaction(work);
        });
      const firstQuery =
        mode === 'daily-reuse'
          ? 'SELECT active_run_id, revision, deleted FROM daily_report_heads'
          : 'SELECT id FROM conversation_deleted_artifacts';
      f.delayWorker(async query => {
        if (query.startsWith(firstQuery)) {
          enteredSql.release();
          await heldSql.wait;
        }
      });
      const count = f.events.filter(e => e.event === 'COMMIT;').length;
      block = true;
      const active =
        mode === 'daily-reuse'
          ? run(reportRequest()).then(result => {
              if (result.status !== 'reused')
                throw new Error(JSON.stringify(result));
              expect(result.report).toEqual(first.report);
            })
          : conversations.append({
              id: 'synthetic-reply',
              sessionId: 'synthetic-session',
              createdAt: '2035-01-01T12:01:00.000Z',
              providerId: 'synthetic-provider',
              modelId: 'synthetic-model',
              question: 'Synthetic follow-up',
              answer: 'Synthetic reply',
              status: 'complete',
              sources: [],
              citations: [],
              dailyReport: {
                identity: first.context.identity,
                runId: first.runId,
                revision: 1,
              },
            });
      pending = active;
      const awaitGate = (wait: Promise<void>) =>
        Promise.race([
          wait,
          active.then(() => {
            throw new Error('Missing diagnostic boundary');
          }),
        ]);
      await awaitGate(submitted.wait);
      ticks += 40;
      blockAdmission.release();
      await awaitGate(enteredSql.wait);
      ticks += 20;
      heldSql.release();
      await Promise.race([
        entered.wait,
        active.then(() => {
          throw new Error('No native Calendar check');
        }),
      ]);
      expect(f.events.filter(e => e.event === 'COMMIT;')).toHaveLength(
        count + 1,
      );
      const admitted = jest.fn();
      other = f.database.transaction(async tx => {
        admitted();
        expect(
          (
            await tx.execute(
              'SELECT COUNT(*) AS count FROM health_observations',
            )
          ).rows[0]?.count,
        ).toBe(1);
      });
      // The shipping transaction scheduler promotes work on setImmediate.
      await new Promise<void>(resolve =>
        require('node:timers').setImmediate(resolve),
      );
      expect(admitted).not.toHaveBeenCalled();
      expect(observed()).toEqual([]);
      ticks += 80;
      held.release();
      await active;
      const feature =
        mode === 'daily-reuse'
          ? 'report_calendar_daily'
          : 'report_calendar_conversation';
      expect(observed()).toEqual(
        enabled
          ? [
              [feature, 'admission', '40'],
              [feature, 'proof', '80'],
              [feature, 'other', '20'],
            ]
          : [],
      );
      if (mode === 'ordinary-linked-reply')
        expect(
          (await f.database.execute('SELECT id FROM conversation_artifacts'))
            .rows,
        ).toEqual([{ id: 'synthetic-reply' }]);
      expect(generate).toHaveBeenCalledTimes(1);
      expect(first.context.systemCalendar).toBeDefined();
      await other;
      expect(admitted).toHaveBeenCalledTimes(1);
    } finally {
      blockAdmission.release();
      heldSql.release();
      held.release();
      await blocker;
      NativeModules.OrotProviderDiagnostics = originalDiagnostics;
      mockedTransaction?.mockRestore();
      clock?.mockRestore();
      await pending;
      await other;
      await f.close();
      jest.mocked(createCalendarBridge).mockReset();
    }
  },
);
