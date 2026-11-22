import { NativeModules } from 'react-native';
import { openOpSqliteFileQueue } from '../../../test-support/opSqliteFileQueueFixture';
import { gate } from '../../routes/overview/testSupport/overviewReadOnlySnapshotFixture';
import { observeToolEventTransaction } from '../toolEventWriteDiagnostic';

test('records distinct queue, callback and settlement phases around a real held file SQLite transaction', async () => {
  const f = openOpSqliteFileQueue();
  const holder = gate();
  const releaseHolder = gate();
  const body = gate();
  const releaseBody = gate();
  const report = jest.fn();
  NativeModules.OrotProviderDiagnostics = { enabled: true, report };
  const running = f.database.transaction(async () => {
    holder.release();
    await releaseHolder.reached;
  });
  await holder.reached;
  const selected = observeToolEventTransaction(f.database, async tx => {
    body.release();
    await releaseBody.reached;
    await tx.execute('CREATE TABLE synthetic_stage_probe (value INTEGER)');
  });
  try {
    expect(report.mock.calls).toEqual([
      ['storage', 'tool_event_write_admission', 'started'],
    ]);
    releaseHolder.release();
    await body.reached;
    expect(report.mock.calls.slice(1)).toEqual([
      ['storage', 'tool_event_write_admission', 'completed'],
      ['storage', 'tool_event_write_body', 'started'],
    ]);
    releaseBody.release();
    await selected;
    expect(report.mock.calls.slice(3)).toEqual([
      ['storage', 'tool_event_write_body', 'completed'],
      ['storage', 'tool_event_write_settlement', 'started'],
      ['storage', 'tool_event_write_settlement', 'completed'],
    ]);
  } finally {
    releaseHolder.release();
    releaseBody.release();
    await Promise.allSettled([running, selected]);
    delete NativeModules.OrotProviderDiagnostics;
    await f.close();
  }
});

test('does not change rollback and does not leak exception text', async () => {
  const f = openOpSqliteFileQueue();
  const error = new Error('private synthetic exception');
  const report = jest.fn();
  NativeModules.OrotProviderDiagnostics = { enabled: true, report };
  try {
    await expect(
      observeToolEventTransaction(f.database, async tx => {
        await tx.execute(
          'CREATE TABLE synthetic_rollback_probe (value INTEGER)',
        );
        throw error;
      }),
    ).rejects.toBe(error);
    expect(report.mock.calls.slice(-3)).toEqual([
      ['storage', 'tool_event_write_body', 'failed'],
      ['storage', 'tool_event_write_settlement', 'started'],
      ['storage', 'tool_event_write_settlement', 'failed'],
    ]);
    expect(
      (
        await f.database.execute(
          "SELECT name FROM sqlite_master WHERE name = 'synthetic_rollback_probe'",
        )
      ).rows,
    ).toEqual([]);
    expect(JSON.stringify(report.mock.calls)).not.toContain(error.message);
  } finally {
    delete NativeModules.OrotProviderDiagnostics;
    await f.close();
  }
});
