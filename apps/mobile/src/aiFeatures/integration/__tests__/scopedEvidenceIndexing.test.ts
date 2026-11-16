import { toolsFor } from '../featureServiceExecution';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import {
  localData,
  memoryRecord,
  completeInventory,
  candidatesForInventory,
} from '../featureServiceFixtures';

const at = '2026-11-01T00:00:00Z';
function fixture() {
  const source = localData(
    Array.from({ length: 100 }, (_, index) => memoryRecord(index)),
  );
  const record = {
    kind: 'symptom_entry' as const,
    record: {
      id: 'synthetic-personal-note',
      status: 'active' as const,
      description:
        'Synthetic note includes memory-private-0 and source-private-0.',
      effectiveAt: at,
      recordedAt: at,
      ingestedAt: at,
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
    },
  };
  source.data.readCandidates = jest.fn(async () =>
    candidatesForInventory({
      ...completeInventory,
      records: [record],
      recordCount: 1,
    }),
  );
  source.data.loadCurrentChunks = jest.fn(async () => [
    {
      id: 'synthetic-chunk',
      text: record.record.description,
      metadata: {
        recordType: 'symptom_entry' as const,
        sourceId: record.record.id,
        evidenceId: record.record.id,
        effectiveTime: at,
        sourceRecordIds: [],
        reviewState: { status: 'unreviewed' as const },
        evidenceLocator: {
          kind: 'structured_record' as const,
          recordId: record.record.id,
        },
      },
    },
  ]);
  const registry = new LocalEvidenceReferenceRegistry();
  const tools = toolsFor(undefined, source.data, registry);
  return { ...source, tools, registry };
}
const request = {
  operationRunId: 'synthetic-index-measurement',
  operationKey: 'local-tool',
  input: { query: 'synthetic note' },
  allowedScope: { sourceKinds: ['personal_record' as const] },
  resultLimit: 8,
  maxPayloadBytes: 65536,
  signal: new AbortController().signal,
};
test('indexes only the exact scoped candidates searched while retaining cross-store redaction', async () => {
  const source = fixture();
  const tool = source.tools.find(
    value => value.id === 'local-personal-records',
  )!;
  const result = await tool.search(request);
  const indexed = source.indexedChunks.flat();
  const searched = source.searchedChunks.flat();
  console.info('Synthetic index workload', {
    indexed: indexed.length,
    searched: searched.length,
  });
  expect(indexed).toHaveLength(1);
  expect(indexed).toEqual(searched);
  expect(source.eventOrder).toEqual(['index', 'search']);
  expect(searched).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain('memory-private-0');
  expect(JSON.stringify(result)).not.toContain('source-private-0');
});

test('empty allowed source selection neither indexes nor searches unrelated text', async () => {
  const source = fixture();
  const tool = source.tools.find(
    value => value.id === 'local-personal-records',
  )!;
  await tool.search({
    ...request,
    allowedScope: { ...request.allowedScope, sourceIds: [] },
  });
  expect(source.indexedChunks).toEqual([]);
  expect(source.searchedChunks).toEqual([]);
});

test('reviewed memory is indexed on its own scoped request, and unchanged text is reused', async () => {
  const source = fixture();
  const tool = source.tools.find(
    value => value.id === 'local-reviewed-memory',
  )!;
  const scoped = {
    ...request,
    allowedScope: {
      sourceKinds: ['reviewed_memory' as const],
      timeRange: {
        fromInclusive: '2026-01-01T00:00:00Z',
        toExclusive: '2026-01-02T00:00:00Z',
      },
    },
  };
  await tool.search(scoped);
  expect(source.indexedChunks.flat()).toHaveLength(1);
  expect(source.indexedChunks[0]).toEqual(source.searchedChunks[0]);
  await tool.search(scoped);
  expect(source.indexedChunks).toHaveLength(1);
  expect(source.searchedChunks).toHaveLength(2);
  source.replaceMemoryRecords([
    { ...memoryRecord(0), text: 'Changed synthetic note' },
  ]);
  await tool.search(scoped);
  expect(source.indexedChunks).toHaveLength(2);
  expect(source.indexedChunks[1]?.[0]?.text).toBe('Changed synthetic note');
});

test('cancellation during indexing stops before retrieval', async () => {
  const source = fixture();
  const controller = new AbortController();
  source.data.rag.index = jest.fn(async () => {
    controller.abort();
  });
  const tool = source.tools.find(
    value => value.id === 'local-personal-records',
  )!;
  const result = await tool.search({ ...request, signal: controller.signal });
  expect(source.data.rag.index).toHaveBeenCalledTimes(1);
  expect(source.searchedChunks).toEqual([]);
  expect(result).toMatchObject({ items: [] });
});
