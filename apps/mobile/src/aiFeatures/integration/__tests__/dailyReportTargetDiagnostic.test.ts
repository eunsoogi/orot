import { createDailyReportIdentity } from '@orot/domain';
import { prepareDailyReportConversationEvidence } from '../dailyReportConversationEvidence';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { providerDiagnostic } from '../../../providers/diagnostics';

jest.mock('../../../providers/diagnostics', () => ({
  providerDiagnostic: jest.fn(),
}));
const report = {
  identity: createDailyReportIdentity('2035-01-01', 'UTC'),
  runId: 'synthetic-private-report',
  revision: 1,
};
beforeEach(() => jest.mocked(providerDiagnostic).mockReset());

test.each(['stale', 'deleted', 'unavailable'] as const)(
  'classifies %s without changing the rejected target or exposing identity',
  async status => {
    const load = jest.fn();
    const result = await prepareDailyReportConversationEvidence({
      report,
      resolve: async () => ({ status }),
      registry: new LocalEvidenceReferenceRegistry(),
      loadLocalData: load,
      signal: new AbortController().signal,
    });
    expect(result).toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect(providerDiagnostic).toHaveBeenCalledWith(
      'rag',
      'validation',
      `report_target_${status}`,
    );
    expect(
      JSON.stringify(jest.mocked(providerDiagnostic).mock.calls),
    ).not.toContain('synthetic-private');
  },
);

test('a current report without cited sources is distinguishable from changed records even if diagnostics throw', async () => {
  jest.mocked(providerDiagnostic).mockImplementation(() => {
    throw new Error('synthetic sink');
  });
  await expect(
    prepareDailyReportConversationEvidence({
      report,
      resolve: async () => ({ status: 'current', sources: [] }),
      registry: new LocalEvidenceReferenceRegistry(),
      loadLocalData: jest.fn(),
      signal: new AbortController().signal,
    }),
  ).resolves.toBeNull();
  expect(providerDiagnostic).toHaveBeenCalledWith(
    'rag',
    'validation',
    'report_target_empty',
  );
});

test('cancelled target lookup remains rejected without relabeling it as changed', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    prepareDailyReportConversationEvidence({
      report,
      resolve: async () => ({ status: 'stale' }),
      registry: new LocalEvidenceReferenceRegistry(),
      loadLocalData: jest.fn(),
      signal: controller.signal,
    }),
  ).resolves.toBeNull();
  expect(providerDiagnostic).toHaveBeenCalledWith(
    'rag',
    'validation',
    'report_target_cancelled',
  );
});
