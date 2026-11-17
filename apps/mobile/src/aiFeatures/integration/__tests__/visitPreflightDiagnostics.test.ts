import { providerDiagnostic } from '../../../providers/diagnostics';
import { observeVisitPreflight } from '../visitPreflightDiagnostics';

jest.mock('../../../providers/diagnostics', () => ({
  providerDiagnostic: jest.fn(),
}));
beforeEach(() => jest.resetAllMocks());

test('reports fixed boundaries without passing private results or exceptions', async () => {
  const value = { privateText: 'synthetic secret' };
  await expect(
    observeVisitPreflight('preflight_context', async () => value),
  ).resolves.toBe(value);
  const error = new Error('synthetic private failure');
  await expect(
    observeVisitPreflight('preflight_public', async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(jest.mocked(providerDiagnostic).mock.calls).toEqual([
    ['visit', 'preflight_context', 'started'],
    ['visit', 'preflight_context', 'completed'],
    ['visit', 'preflight_public', 'started'],
    ['visit', 'preflight_public', 'failed'],
  ]);
});

test('a throwing optional native sink does not change work or failure', async () => {
  jest.mocked(providerDiagnostic).mockImplementation(() => {
    throw new Error('sink');
  });
  const work = jest.fn(async () => false);
  await expect(
    observeVisitPreflight('preflight_selection', work),
  ).resolves.toBe(false);
  expect(work).toHaveBeenCalledTimes(1);
  const error = new Error('work');
  await expect(
    observeVisitPreflight('preflight_saved', async () => {
      throw error;
    }),
  ).rejects.toBe(error);
});
