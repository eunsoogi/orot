import type { EvidenceSearchRuntime } from '@orot/agent-runtime';
import { prepareVisitQuestionContext } from '../evidenceService';
import { createVisitQuestionEvidenceAliases } from '../evidenceAliases';
import { mapMemoryHitToVisitQuestionEvidence } from '../evidence';
import { ports, now, chunk } from '../testing/evidenceServiceFixtures';
import { makeProvider, selectedOption } from '../testing/workflowFixtures';
import { runVisitQuestionWorkflow } from '../workflow';

test('keeps valid dated memory and drops malformed provenance from the graph Store', async () => {
  const dependencies = ports();
  const memory = {
    id: 'memory-1',
    text: '사용자가 지난 진료에서 검사 결과를 먼저 확인하기로 했어요.',
    kind: 'reviewed_interaction',
    provenance: {
      sourceIds: ['source-1'],
      sourceDates: [{ sourceId: 'source-1', date: '2026-10-01T00:00:00Z' }],
      reviewState: 'human_reviewed',
    },
    createdAt: Date.parse('2026-10-01T00:00:00Z'),
  } as const;
  dependencies.queryService.searchMemory.mockResolvedValue({
    status: 'available',
    hits: [{ ...memory, score: 0.9 }],
    limit: 3,
  });
  const storeItem = {
    key: 'visit-memory-key',
    namespace: ['agent-memory'],
    value: {
      ...memory,
      memoryKey: 'visit-memory-key',
    },
    score: 0.9,
    createdAt: new Date(memory.createdAt),
    updatedAt: new Date(memory.createdAt),
  };
  // Persisted Store rows are untyped, so malformed dates must not become evidence.
  const malformedStoreItem = {
    ...storeItem,
    key: 'legacy-invalid-memory-key',
    value: {
      ...storeItem.value,
      id: 'malformed-memory',
      memoryKey: 'legacy-invalid-memory-key',
      provenance: {
        ...memory.provenance,
        sourceDates: ['2026-10-01T00:00:00Z'],
      },
    },
  };
  const storeBatch = jest.fn(async (operations: readonly unknown[]) =>
    operations.map(operation => {
      if (typeof operation !== 'object' || operation === null) return [];
      const search = operation as {
        readonly namespacePrefix?: readonly string[];
        readonly limit?: number;
      };
      return search.namespacePrefix?.[0] === 'agent-memory'
        ? [storeItem, malformedStoreItem].slice(0, search.limit ?? 10)
        : [];
    }),
  );
  const store = {
    batch: storeBatch,
    start: async () => {},
    stop: async () => {},
  } as unknown as NonNullable<EvidenceSearchRuntime['store']>;
  const prepared = await prepareVisitQuestionContext({
    now,
    maxEvidenceItems: 8,
    queryService: dependencies.queryService,
    repository: dependencies.repository,
    rag: dependencies.rag,
    buildChunks: async () => [chunk],
    currentTime: () => now,
    store,
  });
  if (prepared.status !== 'ready')
    throw new Error('The fixture appointment should be available.');

  const mapped = mapMemoryHitToVisitQuestionEvidence({
    ...memory,
    score: 0.9,
  })!;
  const aliases = createVisitQuestionEvidenceAliases(prepared.evidence.batch);
  const aliased = aliases.aliasBatch({
    items: [mapped.item],
    coverage: [
      {
        sourceKind: 'reviewed_memory',
        searchedSourceIds: [mapped.item.sourceId],
        gaps: [],
        truncated: false,
        resultLimit: 2,
        returnedCount: 1,
      },
    ],
    conflicts: [],
  }).items[0]!;
  const citation = {
    sourceKind: aliased.sourceKind,
    sourceId: aliased.sourceId,
    sourceRevision: aliased.sourceRevision,
    evidenceId: aliased.evidenceId,
    evidenceRevision: aliased.evidenceRevision,
    locator: aliased.locator,
    effectiveTime: aliased.effectiveTime,
    reviewState: aliased.reviewState,
  };
  const outputs = [
    JSON.stringify({
      text: '',
      toolCalls: [
        {
          id: 'reviewed-memory-search',
          name: 'visit-question-reviewed-memory-search',
          arguments: { query: '지난 진료 기억' },
        },
      ],
      finishReason: 'tool_calls',
    }),
    JSON.stringify({
      type: 'result',
      value: {
        status: 'suggestions',
        questions: [
          {
            questionText:
              '지난 진료에서 확인하기로 한 내용을 다시 물어봐도 될까요?',
            rationale: '검토된 메모에 다음 진료에서 확인할 내용이 있어요.',
            priority: 'routine',
            evidenceIds: [citation.evidenceId],
          },
          {
            questionText:
              '검사 결과 중 자세한 설명이 필요한 부분이 있는지 여쭤봐도 될까요?',
            rationale:
              '이전에 검사 결과를 먼저 확인하기로 한 내용이 기록돼 있어요.',
            priority: 'routine',
            evidenceIds: [citation.evidenceId],
          },
          {
            questionText:
              '결과를 확인한 뒤 다음 진료 전까지 살펴볼 점이 있을까요?',
            rationale:
              '검사 결과를 확인하기로 한 메모를 바탕으로 후속 관찰을 물어요.',
            priority: 'routine',
            evidenceIds: [citation.evidenceId],
          },
        ],
      },
      citations: [citation],
    }),
  ];
  const { provider } = makeProvider(outputs);
  const { selection, option } = selectedOption(provider, 'on-device');
  const searchEvidence = jest.fn(
    (...args: Parameters<typeof prepared.searchEvidence>) =>
      prepared.searchEvidence(...args),
  );

  const result = await runVisitQuestionWorkflow({
    prepared: { ...prepared, searchEvidence },
    selection,
    providerOptions: [option],
  });

  expect(result.status).toBe('ready');
  const searchedEvidence = await searchEvidence.mock.results[0]!.value;
  expect(searchedEvidence.batch.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sourceKind: 'reviewed_memory',
        sourceId: memory.id,
      }),
    ]),
  );
  expect(searchedEvidence.batch.items).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sourceKind: 'reviewed_memory',
        sourceId: 'malformed-memory',
      }),
    ]),
  );
  expect([...searchedEvidence.metadataByCitation.values()]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sourceDates: memory.provenance.sourceDates }),
    ]),
  );
  expect(searchEvidence).toHaveBeenCalledWith(
    '지난 진료 기억',
    expect.any(Number),
    'reviewed_memory',
    expect.any(AbortSignal),
    expect.objectContaining({ store: expect.anything() }),
  );
  expect(storeBatch).toHaveBeenCalledWith([
    expect.objectContaining({
      namespacePrefix: ['agent-memory'],
      query: '지난 진료 기억',
    }),
  ]);
  expect(
    storeBatch.mock.calls
      .flatMap(([operations]) => operations)
      .every(
        operation =>
          typeof operation === 'object' &&
          operation !== null &&
          !('value' in operation),
      ),
  ).toBe(true);
  expect(
    dependencies.queryService.searchMemory.mock.calls.length,
  ).toBeGreaterThanOrEqual(1);
  expect(dependencies.queryService.searchMemory.mock.calls).toEqual(
    expect.arrayContaining([['지난 진료 기억', expect.any(Number)]]),
  );
});
