import { NativeModules } from 'react-native';
import { reportPublicSearchFailure } from '../publicSearchDiagnostics';

jest.mock('react-native', () => ({
  NativeModules: { OrotProviderDiagnostics: { report: jest.fn() } },
}));

beforeEach(() => jest.resetAllMocks());

test.each(['timeout', 'offline', 'unavailable'] as const)(
  'reports only the fixed optional public-search failure: %s',
  reason => {
    reportPublicSearchFailure(reason);
    expect(NativeModules.OrotProviderDiagnostics.report.mock.calls).toEqual([
      ['rag', 'public_search', reason],
    ]);
  },
);

test('rejects unknown values and isolates native diagnostic failure', () => {
  reportPublicSearchFailure('synthetic private detail' as never);
  expect(NativeModules.OrotProviderDiagnostics.report).not.toHaveBeenCalled();
  NativeModules.OrotProviderDiagnostics.report.mockImplementation(() => {
    throw new Error('Synthetic native bridge failure');
  });
  expect(() => reportPublicSearchFailure('timeout')).not.toThrow();
});
