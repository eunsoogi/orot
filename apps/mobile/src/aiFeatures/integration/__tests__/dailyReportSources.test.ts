import { createDailyReportIdentity } from '@orot/domain';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createDailyReportSourceResolver } from '../dailyReportSources';
import type { AiFeatureLocalData } from '../localData';
import type { createDailyReportFeature } from '../dailyReportFeature';

test('source links require the same active report revision before and after lineage restoration', async () => {
  const identity = createDailyReportIdentity('2026-11-10', 'Asia/Seoul');
  const lookup = jest
    .fn()
    .mockResolvedValueOnce({ status: 'saved', runId: 'run', revision: 1 })
    .mockResolvedValueOnce({ status: 'saved', runId: 'run', revision: 2 });
  const read = jest.fn().mockResolvedValue({
    metadata: { type: 'daily_report' },
    sourceStatus: 'current',
    sources: [{ sourceId: 'record' }],
  });
  const data = {
    summaryArtifactDiscovery: async () => ({ read }),
  } as unknown as AiFeatureLocalData;
  const report = { lookup } as unknown as ReturnType<
    typeof createDailyReportFeature
  >;
  const resolve = createDailyReportSourceResolver({
    data: async () => data,
    registry: new LocalEvidenceReferenceRegistry(),
    report,
  });
  expect(
    await resolve(identity, 'run', 1, new AbortController().signal),
  ).toEqual({ status: 'stale' });
  expect(read).toHaveBeenCalledWith('run', expect.any(AbortSignal));
});

test('exposes cited evidence but not unrelated retained lineage', async () => {
  const identity = createDailyReportIdentity('2026-11-10', 'Asia/Seoul');
  const cited = { evidenceId: 'cited' };
  const unrelated = { evidenceId: 'unrelated' };
  const lookup = jest
    .fn()
    .mockResolvedValue({ status: 'saved', runId: 'run', revision: 1 });
  const read = jest.fn().mockResolvedValue({
    metadata: { type: 'daily_report' },
    sourceStatus: 'current',
    sources: [cited, unrelated],
    content: { hypotheses: [{ supportingEvidence: [cited] }] },
  });
  const data = {
    summaryArtifactDiscovery: async () => ({ read }),
  } as unknown as AiFeatureLocalData;
  const report = { lookup } as unknown as ReturnType<
    typeof createDailyReportFeature
  >;
  const resolve = createDailyReportSourceResolver({
    data: async () => data,
    registry: new LocalEvidenceReferenceRegistry(),
    report,
  });
  expect(
    await resolve(identity, 'run', 1, new AbortController().signal),
  ).toEqual({ status: 'current', sources: [cited] });
});
