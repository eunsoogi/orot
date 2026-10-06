import type { AgentMemoryHit } from '@orot/agent-memory';
import type { EvidenceChunk, HybridEvidenceSearchHit } from '@orot/rag';
import type { RecordKind, RecordRepository } from '@orot/storage';
import {
  localEvidenceFingerprint,
  mapMemoryHitToVisitQuestionEvidence,
  mapRagHitToVisitQuestionEvidence,
} from '../evidence';
import { createVisitQuestionEvidenceCollection } from '../evidenceCollection';

const sourceRecord = {
  id: 'source-1',
  effectiveAt: '2026-09-01T09:00:00Z',
  recordedAt: '2026-09-01T09:00:00Z',
  ingestedAt: '2026-09-01T09:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  sourceKind: 'user_note',
  contentHash: `sha256:${'a'.repeat(64)}`,
};

const evidenceSpan = {
  id: 'span-1',
  effectiveAt: '2026-09-01T09:00:00Z',
  recordedAt: '2026-09-01T09:00:00Z',
  ingestedAt: '2026-09-01T09:00:00Z',
  provenance: { origin: 'derived', sourceRecordIds: ['source-1'] },
  reviewState: {
    status: 'reviewed',
    reviewerId: 'user-1',
    reviewedAt: '2026-09-02T09:00:00Z',
  },
  sourceRecordId: 'source-1',
  text: 'Synthetic measured value',
  locator: { kind: 'text_range', startOffset: 0, endOffset: 23 },
} as const;

const chunk: EvidenceChunk = {
  id: 'rag-1',
  text: 'Synthetic measured value',
  metadata: {
    sourceId: 'source-1',
    sourceRecordIds: ['source-1'],
    evidenceId: 'span-1',
    evidenceLocator: { kind: 'text_range', startOffset: 0, endOffset: 23 },
    effectiveTime: '2026-09-01T09:00:00Z',
    recordType: 'evidence_span',
    reviewState: evidenceSpan.reviewState,
  },
};

const hit: HybridEvidenceSearchHit = {
  chunk,
  score: 1,
  lexicalRank: 1,
  vectorRank: 1,
};

function repository(
  source: unknown = sourceRecord,
): Pick<RecordRepository, 'get'> {
  return {
    async get(kind: RecordKind, id: string) {
      if (kind === 'source_record' && id === sourceRecord.id)
        return source as never;
      if (kind === 'evidence_span' && id === evidenceSpan.id)
        return evidenceSpan as never;
      return null as never;
    },
  };
}

function memoryHit(overrides: Partial<AgentMemoryHit> = {}): AgentMemoryHit {
  return {
    id: 'memory-1',
    text: '사용자가 이전 진료에서 검사 날짜를 먼저 확인하기로 했어요.',
    score: 0.92,
    kind: 'reviewed_interaction',
    provenance: {
      sourceIds: ['source-1'],
      sourceDates: [{ sourceId: 'source-1', date: '2026-09-01T09:00:00Z' }],
      reviewState: 'human_reviewed',
    },
    createdAt: 1791000000000,
    ...overrides,
  };
}

describe('visit question evidence mapping', () => {
  it('fingerprints record payloads deterministically and detects changes', () => {
    expect(localEvidenceFingerprint({ b: 2, a: 1 })).toBe(
      localEvidenceFingerprint({ a: 1, b: 2 }),
    );
    expect(localEvidenceFingerprint({ a: 1 })).not.toBe(
      localEvidenceFingerprint({ a: 2 }),
    );
  });

  it('keeps current RAG evidence linked to its source and evidence-span record', async () => {
    const mapped = await mapRagHitToVisitQuestionEvidence(repository(), hit);

    expect(mapped.item).toMatchObject({
      sourceKind: 'personal_record',
      sourceId: 'source-1',
      sourceRevision: expect.stringMatching(/^local-v1-/),
      evidenceId: 'span-1',
      evidenceRevision: expect.stringMatching(/^local-v1-/),
      reviewState: 'reviewed',
    });
    expect(mapped.metadata).toEqual({
      sourceRecordIds: ['source-1'],
      sourceRecordRevisions: [
        {
          sourceId: 'source-1',
          revision: localEvidenceFingerprint(sourceRecord),
        },
      ],
      sourceDates: [{ sourceId: 'source-1', date: '2026-09-01T09:00:00Z' }],
      recordKind: 'evidence_span',
      evidenceRecordId: 'span-1',
      evidenceSpanId: 'span-1',
    });
  });

  it('rejects RAG evidence whose source record has been deleted', async () => {
    await expect(
      mapRagHitToVisitQuestionEvidence(repository(null), hit),
    ).rejects.toThrow(/source records changed/i);
  });

  it('does not turn Rememori IDs into personal record IDs', () => {
    const mapped = mapMemoryHitToVisitQuestionEvidence(memoryHit());

    expect(mapped?.item).toMatchObject({
      sourceKind: 'reviewed_memory',
      sourceId: 'memory-1',
      evidenceId: 'memory-1',
      reviewState: 'reviewed',
    });
    expect(mapped?.metadata.sourceRecordIds).toEqual(['source-1']);
    expect(mapped?.metadata.evidenceSpanId).toBeUndefined();
  });

  it('drops unlinked memories and bounds the merged sources to the requested limit', async () => {
    const collection = await createVisitQuestionEvidenceCollection({
      repository: repository(),
      recordHits: [hit],
      transcriptHits: [],
      memoryHits: [
        memoryHit(),
        memoryHit({
          id: 'memory-unlinked',
          provenance: { sourceIds: [], reviewState: 'user_confirmed' },
        }),
      ],
      recordResultLimit: 1,
      transcriptResultLimit: 1,
      memoryResultLimit: 2,
      maxEvidenceItems: 1,
    });

    expect(collection.batch.items).toHaveLength(1);
    expect(collection.batch.items[0]?.sourceKind).toBe('personal_record');
    expect(collection.memoryStatus).toBe('available');
    expect(collection.metadataByCitation.size).toBe(1);
  });

  it('keeps current RAG evidence usable when the optional memory store is unavailable', async () => {
    const collection = await createVisitQuestionEvidenceCollection({
      repository: repository(),
      recordHits: [hit],
      transcriptHits: [],
      memoryUnavailable: true,
      recordResultLimit: 2,
      transcriptResultLimit: 1,
      memoryResultLimit: 1,
      maxEvidenceItems: 4,
    });

    expect(collection.memoryStatus).toBe('local_memory_unavailable');
    expect(collection.batch.items.map(item => item.sourceKind)).toEqual([
      'personal_record',
    ]);
    expect(collection.batch.coverage).toEqual([
      expect.objectContaining({
        sourceKind: 'personal_record',
        gaps: [],
        truncated: false,
        returnedCount: 1,
      }),
    ]);
  });

  it('treats an available memory search with no hits as a complete negative result', async () => {
    const collection = await createVisitQuestionEvidenceCollection({
      repository: repository(),
      recordHits: [hit],
      transcriptHits: [],
      memoryHits: [],
      recordResultLimit: 2,
      transcriptResultLimit: 1,
      memoryResultLimit: 1,
      maxEvidenceItems: 4,
    });

    expect(collection.memoryStatus).toBe('no_matching_current_memory');
    expect(collection.batch.coverage).toEqual([
      expect.objectContaining({
        sourceKind: 'personal_record',
        gaps: [],
        truncated: false,
        returnedCount: 1,
      }),
      expect.objectContaining({
        sourceKind: 'reviewed_memory',
        gaps: [],
        truncated: false,
        returnedCount: 0,
      }),
    ]);
  });
});
