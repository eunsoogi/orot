import { boundedDailyReport } from '../dailyReportDeadline';

jest.mock('../../../providers/diagnostics', () => ({
  providerDiagnostic: jest.fn(),
}));

import { providerDiagnostic } from '../../../providers/diagnostics';

test('keeps an uncategorized exception generic instead of calling it missing data', async () => {
  const privateMarker = 'synthetic private exception';
  const result = await boundedDailyReport(
    new AbortController().signal,
    100,
    async () => {
      throw new Error(privateMarker);
    },
  );

  expect(result).toEqual({ status: 'failed', code: 'error' });
  expect(providerDiagnostic).toHaveBeenCalledWith(
    'daily_report',
    'workflow',
    'other',
  );
  expect(
    JSON.stringify(jest.mocked(providerDiagnostic).mock.calls),
  ).not.toContain(privateMarker);
});
