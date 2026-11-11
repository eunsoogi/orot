import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  failTransactionQuery,
  prepareReportDatabase,
  reportProvider,
  reportRequest,
  reportService,
} from '../testSupport/dailyReportFailureStageFixtures';

jest.mock('../../../providers/diagnostics', () => ({
  providerDiagnostic: jest.fn(),
  reportProviderException: jest.fn(),
}));

import { providerDiagnostic } from '../../../providers/diagnostics';

beforeEach(() => jest.mocked(providerDiagnostic).mockClear());

test('reports malformed model output at validation and leaves storage empty', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const model = reportProvider('{"indexes":[99]}');
  try {
    await prepareReportDatabase(connection.database);
    expect(
      await reportService(connection.database, model)(reportRequest()),
    ).toEqual({
      status: 'failed',
      code: 'malformed_output',
    });
    expect(providerDiagnostic).toHaveBeenCalledWith(
      'daily_report',
      'validation',
      'invalid_output',
    );
    expect(
      (
        await connection.database.execute(
          'SELECT identity_key FROM daily_report_heads',
        )
      ).rows,
    ).toHaveLength(0);
  } finally {
    connection.close();
  }
});

test('reports a failed save at persistence without logging database details', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const privateMarker = 'private persistence detail';
  const model = reportProvider();
  try {
    await prepareReportDatabase(connection.database);
    const database = failTransactionQuery(
      connection.database,
      query => query.startsWith('INSERT INTO symptom_summary_runs'),
      privateMarker,
    );
    expect(await reportService(database, model)(reportRequest())).toEqual({
      status: 'failed',
      code: 'persistence_failed',
    });
    expect(providerDiagnostic).toHaveBeenCalledWith(
      'daily_report',
      'persistence',
      'failed',
    );
    expect(
      JSON.stringify(jest.mocked(providerDiagnostic).mock.calls),
    ).not.toContain(privateMarker);
    expect(
      (
        await connection.database.execute(
          'SELECT identity_key FROM daily_report_heads',
        )
      ).rows,
    ).toHaveLength(0);
  } finally {
    connection.close();
  }
});

test('reports a saved-report lookup failure separately from a failed save', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const model = reportProvider();
  const generate = jest.spyOn(model, 'generate');
  try {
    await prepareReportDatabase(connection.database);
    const database = failTransactionQuery(
      connection.database,
      query => query.includes('SELECT active_run_id, revision, deleted'),
      'private lookup detail',
    );
    expect(await reportService(database, model)(reportRequest())).toEqual({
      status: 'failed',
      code: 'report_read_failed',
    });
    expect(providerDiagnostic).toHaveBeenCalledWith(
      'daily_report',
      'persistence',
      'failed',
    );
    expect(generate).not.toHaveBeenCalled();
  } finally {
    connection.close();
  }
});
