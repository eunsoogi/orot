import { NativeModules } from 'react-native';
import {
  reportPublicSearchFailure,
  reportPublicSearchProviderFailure,
} from '../publicSearchDiagnostics';

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

test.each([
  'rate_limited',
  'authentication_required',
  'internal_error',
  'unsupported_capability',
  'invalid_request',
])('attributes a provider failure to search without payload: %s', code => {
  reportPublicSearchProviderFailure(code);
  expect(NativeModules.OrotProviderDiagnostics.report.mock.calls).toEqual([
    ['rag', 'public_search', code],
  ]);
});

test('unknown provider detail and throwing diagnostics cannot affect recovery', () => {
  for (const code of ['synthetic private detail', '__proto__', 'constructor'])
    reportPublicSearchProviderFailure(code);
  expect(NativeModules.OrotProviderDiagnostics.report).not.toHaveBeenCalled();
  NativeModules.OrotProviderDiagnostics.report.mockImplementation(() => {
    throw new Error('synthetic');
  });
  expect(() =>
    reportPublicSearchProviderFailure('internal_error'),
  ).not.toThrow();
});
