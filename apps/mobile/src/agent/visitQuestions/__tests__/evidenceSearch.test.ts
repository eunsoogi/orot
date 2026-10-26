import type { LocalMemoryHit } from '@orot/agent-runtime';
import type { EvidenceSearchRuntime } from '@orot/agent-runtime';
import { AGENT_MEMORY_NAMESPACE } from '@orot/agent-memory';
import type { LocalE5RagService } from '../../../rag/localE5RagService';
import type { VisitQuestionEvidenceRepository } from '../evidenceRevalidation';
import { searchVisitQuestionEvidence } from '../evidenceSearch';
import type { VisitQuestionSearchSource } from '../evidenceSearch';
import { createVisitQuestionEvidenceSearchTools } from '../evidenceTools';
import { createVisitQuestionEvidenceAliases } from '../evidenceAliases';

function memoryHit(id: string): LocalMemoryHit {
  return {
    id,
    text: `합성 검토 메모 ${id}`,
    score: 1,
    kind: 'reviewed_interaction',
    provenance: { sourceIds: ['source-1'], reviewState: 'human_reviewed' },
    createdAt: Date.parse('2026-10-01T00:00:00Z'),
  };
}

function storeForHits(hits: readonly LocalMemoryHit[]) {
  const items = hits.map((hit, index) => ({
    key: `memory-key-${index}`,
    namespace: [...AGENT_MEMORY_NAMESPACE],
    value: { ...hit, memoryKey: `memory-key-${index}` },
    score: hit.score,
    createdAt: new Date(hit.createdAt),
    updatedAt: new Date(hit.createdAt),
  }));
  return {
    search: jest.fn(
      async (_namespace: readonly string[], options?: { limit?: number }) =>
        items.slice(0, options?.limit ?? items.length),
    ),
  } as unknown as NonNullable<EvidenceSearchRuntime['store']>;
}

async function searchMemoryHits(hits: readonly LocalMemoryHit[]) {
  const store = storeForHits(hits);
  const repository = {} as VisitQuestionEvidenceRepository;
  const rag = {
    index: jest.fn(async () => {}),
    search: jest.fn(async () => []),
  } as unknown as Pick<LocalE5RagService, 'index' | 'search'>;
  const result = await searchVisitQuestionEvidence({
    query: '합성 진료 메모',
    maxEvidenceItems: 5,
    store,
    repository,
    rag,
    buildChunks: async () => [],
  });
  return { result, store };
}

describe('bounded reviewed-memory evidence search', () => {
  it.each([1, 2])(
    'forwards the final %i slots through the model tool boundary',
    async limit => {
      const batch = { items: [], coverage: [], conflicts: [] };
      const searchEvidence = jest.fn(async () => ({
        batch,
        metadataByCitation: new Map(),
        memoryStatus: 'not_searched' as const,
      }));
      const tools = createVisitQuestionEvidenceSearchTools({
        aliases: createVisitQuestionEvidenceAliases(batch),
        searchEvidence,
        initialEvidenceCount: 0,
        maxEvidenceItems: 8,
      });
      const signal = new AbortController().signal;
      await tools[0]!.search({
        operationRunId: 'run',
        operationKey: 'search',
        input: { query: '합성 기록' },
        allowedScope: { sourceKinds: ['personal_record'] },
        resultLimit: limit,
        maxPayloadBytes: 10000,
        signal,
      });
      expect(searchEvidence).toHaveBeenCalledWith(
        '합성 기록',
        limit,
        'personal_record',
        signal,
      );
    },
  );
  it('passes the graph Store into the reviewed-memory search adapter', async () => {
    const hit = memoryHit('memory-1');
    const store = storeForHits([hit]);
    const repository = {} as VisitQuestionEvidenceRepository;
    const rag = {
      index: jest.fn(async () => {}),
      search: jest.fn(async () => []),
    } as unknown as Pick<LocalE5RagService, 'index' | 'search'>;
    const searchEvidence = jest.fn(
      async (
        query: string,
        maxEvidenceItems: number,
        sourceKind: VisitQuestionSearchSource,
        signal: AbortSignal,
        runtime?: EvidenceSearchRuntime,
      ) =>
        searchVisitQuestionEvidence({
          query,
          maxEvidenceItems,
          sourceKind,
          store: runtime?.store,
          repository,
          rag,
          buildChunks: async () => [],
          signal,
        }),
    );
    const tools = createVisitQuestionEvidenceSearchTools({
      aliases: createVisitQuestionEvidenceAliases({
        items: [],
        coverage: [],
        conflicts: [],
      }),
      searchEvidence,
      initialEvidenceCount: 0,
      maxEvidenceItems: 5,
    });
    const tool = tools.find(
      candidate => candidate.sourceKind === 'reviewed_memory',
    )!;
    const result = await tool.search(
      {
        operationRunId: 'run',
        operationKey: 'search',
        input: { query: 'private memory query' },
        allowedScope: { sourceKinds: ['reviewed_memory'] },
        resultLimit: 2,
        maxPayloadBytes: 10000,
        signal: new AbortController().signal,
      },
      { store },
    );

    expect(result).toMatchObject({
      items: [expect.objectContaining({ sourceKind: 'reviewed_memory' })],
    });
    expect(store.search).toHaveBeenCalledWith(
      AGENT_MEMORY_NAMESPACE,
      expect.objectContaining({ query: 'private memory query' }),
    );
  });
  it.each([1, 2])(
    'searches personal evidence with only %i remaining slots',
    async limit => {
      const search = jest.fn(async () => []);
      const result = await searchVisitQuestionEvidence({
        query: '합성 진료',
        maxEvidenceItems: limit,
        sourceKind: 'personal_record',
        repository: {} as VisitQuestionEvidenceRepository,
        rag: { index: jest.fn(async () => {}), search },
        buildChunks: async () => [],
      });
      expect(search).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledWith(
        '합성 진료',
        [],
        limit + 1,
        expect.objectContaining({
          filters: {
            recordTypes: expect.arrayContaining([
              'health_observation',
              'transcript_segment',
            ]),
          },
        }),
      );
      expect(result.batch.coverage[0]).toMatchObject({
        resultLimit: limit,
        returnedCount: 0,
      });
    },
  );
  it('does not report truncation when the exact one-item result limit has one hit', async () => {
    const { result, store } = await searchMemoryHits([memoryHit('memory-1')]);
    const memoryCoverage = result.batch.coverage.find(
      coverage => coverage.sourceKind === 'reviewed_memory',
    );

    expect(store.search).toHaveBeenCalledWith(
      AGENT_MEMORY_NAMESPACE,
      expect.objectContaining({ query: '합성 진료 메모', limit: 2 }),
    );
    expect(result.batch.items).toHaveLength(1);
    expect(memoryCoverage).toMatchObject({
      resultLimit: 1,
      returnedCount: 1,
      truncated: false,
    });
  });

  it('keeps a second hit bounded while reporting a confirmed over-limit result', async () => {
    const { result } = await searchMemoryHits([
      memoryHit('memory-1'),
      memoryHit('memory-2'),
    ]);
    const memoryCoverage = result.batch.coverage.find(
      coverage => coverage.sourceKind === 'reviewed_memory',
    );

    expect(result.batch.items).toHaveLength(1);
    expect(memoryCoverage).toMatchObject({
      resultLimit: 1,
      returnedCount: 1,
      truncated: true,
    });
  });

  it('returns typed unavailable coverage when the graph Store is absent', async () => {
    const result = await searchVisitQuestionEvidence({
      query: 'private memory query',
      maxEvidenceItems: 2,
      sourceKind: 'reviewed_memory',
      repository: {} as VisitQuestionEvidenceRepository,
      rag: {
        index: jest.fn(async () => {}),
        search: jest.fn(async () => []),
      } as unknown as Pick<LocalE5RagService, 'index' | 'search'>,
      buildChunks: async () => [],
    });

    expect(result.memoryStatus).toBe('local_memory_unavailable');
    expect(result.batch.coverage).toEqual([
      expect.objectContaining({
        sourceKind: 'reviewed_memory',
        returnedCount: 0,
        gaps: expect.any(Array),
      }),
    ]);
  });
});
