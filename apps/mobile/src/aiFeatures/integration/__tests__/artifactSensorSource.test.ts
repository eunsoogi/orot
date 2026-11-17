import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createArtifactSourceTool } from '../artifactSourceTool';
import { registerArtifactSource } from '../artifactLineage';
import type { AiFeatureLocalData } from '../localData';

function fixture() {
  const registry = new LocalEvidenceReferenceRegistry();
  const record = {
    ...healthObservation('sample', 'heart_rate', '2026-10-01T10:00:00Z'),
    value: { kind: 'quantity' as const, amount: 85, unit: 'count/min' },
  };
  const source = registry.add({
    reference: {
      sourceKind: 'personal_record',
      sourceId: 'sample',
      sourceRevision: '1',
      evidenceId: 'sample',
      evidenceRevision: '1',
      locator: null,
      effectiveTime: null,
      reviewState: 'reviewed',
    },
    content: 'original',
    validate: async () => true,
    readSource: async () => ({
      status: 'available',
      document: {
        sourceKind: 'personal_record',
        records: [{ kind: 'health_observation', record }],
      },
    }),
  });
  registerArtifactSource(registry, 'run', source, {
    id: 'report',
    revision: '1',
    sourceStatus: 'current',
  });
  const discovery = {
    read: async () => ({
      metadata: { revision: '1' },
      sourceStatus: 'current',
    }),
    revalidatePage: async () => true,
  };
  const data = {
    summaryArtifactDiscovery: async () => discovery,
    findIdentifiers: async () => [],
  } as unknown as AiFeatureLocalData;
  return {
    source,
    tool: createArtifactSourceTool('personal_record', data, registry),
  };
}

test('model-followed single artifact sensor source remains a summary unless the host pins the exact record', async () => {
  const { source, tool } = fixture();
  const request = {
    operationRunId: 'run',
    operationKey: 'source',
    input: { evidenceId: source.evidenceId },
    allowedScope: { sourceKinds: ['personal_record' as const] },
    resultLimit: 1,
    maxPayloadBytes: 20000,
    signal: new AbortController().signal,
  };
  const batch = await tool.search(request);
  if ('status' in batch) throw new Error('Unexpected approval');
  expect(batch.items[0]!.content).toContain('sensor_period_summary');
  const selected = await tool.search({
    ...request,
    allowedScope: { ...request.allowedScope, sourceIds: [source.sourceId] },
  });
  if ('status' in selected) throw new Error('Unexpected approval');
  expect(selected.items[0]!.content).not.toContain('sensor_period_summary');
  expect(selected.items[0]!.content).toContain('85');
  await expect(
    tool.search({
      ...request,
      allowedScope: {
        ...request.allowedScope,
        sourceIds: ['different-source'],
      },
    }),
  ).rejects.toThrow('outside the selected scope');
});
