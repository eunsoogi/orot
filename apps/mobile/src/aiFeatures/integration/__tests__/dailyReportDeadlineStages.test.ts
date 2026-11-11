import type { SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportService } from '../dailyReportService';
import {
  prepareReportDatabase,
  reportProvider,
  reportRequest,
  selectedReportProvider,
} from '../testSupport/dailyReportFailureStageFixtures';

jest.mock('../../../providers/diagnostics', () => ({
  providerDiagnostic: jest.fn(),
  reportProviderException: jest.fn(),
}));

import { providerDiagnostic } from '../../../providers/diagnostics';

beforeEach(() => jest.mocked(providerDiagnostic).mockClear());

test('classifies a timed-out saved-report lookup and never starts generation', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  let releaseLookup!: () => void;
  let markLookupStarted!: () => void;
  let markLookupFinished!: () => void;
  const lookupGate = new Promise<void>(resolve => {
    releaseLookup = resolve;
  });
  const lookupStarted = new Promise<void>(resolve => {
    markLookupStarted = resolve;
  });
  const lookupFinished = new Promise<void>(resolve => {
    markLookupFinished = resolve;
  });
  let interceptedLookup = false;
  try {
    await prepareReportDatabase(connection.database);
    const database: SqlDatabase = {
      execute: (query, parameters) =>
        connection.database.execute(query, parameters),
      transaction: operation =>
        connection.database.transaction(async tx => {
          let heldLookup = false;
          try {
            await operation({
              ...tx,
              async execute(query, parameters) {
                if (
                  !interceptedLookup &&
                  query.includes('FROM daily_report_heads')
                ) {
                  interceptedLookup = true;
                  heldLookup = true;
                  markLookupStarted();
                  await lookupGate;
                }
                return tx.execute(query, parameters);
              },
            });
          } finally {
            if (heldLookup) markLookupFinished();
          }
        }),
    };
    const resolveSelected = jest.fn(async () =>
      selectedReportProvider(reportProvider()),
    );
    const service = createDailyReportService({
      database,
      now: () => '2035-01-01T12:00:00Z',
      createRunId: () => 'synthetic-run',
      timeoutMs: 100,
      resolveSelected,
      consent: { authorize: async () => 'authorized' },
    });

    const resultPromise = service(reportRequest());
    await lookupStarted;
    expect(await resultPromise).toEqual({
      status: 'failed',
      code: 'report_read_failed',
    });
    expect(providerDiagnostic).toHaveBeenCalledWith(
      'daily_report',
      'persistence',
      'failed',
    );
    expect(providerDiagnostic).not.toHaveBeenCalledWith(
      'daily_report',
      'provider_error',
      'failed',
    );
    expect(providerDiagnostic).not.toHaveBeenCalledWith(
      'daily_report',
      'workflow',
      'cancelled',
    );
    expect(resolveSelected).not.toHaveBeenCalled();

    releaseLookup();
    await lookupFinished;
    expect(
      (await connection.database.execute('SELECT id FROM symptom_summary_runs'))
        .rows,
    ).toHaveLength(0);
  } finally {
    releaseLookup();
    if (interceptedLookup) await lookupFinished;
    connection.close();
  }
});

test('keeps a provider execution timeout in the provider stage without saving', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await prepareReportDatabase(connection.database);
    const provider = reportProvider();
    const generate = jest
      .spyOn(provider, 'generate')
      .mockImplementation(
        () =>
          new Promise<Awaited<ReturnType<typeof provider.generate>>>(
            () => undefined,
          ),
      );
    const service = createDailyReportService({
      database: connection.database,
      now: () => '2035-01-01T12:00:00Z',
      createRunId: () => 'synthetic-run',
      timeoutMs: 100,
      resolveSelected: async () => selectedReportProvider(provider),
      consent: { authorize: async () => 'authorized' },
    });

    expect(await service(reportRequest())).toEqual({
      status: 'failed',
      code: 'timeout',
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(providerDiagnostic).toHaveBeenCalledWith(
      'daily_report',
      'provider_error',
      'failed',
    );
    expect(providerDiagnostic).not.toHaveBeenCalledWith(
      'daily_report',
      'persistence',
      'failed',
    );
    expect(providerDiagnostic).not.toHaveBeenCalledWith(
      'daily_report',
      'workflow',
      'cancelled',
    );
    expect(
      (await connection.database.execute('SELECT id FROM symptom_summary_runs'))
        .rows,
    ).toHaveLength(0);
  } finally {
    connection.close();
  }
});
