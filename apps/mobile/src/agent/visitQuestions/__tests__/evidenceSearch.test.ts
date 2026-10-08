import type { LocalMemoryHit } from '@orot/agent-runtime';
import type { LocalE5RagService } from '../../../rag/localE5RagService';
import type {
  VisitQuestionEvidenceRepository,
  VisitQuestionQueryPort,
} from '../evidenceRevalidation';
import { searchVisitQuestionEvidence } from '../evidenceSearch';

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

async function searchMemoryHits(hits: readonly LocalMemoryHit[]) {
  const searchMemory = jest.fn(async (_query: string, limit = 3) => ({
    status: 'available' as const,
    hits: hits.slice(0, limit),
    limit,
  }));
  const queryService = {
    queryNextConfirmedCalendarAppointment: jest.fn(),
    searchMemory,
  } as unknown as VisitQuestionQueryPort;
  const repository = {} as VisitQuestionEvidenceRepository;
  const rag = {
    index: jest.fn(async () => {}),
    search: jest.fn(async () => []),
  } as unknown as Pick<LocalE5RagService, 'index' | 'search'>;
  const result = await searchVisitQuestionEvidence({
    query: '합성 진료 메모',
    maxEvidenceItems: 5,
    queryService,
    repository,
    rag,
    buildChunks: async () => [],
  });
  return { result, searchMemory };
}

describe('bounded reviewed-memory evidence search', () => {
  it('does not report truncation when the exact one-item result limit has one hit', async () => {
    const { result, searchMemory } = await searchMemoryHits([
      memoryHit('memory-1'),
    ]);
    const memoryCoverage = result.batch.coverage.find(
      coverage => coverage.sourceKind === 'reviewed_memory',
    );

    expect(searchMemory).toHaveBeenCalledWith('합성 진료 메모', 2);
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
});
