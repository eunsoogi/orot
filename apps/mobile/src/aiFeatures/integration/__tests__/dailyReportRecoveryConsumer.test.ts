import { createDailyReportRequests } from '../dailyReportRequests';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { fixture } from '../../../agent/execution/testSupport/dailyRecoveryOwnerFixture';
import { InMemoryFakeLanguageModelProvider } from '@orot/model-runtime';
import { createRecordRepository } from '@orot/storage';
import { createDailyReportService } from '../dailyReportService';
import { createDailyReportRecoveryActions } from '../dailyReportRecoveryActions';
import {
  failTransactionQuery,
  reportRequest,
  selectedReportProvider,
} from '../testSupport/dailyReportFailureStageFixtures';

/** Real producer and SQLite save failure, not a fabricated pending or permission. */
test.each([
  'save',
  'delete',
  'cancel',
  'revoke',
  'day changed',
  'pending storage failure',
  'request owner released',
] as const)(
  'validated generation failure then explicit local recovery: %s, with no second provider/authorize call',
  async action => {
    const f = await fixture();
    const model = new InMemoryFakeLanguageModelProvider({
      id: 'openai-api-decisions',
      capabilities: { streaming: false },
      response: {
        text: '{"indexes":[0]}',
        toolCalls: [],
        finishReason: 'complete',
      },
    });
    const generate = jest.spyOn(model, 'generate');
    const authorize = jest.fn(async () => 'authorized' as const);
    let fail = true;
    let releaseOwner = () => {};
    const db = failTransactionQuery(
      f.db.database,
      query => {
        if (
          action === 'request owner released' &&
          query.startsWith('INSERT OR IGNORE INTO daily_report_pending VALUES')
        )
          releaseOwner();
        if (
          action === 'pending storage failure' &&
          query.startsWith('INSERT OR IGNORE INTO daily_report_pending VALUES')
        )
          return true;
        if (fail && query.startsWith('INSERT INTO symptom_summary_runs')) {
          fail = false;
          return true;
        }
        return false;
      },
      'synthetic disk error',
    );
    let identity = f.candidate.context.identity;
    const actions = createDailyReportRecoveryActions({
      database: async () => db,
      currentIdentity: () => identity,
    });
    try {
      const run = createDailyReportService({
        database: db,
        consent: { authorize },
        now: () => '2035-01-01T12:00:00Z',
        createRunId: () => 'actual-producer-run',
        resolveSelected: async () => ({
          ...selectedReportProvider(model, true),
          modelId: 'synthetic-model',
          recipient: 'OpenAI API',
        }),
      });
      const requests = createDailyReportRequests({
        lookup: createDailyReportStorage(db).lookup,
        currentIdentity: () => identity,
        run: (_identity, _mode, signal) => run(reportRequest(signal)),
      });
      releaseOwner = requests.retain(identity);
      const operation = requests.start(identity, { kind: 'reuse_or_generate' });
      if (operation.status !== 'started')
        throw new Error('Synthetic request did not start');
      expect(await operation.result).toEqual({
        status: 'failed',
        code:
          action === 'request owner released'
            ? 'cancelled'
            : 'persistence_failed',
      });
      expect(generate).toHaveBeenCalledTimes(1);
      const authorized = authorize.mock.calls.length;
      const controller = new AbortController();
      const targets = await actions.pendingRecovery(
        identity,
        controller.signal,
      );
      if (
        action === 'pending storage failure' ||
        action === 'request owner released'
      ) {
        expect(targets).toEqual([]);
        expect(generate).toHaveBeenCalledTimes(1);
        expect(authorize).toHaveBeenCalledTimes(authorized);
        return;
      }
      expect(targets).toHaveLength(1);
      expect(JSON.stringify(targets)).not.toContain('observations');
      if (action === 'delete')
        await createRecordRepository(db).delete(
          'health_observation',
          f.candidate.lineage[0]!.localId,
        );
      if (action === 'cancel') controller.abort();
      if (action === 'revoke') await f.authority.suspend();
      if (action === 'day changed') identity = { ...identity, key: 'new-day' };
      const result = await actions.resumeRecovery(
        f.candidate.context.identity,
        targets[0]!,
        controller.signal,
      );
      expect(result.status).toBe(action === 'save' ? 'saved' : 'unavailable');
      expect(generate).toHaveBeenCalledTimes(1);
      expect(authorize).toHaveBeenCalledTimes(authorized);
      const rows = await db.execute(
        'SELECT run_id FROM daily_report_revisions',
      );
      expect(rows.rows).toHaveLength(action === 'save' ? 1 : 0);
    } finally {
      f.db.close();
    }
  },
);
