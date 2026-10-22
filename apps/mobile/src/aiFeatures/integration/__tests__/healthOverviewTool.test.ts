import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import {
  captureSymptomSummarySources,
  restoreSymptomSummary,
} from '../symptomSummarySources';
import type { AiFeatureLocalData } from '../localData';
import { healthOverviewTestFixture } from '../testSupport/healthOverviewTestSupport';
import { jsonByteLength } from '../evidenceUtils';

test('one selected overview returns bounded diverse facts with exact, revalidated source groups', async () => {
  const { meds, registry, source, snapshot, search, loadSnapshot, tool } =
    await healthOverviewTestFixture();
  expect(loadSnapshot).not.toHaveBeenCalled();
  const result = await tool.search({
    operationRunId: 'overview',
    operationKey: 'one-model-call',
    input: { query: 'health records', view: 'health_overview' },
    allowedScope: { sourceKinds: ['personal_record'] },
    resultLimit: 8,
    maxPayloadBytes: 20 * 1024,
    signal: new AbortController().signal,
  });
  if ('status' in result) throw new Error('Expected local overview');
  expect(result.items).toHaveLength(6);
  expect(
    result.items.every(item => item.content.startsWith('health_overview:')),
  ).toBe(true);
  const content = JSON.stringify(result.items);
  for (const expected of [
    '예시약0',
    '예시약3',
    'blood pressure systolic',
    'heart_rate',
    'body_mass',
    'step_count',
    '깊은 수면',
    '기록된 예시 증상',
  ])
    expect(content).toContain(expected);
  expect(content).not.toContain('private-');
  expect(content).not.toContain('display_not_provided');
  expect(content).not.toContain('ingestedAt');
  expect(result.coverage[0]?.truncated).toBe(true);
  expect(loadSnapshot).toHaveBeenCalledTimes(1);
  expect(search).not.toHaveBeenCalled();
  const medicationGroup = result.items.find(item =>
    item.content.includes('예시약0'),
  )!;
  const read = await registry.readSource(
    medicationGroup,
    new AbortController().signal,
  );
  expect(read.status).toBe('available');
  if (
    read.status !== 'available' ||
    read.document.sourceKind !== 'personal_record'
  )
    throw new Error('Missing originals');
  expect(read.document.records.map(row => row.record.id)).toEqual(
    meds.map(row => row.record.id),
  );
  expect(
    await registry.revalidateEvidence(
      result.items,
      new AbortController().signal,
    ),
  ).toBe(true);
  const analysis = {
    presentation: 'symptom_summary' as const,
    hypotheses: [
      {
        title: '등록된 약',
        summary: '예시약0 등이 등록됐어요.',
        supportingEvidence: [medicationGroup],
        contraryEvidence: [],
        uncertainty: '',
        missingData: [],
      },
    ],
  };
  const captured = await captureSymptomSummarySources(
    analysis,
    registry,
    new AbortController().signal,
  );
  const capturedSource = captured.sources[0];
  expect(
    capturedSource && 'records' in capturedSource ? capturedSource.records : [],
  ).toHaveLength(4);
  const restoredRegistry = new LocalEvidenceReferenceRegistry();
  const restored = await restoreSymptomSummary(
    {
      ...captured,
      id: 'saved-overview',
      createdAt: '2026-10-20T00:00:00Z',
      providerId: 'synthetic',
      modelId: 'synthetic',
      modelName: 'Synthetic',
    },
    restoredRegistry,
    {
      repository: source,
      loadMemoryRecords: async () => [],
      loadStaleArtifacts: async () => [],
    } as unknown as AiFeatureLocalData,
  );
  expect(restored.savedSummary).toMatchObject({
    status: 'saved',
    sourceChanged: false,
  });
  const restoredRead = await restoredRegistry.readSource(
    restored.hypotheses[0]!.supportingEvidence[0]!,
    new AbortController().signal,
  );
  expect(restoredRead.status).toBe('available');
  if (
    restoredRead.status !== 'available' ||
    restoredRead.document.sourceKind !== 'personal_record'
  )
    throw new Error('Missing restored originals');
  expect(restoredRead.document.records.map(row => row.record.id)).toEqual(
    meds.map(row => row.record.id),
  );
  const request = {
    operationRunId: 'scoped',
    operationKey: 'bounded',
    input: { query: 'health', view: 'health_overview' },
    allowedScope: { sourceKinds: ['personal_record' as const] },
    resultLimit: 8,
    maxPayloadBytes: 1024,
    signal: new AbortController().signal,
  };
  const small = await tool.search(request);
  expect(jsonByteLength(small)).toBeLessThanOrEqual(1024);
  const scoped = await tool.search({
    ...request,
    maxPayloadBytes: 20 * 1024,
    allowedScope: {
      ...request.allowedScope,
      sourceIds: [snapshot.items[0]!.sourceId],
    },
  });
  if ('status' in scoped) throw new Error('Expected scoped local records');
  expect(scoped.items).toHaveLength(1);
  expect(scoped.items[0]!.sourceId).toBe(snapshot.items[0]!.sourceId);
  const outside = await tool.search({
    ...request,
    allowedScope: {
      ...request.allowedScope,
      timeRange: {
        fromInclusive: '2030-01-01T00:00:00Z',
        toExclusive: '2031-01-01T00:00:00Z',
      },
    },
  });
  if ('status' in outside) throw new Error('Expected scoped local records');
  expect(outside.items).toEqual([]);
  (source.readRecord as jest.Mock).mockResolvedValueOnce(null);
  expect(
    await registry.revalidateEvidence(
      [medicationGroup],
      new AbortController().signal,
    ),
  ).toBe(false);
});
