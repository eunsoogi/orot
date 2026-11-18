import { openOpSqliteFileQueue } from '../../../../test-support/dailyReportOpSqliteQueueFixture';
import { dailyReportRecoveryFixture } from '../../../storage/testSupport/dailyReportRecoveryFixture';
import { createDailyReportLocalRecovery } from '../../../storage/dailyReportLocalRecovery';

test('independent resume callers preserve one report revision on the installed transaction queue', async () => {
  const c = openOpSqliteFileQueue();
  try {
    const { candidate, witness } = await dailyReportRecoveryFixture(c.database);
    const first = createDailyReportLocalRecovery(c.database),
      second = createDailyReportLocalRecovery(c.database);
    const signal = new AbortController().signal;
    expect(await first.stage(candidate, witness, signal)).toEqual({
      status: 'staged',
    });
    const outcomes = await Promise.all([
      first.resume(candidate.runId, witness, signal),
      second.resume(candidate.runId, witness, signal),
    ]);
    expect(outcomes.filter(row => row.status === 'saved')).toHaveLength(1);
    expect(
      outcomes.every(row =>
        ['saved', 'reused', 'unavailable'].includes(row.status),
      ),
    ).toBe(true);
    expect(
      (await c.database.execute('SELECT run_id FROM daily_report_revisions'))
        .rows,
    ).toHaveLength(1);
  } finally {
    await c.close();
  }
});

test('abort while staging erases the committed pending payload rather than advertising recovery', async () => {
  const c = openOpSqliteFileQueue();
  try {
    const { candidate, witness } = await dailyReportRecoveryFixture(c.database);
    const controller = new AbortController();
    c.observeSubmit(query => {
      if (
        query.startsWith('INSERT OR IGNORE INTO daily_report_pending VALUES')
      ) {
        c.observeSubmit();
        controller.abort();
      }
    });
    const recovery = createDailyReportLocalRecovery(c.database);
    expect(await recovery.stage(candidate, witness, controller.signal)).toEqual(
      { status: 'unavailable' },
    );
    expect(
      await recovery.resume(
        candidate.runId,
        witness,
        new AbortController().signal,
      ),
    ).toEqual({ status: 'unavailable' });
    expect(
      JSON.stringify(
        (
          await c.database.execute(
            'SELECT candidate_json FROM daily_report_pending',
          )
        ).rows,
      ),
    ).not.toContain('Synthetic report');
  } finally {
    await c.close();
  }
});

test('cancellation before replacement commit preserves the existing report and removes pending prose', async () => {
  const c = openOpSqliteFileQueue();
  try {
    const { candidate, witness } = await dailyReportRecoveryFixture(c.database);
    const { createDailyReportStorage } =
      require('../../../storage/dailyReportStorage') as typeof import('../../../storage/dailyReportStorage');
    expect(await createDailyReportStorage(c.database).save(candidate)).toEqual({
      status: 'saved',
    });
    const replacement = {
      ...candidate,
      runId: 'replacement',
      mode: { kind: 'revise' as const, expectedRunId: candidate.runId },
    };
    const recovery = createDailyReportLocalRecovery(c.database);
    const controller = new AbortController();
    expect(
      await recovery.stage(replacement, witness, controller.signal),
    ).toEqual({ status: 'staged' });
    c.observeSubmit(query => {
      if (query.startsWith('INSERT INTO symptom_summary_runs')) {
        c.observeSubmit();
        controller.abort();
      }
    });
    expect(
      await recovery.resume(replacement.runId, witness, controller.signal),
    ).toEqual({ status: 'unavailable' });
    expect(
      (await c.database.execute('SELECT active_run_id FROM daily_report_heads'))
        .rows[0]?.active_run_id,
    ).toBe(candidate.runId);
    expect(
      (await c.database.execute('SELECT run_id FROM daily_report_revisions'))
        .rows,
    ).toHaveLength(1);
    expect(
      (
        await c.database.execute(
          'SELECT candidate_json FROM daily_report_pending WHERE run_id = ?',
          [replacement.runId],
        )
      ).rows[0]?.candidate_json,
    ).toBeNull();
  } finally {
    await c.close();
  }
});
