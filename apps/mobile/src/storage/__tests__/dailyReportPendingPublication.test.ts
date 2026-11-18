import { openOpSqliteFileQueue } from '../../../test-support/dailyReportOpSqliteQueueFixture';
import { dailyReportRecoveryFixture } from '../testSupport/dailyReportRecoveryFixture';
import { createDailyReportLocalRecovery } from '../dailyReportLocalRecovery';
import { readDailyReportPending } from '../dailyReportPendingRead';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  mkdtempSync,
  rmSync,
  join,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';

test('abort during publication commit exposes neither metadata nor direct resume on the shipping queue', async () => {
  const c = openOpSqliteFileQueue();
  try {
    const { candidate, witness } = await dailyReportRecoveryFixture(c.database);
    const recovery = createDailyReportLocalRecovery(c.database);
    const controller = new AbortController();
    let read: ReturnType<typeof readDailyReportPending> | undefined;
    c.observeSubmit(query => {
      if (
        !query.startsWith(
          'INSERT OR IGNORE INTO daily_report_pending_publication',
        )
      )
        return;
      c.observeSubmit();
      controller.abort();
      read = readDailyReportPending(c.database, witness.identity.key);
    });
    expect(await recovery.stage(candidate, witness, controller.signal)).toEqual(
      { status: 'unavailable' },
    );
    expect(read).toBeDefined();
    expect(await read).toEqual([]);
    expect(
      await recovery.resume(
        candidate.runId,
        witness,
        new AbortController().signal,
      ),
    ).toEqual({ status: 'unavailable' });
    expect(
      (
        await c.database.execute(
          'SELECT run_id FROM daily_report_pending_publication',
        )
      ).rows,
    ).toEqual([]);
  } finally {
    await c.close();
  }
});

test('unpublished legacy/private bytes survive file restart but cannot be discovered or resumed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'daily-unpublished-'));
  const file = join(directory, 'synthetic.sqlite');
  let c = openSqliteTestDatabase(file);
  try {
    const { candidate, witness } = await dailyReportRecoveryFixture(c.database);
    const recovery = createDailyReportLocalRecovery(c.database);
    const signal = new AbortController().signal;
    expect(await recovery.stage(candidate, witness, signal)).toEqual({
      status: 'staged',
    });
    // Models old foundation rows or interruption before the publication commit.
    await c.database.execute('DELETE FROM daily_report_pending_publication');
    const original = (
      await c.database.execute(
        'SELECT candidate_json FROM daily_report_pending',
      )
    ).rows;
    c.close();
    c = openSqliteTestDatabase(file);
    expect(
      await readDailyReportPending(c.database, witness.identity.key),
    ).toEqual([]);
    expect(
      await createDailyReportLocalRecovery(c.database).resume(
        candidate.runId,
        witness,
        signal,
      ),
    ).toEqual({ status: 'unavailable' });
    expect(
      (
        await c.database.execute(
          'SELECT candidate_json FROM daily_report_pending',
        )
      ).rows,
    ).toEqual(original);
    expect(
      (await c.database.execute('SELECT run_id FROM daily_report_revisions'))
        .rows,
    ).toEqual([]);
  } finally {
    c.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('publication commit cancellation completes its durable invalidation before another queued metadata read', async () => {
  const c = openOpSqliteFileQueue();
  try {
    const { candidate, witness } = await dailyReportRecoveryFixture(c.database);
    const recovery = createDailyReportLocalRecovery(c.database);
    const controller = new AbortController();
    let read: ReturnType<typeof readDailyReportPending> | undefined;
    let resume: ReturnType<typeof recovery.resume> | undefined;
    let commits = 0;
    const order: string[] = [];
    c.observeSubmit(query => {
      if (
        !query.startsWith(
          'INSERT OR IGNORE INTO daily_report_pending_publication',
        )
      )
        return;
      c.observeSubmit(sql => {
        if (sql.startsWith('INSERT INTO daily_report_pending VALUES'))
          order.push('tombstone');
        if (sql.startsWith('SELECT candidate_json FROM daily_report_pending'))
          order.push('metadata');
      });
      c.observeCommit(() => {
        c.observeCommit();
        commits += 1;
        order.push('committed');
        controller.abort();
        read = readDailyReportPending(c.database, witness.identity.key);
        resume = recovery.resume(
          candidate.runId,
          witness,
          new AbortController().signal,
        );
      });
    });
    expect(await recovery.stage(candidate, witness, controller.signal)).toEqual(
      { status: 'unavailable' },
    );
    expect(commits).toBe(1);
    expect(read).toBeDefined();
    expect(await read).toEqual([]);
    expect(await resume).toEqual({ status: 'unavailable' });
    expect(order[0]).toBe('committed');
    expect(order.indexOf('tombstone')).toBeGreaterThan(0);
    expect(order.indexOf('metadata')).toBeGreaterThan(
      order.indexOf('tombstone'),
    );
  } finally {
    await c.close();
  }
});
