import { createRecordRepository } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { dailyReportRecoveryFixture } from '../testSupport/dailyReportRecoveryFixture';
import { createDailyReportLocalRecovery } from '../dailyReportLocalRecovery';
import { reportObservation } from '../../aiFeatures/integration/testSupport/dailyReportFailureStageFixtures';

test.each([
  'correction',
  'logical removal',
  'indirect transcript correction',
] as const)('invalidates pending output after %s', async mode => {
  const c = openSqliteTestDatabase(':memory:');
  try {
    const { candidate, witness } = await dailyReportRecoveryFixture(c.database);
    const recovery = createDailyReportLocalRecovery(c.database);
    const signal = new AbortController().signal;
    expect(await recovery.stage(candidate, witness, signal)).toEqual({
      status: 'staged',
    });
    if (mode === 'correction')
      await createRecordRepository(c.database).put('health_observation', {
        ...reportObservation,
        value: { kind: 'quantity', amount: 74, unit: 'count/min' },
      });
    if (mode === 'logical removal')
      await c.database.execute(
        'INSERT INTO source_deletion_tombstones(source_id) VALUES (?)',
        [reportObservation.id],
      );
    if (mode === 'indirect transcript correction')
      await c.database.execute(
        'INSERT INTO transcript_artifact_staleness VALUES (?, ?, ?, ?, ?, ?)',
        [
          'synthetic-transcript',
          'health_observation',
          reportObservation.id,
          'old-segment',
          'new-segment',
          '2035-01-01T12:02:00Z',
        ],
      );
    expect(
      JSON.stringify(
        (
          await c.database.execute(
            'SELECT candidate_json FROM daily_report_pending',
          )
        ).rows,
      ),
    ).not.toContain('Synthetic report');
    expect(await recovery.resume(candidate.runId, witness, signal)).toEqual({
      status: 'unavailable',
    });
    expect(await recovery.stage(candidate, witness, signal)).toEqual({
      status: 'unavailable',
    });
  } finally {
    c.close();
  }
});

test('derived memory lineage is unsupported rather than accepted without its parent authority', async () => {
  const c = openSqliteTestDatabase(':memory:');
  try {
    const { candidate, witness } = await dailyReportRecoveryFixture(c.database);
    expect(
      await createDailyReportLocalRecovery(c.database).stage(
        {
          ...candidate,
          lineage: candidate.lineage.map(row => ({
            ...row,
            kind: 'reviewed_memory',
          })),
        },
        witness,
        new AbortController().signal,
      ),
    ).toEqual({ status: 'unavailable' });
  } finally {
    c.close();
  }
});
