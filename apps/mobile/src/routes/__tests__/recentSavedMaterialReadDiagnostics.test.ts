import { providerDiagnostic } from '../../providers/diagnostics';
import {
  enterRecentReadGate,
  observeRecentReadStage,
  reportRecentReadCompletion,
} from '../recentSavedMaterialReadDiagnostics';

jest.mock('../../providers/diagnostics', () => ({
  providerDiagnostic: jest.fn(),
}));

test('reports distinct protected read boundaries without payload, errors, or identifiers', async () => {
  const log = jest.mocked(providerDiagnostic);
  const row = { private: 'synthetic fixture' };
  const failure = new Error('synthetic source failure text');
  expect(
    await observeRecentReadStage(
      'recent_records_source_read',
      () => true,
      async () => row,
    ),
  ).toBe(row);
  await expect(
    observeRecentReadStage(
      'recent_records_reproof',
      () => true,
      async () => {
        throw failure;
      },
    ),
  ).rejects.toBe(failure);
  reportRecentReadCompletion('recent_records_admission', () => true, false);
  reportRecentReadCompletion('recent_records_admission', () => false, true);
  expect(log.mock.calls).toEqual([
    ['storage', 'recent_records_source_read', 'started'],
    ['storage', 'recent_records_source_read', 'completed'],
    ['storage', 'recent_records_reproof', 'started'],
    ['storage', 'recent_records_reproof', 'failed'],
    ['storage', 'recent_records_admission', 'failed'],
    ['storage', 'recent_records_admission', 'cancelled'],
  ]);
  log.mockImplementation(() => {
    throw failure;
  });
  await expect(
    observeRecentReadStage(
      'recent_records_source_read',
      () => true,
      async () => row,
    ),
  ).resolves.toBe(row);
  log.mockReset();
});

test.each([
  [false, true, true, false, 'cancelled', 0, 0],
  [true, false, true, false, 'unavailable', 1, 0],
  [true, true, false, false, 'stale_evidence', 1, 1],
  [true, true, true, true, 'started', 1, 1],
  [true, true, true, false, 'completed', 1, 1],
] as const)(
  'pre-admission reports the original guard decision without opening a reader',
  (tab, access, source, busy, code, accessCalls, sourceCalls) => {
    const log = jest.mocked(providerDiagnostic);
    const canAccess = jest.fn(() => access);
    const load = { sourceIsCurrent: jest.fn(() => source) };
    log.mockClear();
    expect(
      enterRecentReadGate(() => tab, canAccess, load, {
        current: busy ? new AbortController() : null,
      }),
    ).toBe(code === 'completed');
    expect(canAccess).toHaveBeenCalledTimes(accessCalls);
    expect(load.sourceIsCurrent).toHaveBeenCalledTimes(sourceCalls);
    expect(log.mock.calls).toEqual([
      ['storage', 'recent_records_pre_admission', code],
    ]);
  },
);

test('a missing optional source witness and throwing sink do not reject admission', () => {
  const log = jest.mocked(providerDiagnostic);
  log.mockImplementationOnce(() => {
    throw new Error('synthetic sink failure');
  });
  expect(
    enterRecentReadGate(
      () => true,
      () => true,
      {},
      { current: null },
    ),
  ).toBe(true);
});
