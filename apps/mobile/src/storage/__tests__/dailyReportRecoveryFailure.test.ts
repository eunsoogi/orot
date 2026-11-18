import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { dailyReportRecoveryFixture } from '../testSupport/dailyReportRecoveryFixture';
import { createDailyReportLocalRecovery } from '../dailyReportLocalRecovery';
import { failTransactionQuery } from '../../aiFeatures/integration/testSupport/dailyReportFailureStageFixtures';

test('malformed lineage and failed pending persistence never advertise recovery', async () => {
  const c = openSqliteTestDatabase(':memory:');
  try {
    const { candidate, witness } = await dailyReportRecoveryFixture(c.database);
    const signal = new AbortController().signal;
    const recovery = createDailyReportLocalRecovery(c.database);
    expect(
      await recovery.stage({ ...candidate, lineage: [] }, witness, signal),
    ).toEqual({ status: 'unavailable' });
    const failed = createDailyReportLocalRecovery(
      failTransactionQuery(
        c.database,
        q => q.startsWith('INSERT OR IGNORE INTO daily_report_pending VALUES'),
        'synthetic pending write failure',
      ),
    );
    expect(await failed.stage(candidate, witness, signal)).toEqual({
      status: 'unavailable',
    });
    expect(await recovery.resume(candidate.runId, witness, signal)).toEqual({
      status: 'unavailable',
    });
    expect(
      (await c.database.execute('SELECT run_id FROM daily_report_revisions'))
        .rows,
    ).toHaveLength(0);
  } finally {
    c.close();
  }
});

test('revocation during explicit resume cancels save and cannot restore a pending snapshot', async () => {
  const c = openSqliteTestDatabase(':memory:');
  try {
    const { candidate, witness } = await dailyReportRecoveryFixture(c.database);
    const recovery = createDailyReportLocalRecovery(c.database);
    const signal = new AbortController().signal;
    expect(await recovery.stage(candidate, witness, signal)).toEqual({
      status: 'staged',
    });
    let live = true;
    const revoked = {
      ...witness,
      isCurrent: () => live,
      subscribeInvalidation: (notify: () => void) => {
        live = false;
        notify();
        return () => {};
      },
    };
    expect(await recovery.resume(candidate.runId, revoked, signal)).toEqual({
      status: 'unavailable',
    });
    expect(await recovery.resume(candidate.runId, witness, signal)).toEqual({
      status: 'unavailable',
    });
    expect(
      (await c.database.execute('SELECT run_id FROM daily_report_revisions'))
        .rows,
    ).toHaveLength(0);
  } finally {
    c.close();
  }
});

test('changed expected head rejects staging rather than promising impossible recovery', async () => {
  const c = openSqliteTestDatabase(':memory:');
  try {
    const { candidate, witness } = await dailyReportRecoveryFixture(c.database);
    expect(
      await createDailyReportLocalRecovery(c.database).stage(
        {
          ...candidate,
          mode: { kind: 'revise', expectedRunId: 'missing-head' },
        },
        witness,
        new AbortController().signal,
      ),
    ).toEqual({ status: 'unavailable' });
  } finally {
    c.close();
  }
});

test('pending serialization never copies unknown raw fields from validated caller input', async () => {
  const c = openSqliteTestDatabase(':memory:');
  try {
    const { candidate, witness } = await dailyReportRecoveryFixture(c.database);
    const recovery = createDailyReportLocalRecovery(c.database);
    const signal = new AbortController().signal;
    const enriched = {
      ...candidate,
      rawProviderResponse: 'synthetic raw secret',
      lineage: candidate.lineage.map(row => ({
        ...row,
        rawRecord: 'synthetic raw secret',
      })),
    };
    expect(await recovery.stage(enriched, witness, signal)).toEqual({
      status: 'staged',
    });
    const stored = JSON.stringify(
      (
        await c.database.execute(
          'SELECT candidate_json FROM daily_report_pending',
        )
      ).rows,
    );
    expect(stored).not.toContain('synthetic raw secret');
    expect(stored).not.toContain('rawProviderResponse');
    expect(stored).not.toContain('rawRecord');
    const nested = {
      ...candidate,
      runId: 'nested',
      context: { ...candidate.context, rawSource: 'nested raw secret' },
      result: {
        ...candidate.result,
        report: { ...candidate.result.report, rawSamples: 'nested raw secret' },
      },
    };
    await recovery.stage(nested, witness, signal);
    expect(
      JSON.stringify(
        (
          await c.database.execute(
            'SELECT candidate_json FROM daily_report_pending',
          )
        ).rows,
      ),
    ).not.toContain('nested raw secret');
  } finally {
    c.close();
  }
});

test('transient final-save failure preserves the only candidate for a new explicit local retry', async () => {
  const c = openSqliteTestDatabase(':memory:');
  try {
    const { candidate, witness } = await dailyReportRecoveryFixture(c.database);
    let failSave = true;
    const database = failTransactionQuery(
      c.database,
      query => failSave && query.startsWith('INSERT INTO symptom_summary_runs'),
      'synthetic temporary save failure',
    );
    const recovery = createDailyReportLocalRecovery(database);
    const signal = new AbortController().signal;
    expect(await recovery.stage(candidate, witness, signal)).toEqual({
      status: 'staged',
    });
    expect(await recovery.resume(candidate.runId, witness, signal)).toEqual({
      status: 'retryable',
    });
    expect(
      (
        await c.database.execute(
          'SELECT candidate_json FROM daily_report_pending',
        )
      ).rows[0]?.candidate_json,
    ).toEqual(expect.any(String));
    failSave = false;
    expect(await recovery.resume(candidate.runId, witness, signal)).toEqual({
      status: 'saved',
    });
    expect(
      (await c.database.execute('SELECT run_id FROM daily_report_revisions'))
        .rows,
    ).toHaveLength(1);
  } finally {
    c.close();
  }
});

test('a different saved head supersedes pending recovery without replacing the newer report', async () => {
  const c = openSqliteTestDatabase(':memory:');
  try {
    const { candidate, witness } = await dailyReportRecoveryFixture(c.database);
    const recovery = createDailyReportLocalRecovery(c.database);
    const signal = new AbortController().signal;
    expect(await recovery.stage(candidate, witness, signal)).toEqual({
      status: 'staged',
    });
    const { createDailyReportStorage } =
      require('../dailyReportStorage') as typeof import('../dailyReportStorage');
    expect(
      await createDailyReportStorage(c.database).save({
        ...candidate,
        runId: 'other-completion',
      }),
    ).toEqual({ status: 'saved' });
    expect(await recovery.resume(candidate.runId, witness, signal)).toEqual({
      status: 'unavailable',
    });
    expect(
      (await c.database.execute('SELECT active_run_id FROM daily_report_heads'))
        .rows[0]?.active_run_id,
    ).toBe('other-completion');
  } finally {
    c.close();
  }
});
