import type { SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { providerDiagnostic } from '../../../providers/diagnostics';
import { observeDailyReportData } from '../dailyReportDataDiagnostics';
import {
  prepareReportDatabase,
  reportProvider,
  reportRequest,
  reportService,
} from '../testSupport/dailyReportFailureStageFixtures';

jest.mock('../../../providers/diagnostics', () => ({
  providerDiagnostic: jest.fn(),
  reportProviderException: jest.fn(),
}));

function heldStage() {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => {
    enter = resolve;
  });
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  return {
    entered,
    release,
    wait() {
      enter();
      return held;
    },
  };
}

/** Synthetic actual SQL delegates establish ordering without timed sleep or a real model. */
test('separates initial snapshot, fact projection and pre-dispatch reproof', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const snapshot = heldStage();
  const projection = heldStage();
  const reproof = heldStage();
  const postProvider = heldStage();
  let pending: ReturnType<ReturnType<typeof reportService>> | undefined;
  try {
    await prepareReportDatabase(connection.database);
    let snapshotReads = 0;
    const database: SqlDatabase = {
      async execute(query, parameters) {
        if (query.includes('FROM manual_history_entries WHERE instr('))
          await projection.wait();
        return connection.database.execute(query, parameters);
      },
      transaction: operation =>
        connection.database.transaction(tx =>
          operation({
            ...tx,
            async execute(query, parameters) {
              if (
                query.includes('FROM health_observations r WHERE') &&
                query.includes('ORDER BY CASE WHEN')
              ) {
                snapshotReads += 1;
                if (snapshotReads === 1) await snapshot.wait();
                if (snapshotReads === 2) await reproof.wait();
                if (snapshotReads === 3) await postProvider.wait();
              }
              return tx.execute(query, parameters);
            },
          }),
        ),
    };
    const model = reportProvider();
    const generate = jest.spyOn(model, 'generate');
    pending = reportService(database, model)(reportRequest());

    await snapshot.entered;
    expect(providerDiagnostic).toHaveBeenCalledWith(
      'daily_report',
      'daily_report_data_snapshot',
      'started',
    );
    expect(providerDiagnostic).not.toHaveBeenCalledWith(
      'daily_report',
      'daily_report_data_projection',
      'started',
    );
    snapshot.release();

    await projection.entered;
    expect(providerDiagnostic).toHaveBeenCalledWith(
      'daily_report',
      'daily_report_data_snapshot',
      'completed',
    );
    expect(providerDiagnostic).toHaveBeenCalledWith(
      'daily_report',
      'daily_report_data_projection',
      'started',
    );
    expect(generate).not.toHaveBeenCalled();
    projection.release();

    await reproof.entered;
    expect(providerDiagnostic).toHaveBeenCalledWith(
      'daily_report',
      'daily_report_data_projection',
      'completed',
    );
    expect(providerDiagnostic).toHaveBeenCalledWith(
      'daily_report',
      'daily_report_data_reproof',
      'started',
    );
    expect(generate).not.toHaveBeenCalled();
    reproof.release();
    await postProvider.entered;
    expect(generate).toHaveBeenCalledTimes(1);
    expect(providerDiagnostic).toHaveBeenCalledWith(
      'daily_report',
      'daily_report_data_post_provider',
      'started',
    );
    expect(providerDiagnostic).not.toHaveBeenCalledWith(
      'daily_report',
      'daily_report_data_post_provider',
      'completed',
    );
    postProvider.release();
    await pending;
    expect(providerDiagnostic).toHaveBeenCalledWith(
      'daily_report',
      'daily_report_data_post_provider',
      'completed',
    );

    expect(providerDiagnostic).toHaveBeenCalledWith(
      'daily_report',
      'daily_report_data_reproof',
      'completed',
    );
    expect(generate).toHaveBeenCalledTimes(1);
  } finally {
    for (const stage of [snapshot, projection, reproof, postProvider])
      stage.release();
    await pending;
    connection.close();
  }
});

test('keeps failure, cancellation and optional sink errors observational', async () => {
  const signal = new AbortController();
  const reason = new Error('Synthetic private reason');
  const emit = jest.mocked(providerDiagnostic);
  emit.mockClear();
  emit.mockImplementationOnce(() => {
    throw new Error('Synthetic sink failure');
  });
  await expect(
    observeDailyReportData(
      'daily_report_data_snapshot',
      signal.signal,
      async () => {
        throw reason;
      },
    ),
  ).rejects.toBe(reason);
  await expect(
    observeDailyReportData(
      'daily_report_data_projection',
      signal.signal,
      async () => {
        signal.abort();
        return 'unchanged';
      },
    ),
  ).resolves.toBe('unchanged');
  expect(emit.mock.calls).toEqual([
    ['daily_report', 'daily_report_data_snapshot', 'started'],
    ['daily_report', 'daily_report_data_snapshot', 'failed'],
    ['daily_report', 'daily_report_data_projection', 'started'],
    ['daily_report', 'daily_report_data_projection', 'cancelled'],
  ]);
});
