import { toolsFor } from '../featureServiceExecution';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { healthOverviewTestFixture } from '../testSupport/healthOverviewTestSupport';
import { localData, candidatesForInventory } from '../featureServiceFixtures';
import { inventory } from '../testSupport/personalEvidenceTestSupport';

test('an explicit summary overview applies SQL selection lazily without embedding or unrelated memory reads', async () => {
  const fixture = await healthOverviewTestFixture();
  const source = localData([]);
  const data = {
    ...source.data,
    repository: fixture.source,
    readCandidates: jest.fn(async () =>
      candidatesForInventory(inventory(fixture.records)),
    ),
    loadCurrentChunks: jest.fn(async () => fixture.chunks),
  };
  const tools = toolsFor(
    undefined,
    data,
    new LocalEvidenceReferenceRegistry(),
    6,
    true,
  );
  expect(data.readCandidates).not.toHaveBeenCalled();
  const result = await tools[0].search({
    operationRunId: 'summary',
    operationKey: 'model-selected',
    input: { query: 'current health records', view: 'health_overview' },
    allowedScope: { sourceKinds: ['personal_record'] },
    resultLimit: 8,
    maxPayloadBytes: 20 * 1024,
    signal: new AbortController().signal,
  });
  if ('status' in result) throw new Error('Expected local records');
  expect(result.items).toHaveLength(6);
  expect(data.readCandidates).toHaveBeenCalledWith(
    'current health records',
    expect.any(AbortSignal),
    { selection: 'health_overview' },
  );
  expect(data.loadMemoryRecords).not.toHaveBeenCalled();
  expect(data.rag.index).not.toHaveBeenCalled();
  expect(data.rag.search).not.toHaveBeenCalled();
});
