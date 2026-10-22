import { createLocalEvidenceSearchTool } from '../evidenceSearchTool';
import type { LocalEvidenceSnapshot } from '../evidenceSnapshot';
import {
  evidence,
  reference,
} from '../../../diseaseHypotheses/taskTestSupport';

test('reserves bounded evidence capacity for a model-selected literature search', async () => {
  const items = Array.from({ length: 8 }, (_, i) => ({
    ...evidence.items[0]!,
    sourceId: `source-${i}`,
    evidenceId: `record-${i}`,
  }));
  const chunks = items.map((item, i) => ({
    id: `chunk-${i}`,
    text: item.content,
    metadata: {
      sourceId: item.sourceId,
      evidenceId: item.evidenceId,
      sourceRecordIds: [item.sourceId],
      evidenceLocator: {
        kind: 'structured_record' as const,
        recordId: item.evidenceId,
      },
      effectiveTime: item.effectiveTime,
      recordType: 'health_observation' as const,
      reviewState: { status: 'unreviewed' as const },
    },
  }));
  const snapshot = {
    items,
    chunks,
    coverage: evidence.coverage,
    inventory: {},
    gaps: [],
  } as unknown as LocalEvidenceSnapshot;
  const search = jest.fn(async () =>
    chunks.map(chunk => ({
      chunk,
      score: 1,
      lexicalRank: 1,
      vectorRank: null,
    })),
  );
  const tool = createLocalEvidenceSearchTool({
    id: 'local',
    sourceKind: 'personal_record',
    snapshot,
    rag: { search },
    maxResults: 6,
  });
  expect(search).not.toHaveBeenCalled();
  const result = await tool.search({
    operationRunId: 'capacity',
    operationKey: 'local',
    input: { query: '증상 활동 수면 복약' },
    allowedScope: { sourceKinds: [reference.sourceKind] },
    resultLimit: 8,
    maxPayloadBytes: 20_000,
    signal: new AbortController().signal,
  });
  if ('status' in result) throw new Error('Expected bounded records.');
  expect(result.items).toHaveLength(6);
  expect(result.coverage[0]?.truncated).toBe(true);
  expect(search).toHaveBeenCalledTimes(1);
});
