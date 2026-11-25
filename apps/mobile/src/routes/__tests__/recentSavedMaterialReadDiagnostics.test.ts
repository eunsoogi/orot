import { providerDiagnostic } from '../../providers/diagnostics';
import {
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
