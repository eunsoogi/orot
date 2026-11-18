import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  mkdtempSync,
  rmSync,
  join,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { dailyReportRecoveryFixture } from '../testSupport/dailyReportRecoveryFixture';
import { createDailyReportLocalRecovery } from '../dailyReportLocalRecovery';

test('file restart exposes no execution and explicit resume preserves exactly one revision', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'daily-local-recovery-'));
  const file = join(directory, 'synthetic.sqlite');
  let c = openSqliteTestDatabase(file);
  try {
    const { candidate, witness } = await dailyReportRecoveryFixture(c.database);
    const signal = new AbortController().signal;
    expect(
      await createDailyReportLocalRecovery(c.database).stage(
        candidate,
        witness,
        signal,
      ),
    ).toEqual({ status: 'staged' });
    c.close();
    c = openSqliteTestDatabase(file);
    const recovery = createDailyReportLocalRecovery(c.database);
    expect(
      (await c.database.execute('SELECT run_id FROM daily_report_revisions'))
        .rows,
    ).toHaveLength(0);
    expect(await recovery.resume(candidate.runId, witness, signal)).toEqual({
      status: 'saved',
    });
    expect(await recovery.resume(candidate.runId, witness, signal)).toEqual({
      status: 'unavailable',
    });
    expect(
      (await c.database.execute('SELECT run_id FROM daily_report_revisions'))
        .rows,
    ).toHaveLength(1);
  } finally {
    c.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test.each(['cancel', 'authorization', 'date', 'model', 'generation'] as const)(
  'invalid %s identity cannot resurrect a staged candidate',
  async mode => {
    const c = openSqliteTestDatabase(':memory:');
    try {
      const { candidate, witness } = await dailyReportRecoveryFixture(
        c.database,
      );
      const recovery = createDailyReportLocalRecovery(c.database);
      const signal = new AbortController().signal;
      expect(await recovery.stage(candidate, witness, signal)).toEqual({
        status: 'staged',
      });
      if (mode === 'cancel') await recovery.cancel(candidate.runId);
      if (mode === 'generation')
        await c.database.execute(
          'UPDATE health_context_generation SET mutations = mutations + 1',
        );
      const changed = {
        ...witness,
        identity: { ...witness.identity },
        isCurrent: () => mode !== 'authorization',
      };
      if (mode === 'date') changed.identity.key = 'another-day';
      if (mode === 'model') changed.identity.modelId = 'another-model';
      expect(await recovery.resume(candidate.runId, changed, signal)).toEqual({
        status: 'unavailable',
      });
      expect(await recovery.stage(candidate, witness, signal)).toEqual({
        status: 'unavailable',
      });
      expect(
        (await c.database.execute('SELECT run_id FROM daily_report_revisions'))
          .rows,
      ).toHaveLength(0);
    } finally {
      c.close();
    }
  },
);
