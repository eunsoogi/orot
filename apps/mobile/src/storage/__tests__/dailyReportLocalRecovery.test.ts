import { InMemoryFakeLanguageModelProvider } from '@orot/model-runtime';
import { createRecordRepository } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { dailyReportRecoveryFixture } from '../testSupport/dailyReportRecoveryFixture';
import { createDailyReportLocalRecovery } from '../dailyReportLocalRecovery';

// Proposed API accepts only a local owner witness, never a provider or authorize callback.
test('explicit recovery saves a staged candidate once with no remote execution dependency', async () => {
  const provider = jest.spyOn(
    InMemoryFakeLanguageModelProvider.prototype,
    'generate',
  );
  const connection = openSqliteTestDatabase(':memory:');
  try {
    const { candidate, witness } = await dailyReportRecoveryFixture(
      connection.database,
    );
    const recovery = createDailyReportLocalRecovery(connection.database);
    const signal = new AbortController().signal;
    expect(await recovery.stage(candidate, witness, signal)).toEqual({
      status: 'staged',
    });
    expect(await recovery.resume(candidate.runId, witness, signal)).toEqual({
      status: 'saved',
    });
    expect(
      (
        await connection.database.execute(
          'SELECT run_id FROM daily_report_revisions',
        )
      ).rows,
    ).toHaveLength(1);
    expect(await recovery.resume(candidate.runId, witness, signal)).toEqual({
      status: 'unavailable',
    });
    expect(
      (
        await connection.database.execute(
          'SELECT run_id FROM daily_report_revisions',
        )
      ).rows,
    ).toHaveLength(1);
  } finally {
    expect(provider).not.toHaveBeenCalled();
    provider.mockRestore();
    connection.close();
  }
});

test('source deletion purges pending text and prevents local resume', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    const { candidate, witness } = await dailyReportRecoveryFixture(
      connection.database,
    );
    const recovery = createDailyReportLocalRecovery(connection.database);
    const signal = new AbortController().signal;
    expect(await recovery.stage(candidate, witness, signal)).toEqual({
      status: 'staged',
    });
    await createRecordRepository(connection.database).delete(
      'health_observation',
      candidate.lineage[0]!.localId,
    );
    expect(await recovery.resume(candidate.runId, witness, signal)).toEqual({
      status: 'unavailable',
    });
    const rows = await connection.database.execute(
      'SELECT candidate_json FROM daily_report_pending',
    );
    expect(JSON.stringify(rows.rows)).not.toContain('Synthetic report');
    expect(
      (
        await connection.database.execute(
          'SELECT run_id FROM daily_report_revisions',
        )
      ).rows,
    ).toHaveLength(0);
  } finally {
    connection.close();
  }
});
