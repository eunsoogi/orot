import { runMigrations } from '@orot/storage';
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

test('reports an empty day as unavailable data without invoking the provider', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const model = reportProvider();
  const generate = jest.spyOn(model, 'generate');
  try {
    await runMigrations(connection.database);
    expect(
      await reportService(connection.database, model)(reportRequest()),
    ).toEqual({ status: 'failed', code: 'source_unavailable' });
    expect(providerDiagnostic).toHaveBeenCalledWith(
      'daily_report',
      'data',
      'unavailable',
    );
    expect(generate).not.toHaveBeenCalled();
  } finally {
    connection.close();
  }
});

test('reports a source-read failure without forwarding database details', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const privateMarker = 'private health database detail';
  const model = reportProvider();
  const generate = jest.spyOn(model, 'generate');
  try {
    await prepareReportDatabase(connection.database);
    const database = failTransactionQuery(
      connection.database,
      query => query.includes('FROM health_observations r'),
      privateMarker,
    );
    expect(await reportService(database, model)(reportRequest())).toEqual({
      status: 'failed',
      code: 'source_read_failed',
    });
    expect(providerDiagnostic).toHaveBeenCalledWith(
      'daily_report',
      'data',
      'started',
    );
    expect(providerDiagnostic).toHaveBeenCalledWith(
      'daily_report',
      'data',
      'failed',
    );
    expect(generate).not.toHaveBeenCalled();
    expect(
      JSON.stringify(jest.mocked(providerDiagnostic).mock.calls),
    ).not.toContain(privateMarker);
  } finally {
    connection.close();
  }
});

test('reports a provider failure without forwarding exception text', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const privateMarker = 'private provider payload detail';
  const model = reportProvider();
  const generate = jest
    .spyOn(model, 'generate')
    .mockRejectedValue(new Error(privateMarker));
  try {
    await prepareReportDatabase(connection.database);
    expect(
      await reportService(connection.database, model)(reportRequest()),
    ).toEqual({
      status: 'failed',
      code: 'provider_unavailable',
    });
    expect(providerDiagnostic).toHaveBeenCalledWith(
      'daily_report',
      'provider_error',
      'started',
    );
    expect(providerDiagnostic).toHaveBeenCalledWith(
      'daily_report',
      'provider_error',
      'failed',
    );
    expect(generate).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify(jest.mocked(providerDiagnostic).mock.calls),
    ).not.toContain(privateMarker);
  } finally {
    connection.close();
  }
});

test('reports consent denial before any provider request', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const model = reportProvider();
  const generate = jest.spyOn(model, 'generate');
  try {
    await prepareReportDatabase(connection.database);
    expect(
      await reportService(connection.database, model, {
        remoteProcessing: true,
        authorize: async () => 'renewal_required',
      })(reportRequest()),
    ).toEqual({ status: 'failed', code: 'consent_required' });
    expect(providerDiagnostic).toHaveBeenCalledWith(
      'daily_report',
      'workflow',
      'consent_required',
    );
    expect(generate).not.toHaveBeenCalled();
  } finally {
    connection.close();
  }
});
