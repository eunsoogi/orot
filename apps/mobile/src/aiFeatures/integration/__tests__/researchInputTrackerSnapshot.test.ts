import type {
  EvidenceReference,
  EvidenceSearchTool,
} from '@orot/agent-runtime';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createResearchInputTracker } from '../researchInputTracker';
import type { ResearchInputTrackerSnapshot } from '../researchInputTrackerSnapshot';
import type { AiFeatureLocalData } from '../localData';

const original: EvidenceReference = {
  sourceKind: 'personal_record',
  sourceId: 'synthetic-source',
  sourceRevision: 'v1',
  evidenceId: 'synthetic-record',
  evidenceRevision: 'v1',
  locator: { kind: 'structured_record', recordId: 'synthetic-record' },
  effectiveTime: null,
  reviewState: 'reviewed',
};
const signal = new AbortController().signal;
async function fixture() {
  const registry = new LocalEvidenceReferenceRegistry();
  const validate = jest.fn(async () => true);
  const readSource = jest.fn(async () => ({
    status: 'available' as const,
    document: { sourceKind: 'personal_record' as const, records: [] },
  }));
  const item = registry.add({
    reference: original,
    content: 'synthetic',
    validate,
    readSource,
  });
  const discoveryRead = jest.fn(async (id: string) => ({
    metadata: {
      id,
      revision: 'research-v1',
      type: 'research_publication',
      eventTime: null,
    },
  }));
  const data = {
    researchArtifactDiscovery: async () => ({ read: discoveryRead }),
  } as unknown as AiFeatureLocalData;
  const tracker = createResearchInputTracker(
    registry,
    data,
    'synthetic-session',
  );
  const search = jest.fn(async () => ({
    items: [item],
    coverage: [],
    conflicts: [],
  }));
  const tool: EvidenceSearchTool = {
    id: 'local-fixture',
    sourceKind: 'personal_record',
    execution: 'local_read_only',
    description: 'synthetic local fixture',
    inputSchema: {},
    parseInput: () => ({}),
    search,
  };
  await tracker.wrap([tool])[0].search({
    operationRunId: 'run',
    operationKey: 'tool-1',
    input: {},
    allowedScope: { sourceKinds: ['personal_record'] },
    resultLimit: 2,
    maxPayloadBytes: 10000,
    signal,
  });
  return {
    registry,
    tracker,
    data,
    search,
    validate,
    readSource,
    discoveryRead,
    item,
  };
}

test('protected round trip preserves exact inputs and retained research deduplication without reads', async () => {
  const f = await fixture();
  await f.tracker.recordResearch([1], signal);
  const snapshot = f.tracker.snapshot();
  const fresh = LocalEvidenceReferenceRegistry.restore(
    f.registry.snapshot(),
    f.registry,
  );
  const reads = f.discoveryRead.mock.calls.length;
  const restored = createResearchInputTracker(
    fresh,
    f.data,
    'synthetic-session',
    { snapshot },
  );
  expect(restored.snapshot()).toEqual(snapshot);
  expect(snapshot.inputs[0].original).toEqual(original);
  expect(snapshot.retained).toHaveLength(1);
  expect(snapshot.retained[0]).toMatchObject({
    id: 'research-1',
    revision: 'research-v1',
  });
  expect(f.discoveryRead).toHaveBeenCalledTimes(reads);
  expect(f.validate).not.toHaveBeenCalled();
  expect(f.readSource).not.toHaveBeenCalled();
  const count = fresh.snapshot().entries.length;
  await restored.recordResearch([1], signal);
  expect(fresh.snapshot().entries).toHaveLength(count);
  expect(restored.snapshot()).toEqual(snapshot);
  expect(f.search).toHaveBeenCalledTimes(1);
});

test('missing call-scope bindings block restored free-form research even for empty inputs', async () => {
  const f = await fixture();
  await expect(f.tracker.revalidate(signal)).resolves.toBe(true);
  const restored = createResearchInputTracker(
    f.registry,
    undefined,
    undefined,
    { snapshot: f.tracker.snapshot() },
  );
  await expect(restored.revalidate(signal)).resolves.toBe(false);
  await expect(restored.capture(signal)).rejects.toThrow('lineage');
  expect(restored.snapshot().incomplete).toBe(false);
  const empty = createResearchInputTracker(
    new LocalEvidenceReferenceRegistry(),
  );
  const coldEmpty = createResearchInputTracker(
    new LocalEvidenceReferenceRegistry(),
    undefined,
    undefined,
    { snapshot: empty.snapshot() },
  );
  await expect(coldEmpty.revalidate(signal)).resolves.toBe(false);
  await expect(coldEmpty.capture(signal)).rejects.toThrow('lineage');
});

test('incomplete lineage is retained and cannot become complete after restoration', async () => {
  const f = await fixture();
  const tracker = createResearchInputTracker(f.registry);
  await tracker.recordResearch([1], signal);
  expect(tracker.snapshot().incomplete).toBe(true);
  const restored = createResearchInputTracker(
    f.registry,
    undefined,
    undefined,
    { snapshot: tracker.snapshot() },
  );
  expect(restored.snapshot().incomplete).toBe(true);
  await expect(restored.revalidate(signal)).resolves.toBe(false);
});

test.each([
  'missing',
  'duplicate-input',
  'changed-original',
  'unknown-alias',
  'duplicate-retained',
  'changed-revision',
  'changed-id',
  'missing-retained-input',
  'scope-grant',
  'missing-incomplete',
] as const)(
  'rejects %s snapshot rather than silently resetting lineage',
  async change => {
    const f = await fixture();
    await f.tracker.recordResearch([1], signal);
    const snapshot = JSON.parse(JSON.stringify(f.tracker.snapshot()));
    if (change === 'duplicate-input') snapshot.inputs.push(snapshot.inputs[0]);
    if (change === 'changed-original')
      snapshot.inputs[0].original.sourceRevision = 'other';
    if (change === 'unknown-alias')
      snapshot.inputs[0].reference.evidenceId = 'e999';
    if (change === 'duplicate-retained')
      snapshot.retained.push(snapshot.retained[0]);
    if (change === 'changed-revision') snapshot.retained[0].revision = 'other';
    if (change === 'changed-id') snapshot.retained[0].id = 'research-2';
    if (change === 'missing-retained-input') snapshot.inputs.pop();
    if (change === 'scope-grant') snapshot.scopeBindings = 'restored';
    if (change === 'missing-incomplete') delete snapshot.incomplete;
    expect(() =>
      createResearchInputTracker(f.registry, f.data, undefined, {
        snapshot:
          change === 'missing'
            ? (undefined as unknown as ResearchInputTrackerSnapshot)
            : snapshot,
      }),
    ).toThrow();
    expect(f.validate).not.toHaveBeenCalled();
    expect(f.readSource).not.toHaveBeenCalled();
  },
);

test('snapshot copies cannot mutate live lineage and capture rejects unregistered inputs', async () => {
  const f = await fixture();
  const saved = JSON.parse(JSON.stringify(f.tracker.snapshot()));
  saved.inputs[0].reference.evidenceId = 'e999';
  expect(f.tracker.snapshot().inputs[0].reference.evidenceId).toBe(
    f.item.evidenceId,
  );
  const unrelated = new LocalEvidenceReferenceRegistry();
  expect(() =>
    createResearchInputTracker(unrelated, undefined, undefined, {
      snapshot: f.tracker.snapshot(),
    }),
  ).toThrow();
});
