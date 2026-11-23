import { AppState } from 'react-native';
import { createRecordRepository } from '@orot/storage';
import { createDailyReportIdentity } from '@orot/domain';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../../../ragConversation/conversationSessionRetention';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import type { ConversationExecutionEvent } from '../../../ragConversation/conversationExecutionLease';
import { entryIntentSender } from '../../../ragConversation/entryIntentSender';
import { setConversationEntryForSession } from '../../../ragConversation/useConversationEntryIntent';
import * as facts from '../dailyReportPreparedFacts';
import { dailyReportDeviceIdentity } from '../dailyReportFeature';
import {
  mockDailyDeviceZone,
  observeDailyDispatchSql,
} from '../testSupport/observeDailyDispatchSql';
import { createDailyReportService } from '../dailyReportService';
import { dailyReportConversationFailure } from '../dailyReportConversationFailure';
import {
  prepareReportDatabase,
  reportObservation,
  reportProvider,
  reportRequest,
  selectedReportProvider,
} from '../testSupport/dailyReportFailureStageFixtures';
let mockOwnerCurrent = true;
let mockProtected = true;
jest.mock('../../../agent/execution/dailyReportWarmSettingsOwner', () => ({
  readDailyReportWarmSettingsOwner: async () => ({
    isCurrent: () => mockOwnerCurrent,
    identity: 'synthetic-fixed-grant',
  }),
}));
jest.mock('../../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: () => ({
    bridgeAvailable: true,
    protectedDataAvailable: async () => mockProtected,
  }),
}));
test.each([
  'current',
  'deletion',
  'changed-selection',
  'lock',
  'Stop',
  'day-change',
  'zone-change',
  'held-zone',
  'held-lock',
  'silent-lock-after-sql',
  'held-Stop',
  'continued-background',
] as const)(
  'only original eligible Daily Continue can dispatch: %s',
  async boundary => {
    let movedDay = false;
    let checkedDispatchRow = false;
    let activeZone = 'UTC';
    const timezone = mockDailyDeviceZone(() => activeZone);
    mockOwnerCurrent = true;
    mockProtected = true;
    AppState.currentState = 'active';
    const db = openSqliteTestDatabase(':memory:');
    let receive!: (event: ConversationExecutionEvent) => void;
    let started!: () => void;
    const selecting = new Promise<void>(resolve => {
      started = resolve;
    });
    let ready!: () => void;
    const gate = new Promise<void>(resolve => {
      ready = resolve;
    });
    const realPrepare = facts.prepareDailyReportFacts;
    const prepared = jest
      .spyOn(facts, 'prepareDailyReportFacts')
      .mockImplementationOnce(async (...args) => {
        const exact = await realPrepare(...args);
        expect(exact.providerFacts.length).toBeGreaterThan(0);
        started();
        await gate;
        return exact;
      });
    const begin = jest.fn(async (_requestId: string) => true);
    const model = reportProvider();
    const generate = jest.spyOn(model, 'generate');
    const holdAuth =
      boundary.startsWith('held-') ||
      boundary === 'continued-background' ||
      boundary === 'silent-lock-after-sql';
    let seenAuth!: () => void, releaseAuth!: () => void;
    const authReached = new Promise<void>(resolve => {
      seenAuth = resolve;
    });
    const authGate = new Promise<void>(resolve => {
      releaseAuth = resolve;
    });
    const authorize = jest.fn(async () => {
      if (holdAuth) {
        seenAuth();
        await authGate;
      }
      return 'authorized' as const;
    });
    try {
      await prepareReportDatabase(db.database);
      const storage = createConversationArtifactStorage(db.database);
      let sequence = 0;
      const sessions = createConversationSessions({
        retention: createConversationSessionRetention({
          openStorage: async () => storage,
          createId: () => `synthetic-${++sequence}`,
          now: () => '2035-01-01T12:00:00.000Z',
        }),
        execution: {
          begin,
          end: () => {},
          isActive: async () => true,
          protectedDataAvailable: async () => true,
          subscribe: listener => {
            receive = listener;
            return () => {};
          },
        },
      });
      let authorized = false;
      const database = observeDailyDispatchSql(db.database, () => {
        if (boundary === 'silent-lock-after-sql' && authorized)
          [checkedDispatchRow, mockProtected] = [true, false];
      });
      const service = createDailyReportService({
        database,
        now: () => '2035-01-01T12:00:00Z',
        createRunId: () => 'synthetic-one',
        consent: { authorize },
        isWarmDayCurrent: admitted =>
          !movedDay &&
          dailyReportDeviceIdentity('2035-01-01T12:00:00Z')?.key ===
            admitted.key,
        async resolveSelected() {
          return selectedReportProvider(model, true);
        },
      });
      const identity = createDailyReportIdentity('2035-01-01', 'UTC');
      setConversationEntryForSession(sessions, 1, {
        intent: 'daily-report',
        entryKey: 'synthetic-daily',
        reportRequest: identity,
      });
      sessions.setDraft(1, '합성 일일보고서');
      const pending = sessions.send(
        1,
        entryIntentSender(
          sessions,
          1,
          async (_q, _h, signal, observer, entry) => {
            expect(entry?.reportRequest).toEqual(identity);
            const output = await service({
              ...reportRequest(signal),
              observer,
            });
            return output.status === 'failed'
              ? dailyReportConversationFailure(output.code)
              : { status: 'answer', answer: 'synthetic result', citations: [] };
          },
        ),
      );
      await Promise.race([
        selecting,
        pending.then(() => {
          throw Error('No prepared data boundary');
        }),
      ]);
      receive({ kind: 'pause-requested', requestId: begin.mock.calls[0]![0] });
      ready();
      for (
        let step = 0;
        step < 100 && !sessions.getSnapshot().sessions[0]?.continueWorkflow;
        step += 1
      )
        await new Promise(resolve => setTimeout(resolve, 5));
      expect(generate).not.toHaveBeenCalled();
      expect(authorize).not.toHaveBeenCalled();
      const cont = sessions.getSnapshot().sessions[0]?.continueWorkflow;
      expect(cont).toBeDefined();
      expect(
        (
          await db.database.execute(
            'SELECT phase FROM daily_report_warm_checkpoints',
          )
        ).rows,
      ).toEqual([{ phase: 'paused' }]);
      if (boundary === 'deletion')
        await createRecordRepository(db.database).delete(
          'health_observation',
          reportObservation.id,
        );
      if (boundary === 'changed-selection') mockOwnerCurrent = false;
      if (boundary === 'lock') mockProtected = false;
      if (boundary === 'Stop') sessions.cancel(1);
      if (boundary === 'day-change') movedDay = true;
      if (boundary === 'zone-change') activeZone = 'Europe/London';
      cont?.();
      cont?.();
      if (holdAuth) {
        await Promise.race([
          authReached,
          pending.then(() => {
            throw Error('Report never entered held authorization');
          }),
        ]);
        if (boundary === 'held-zone') activeZone = 'Europe/London';
        if (boundary === 'held-lock') mockProtected = false;
        if (boundary === 'held-Stop') sessions.cancel(1);
        if (boundary === 'continued-background')
          AppState.currentState = 'background';
        authorized = true;
        releaseAuth();
      }
      await pending;
      if (boundary === 'silent-lock-after-sql')
        expect(checkedDispatchRow).toBe(true);
      if (boundary === 'current' || boundary === 'continued-background') {
        expect(begin).toHaveBeenCalledTimes(2);
        expect(generate.mock.calls.length).toBeGreaterThan(0);
        expect(
          (
            await db.database.execute(
              'SELECT phase FROM daily_report_warm_checkpoints',
            )
          ).rows.some(row => row.phase === 'paused'),
        ).toBe(false);
      } else {
        expect(generate).not.toHaveBeenCalled();
        if (holdAuth) expect(authorize.mock.calls.length).toBeGreaterThan(0);
        else expect(authorize.mock.calls.length).toBe(0);
        expect(
          sessions.getSnapshot().sessions[0]?.continueWorkflow,
        ).toBeUndefined();
      }
    } finally {
      timezone.mockRestore();
      releaseAuth();
      prepared.mockRestore();
      ready();
      db.close();
    }
  },
);
