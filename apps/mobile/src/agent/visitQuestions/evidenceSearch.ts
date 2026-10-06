import { LOCAL_MEMORY_MAX_RESULTS } from '@orot/agent-runtime';
import type { LocalMemoryHit } from '@orot/agent-runtime';
import type { HybridSearchOptions } from '@orot/rag';
import { buildPersistedEvidenceChunks } from '@orot/rag';
import type { LocalE5RagService } from '../../rag/localE5RagService';
import {
  createVisitQuestionEvidenceCollection,
  type VisitQuestionEvidenceCollection,
} from './evidenceCollection';
import { visitQuestionEvidenceIdentityKey } from './evidenceAliases';
import type {
  VisitQuestionEvidenceRepository,
  VisitQuestionQueryPort,
  VisitQuestionChunkBuilder,
} from './evidenceRevalidation';

export type VisitQuestionSearchSource = 'personal_record' | 'reviewed_memory';
type VisitQuestionRagPort = Pick<LocalE5RagService, 'index' | 'search'>;

const PERSONAL_RECORD_TYPES = [
  'encounter',
  'health_observation',
  'medication_assertion',
  'medication_definition',
  'dose_event',
  'symptom_entry',
  'evidence_span',
] as const;

/** Splits one shared evidence budget across the three local source families. */
export function visitQuestionEvidenceLimits(maxEvidenceItems: number) {
  if (!Number.isInteger(maxEvidenceItems) || maxEvidenceItems < 3) {
    throw new Error(
      'Visit-question evidence budget must allow one result per local source family.',
    );
  }
  const transcriptResultLimit = Math.min(
    2,
    Math.max(1, Math.floor(maxEvidenceItems / 4)),
  );
  const memoryResultLimit = Math.min(
    2,
    Math.max(1, Math.floor(maxEvidenceItems / 4)),
  );
  return {
    recordResultLimit:
      maxEvidenceItems - transcriptResultLimit - memoryResultLimit,
    transcriptResultLimit,
    memoryResultLimit,
  };
}

/** Runs one bounded local search; supplemental tools expose exactly one source kind. */
export async function searchVisitQuestionEvidence(input: {
  readonly query: string;
  readonly maxEvidenceItems: number;
  readonly sourceKind?: VisitQuestionSearchSource;
  readonly queryService: VisitQuestionQueryPort;
  readonly repository: VisitQuestionEvidenceRepository;
  readonly rag: VisitQuestionRagPort;
  readonly buildChunks?: VisitQuestionChunkBuilder;
  readonly signal?: AbortSignal;
}): Promise<VisitQuestionEvidenceCollection> {
  if (input.signal?.aborted) throw new Error('Evidence search was cancelled.');
  const sourceKind = input.sourceKind;
  const limits =
    sourceKind === 'reviewed_memory'
      ? {
          recordResultLimit: 1,
          transcriptResultLimit: 1,
          memoryResultLimit: Math.min(
            input.maxEvidenceItems,
            LOCAL_MEMORY_MAX_RESULTS,
          ),
        }
      : visitQuestionEvidenceLimits(input.maxEvidenceItems);
  const buildChunks = input.buildChunks ?? buildPersistedEvidenceChunks;
  let recordHits = [] as Awaited<ReturnType<LocalE5RagService['search']>>;
  let transcriptHits = [] as Awaited<ReturnType<LocalE5RagService['search']>>;
  const readReviewedMemory = async () => {
    try {
      const memory = await input.queryService.searchMemory(
        input.query,
        limits.memoryResultLimit,
      );
      return {
        hits: memory.hits,
        unavailable: memory.status === 'local_memory_unavailable',
      };
    } catch {
      return { hits: [] as readonly LocalMemoryHit[], unavailable: true };
    }
  };
  let memoryPromise: ReturnType<typeof readReviewedMemory> | undefined;

  if (sourceKind !== 'reviewed_memory') {
    const chunks = await buildChunks(input.repository);
    if (input.signal?.aborted)
      throw new Error('Evidence search was cancelled.');
    await input.rag.index(chunks);
    if (sourceKind !== 'personal_record') {
      // Start independent on-device memory and RAG reads together after indexing.
      memoryPromise = readReviewedMemory();
    }
    const recordFilters: HybridSearchOptions = {
      filters: { recordTypes: PERSONAL_RECORD_TYPES },
    };
    const transcriptFilters: HybridSearchOptions = {
      filters: { recordTypes: ['transcript_segment'] },
    };
    [recordHits, transcriptHits] = await Promise.all([
      input.rag.search(
        input.query,
        chunks,
        limits.recordResultLimit,
        recordFilters,
      ),
      input.rag.search(
        input.query,
        chunks,
        limits.transcriptResultLimit,
        transcriptFilters,
      ),
    ]);
  } else {
    memoryPromise = readReviewedMemory();
  }
  if (input.signal?.aborted) throw new Error('Evidence search was cancelled.');

  const memoryResult = memoryPromise
    ? await memoryPromise
    : { hits: [] as readonly LocalMemoryHit[], unavailable: true };
  const memoryHits = memoryResult.hits;
  const memoryUnavailable = memoryResult.unavailable;
  const memoryWasQueried = sourceKind !== 'personal_record';
  if (input.signal?.aborted) throw new Error('Evidence search was cancelled.');

  const collection = await createVisitQuestionEvidenceCollection({
    repository: input.repository,
    recordHits,
    transcriptHits,
    memoryHits,
    memoryUnavailable,
    ...(memoryWasQueried && !memoryUnavailable
      ? { memorySearchQuery: input.query }
      : {}),
    ...limits,
    maxEvidenceItems: input.maxEvidenceItems,
  });
  if (!sourceKind) return collection;

  const items = collection.batch.items.filter(
    item => item.sourceKind === sourceKind,
  );
  const keys = new Set(items.map(visitQuestionEvidenceIdentityKey));
  const metadataByCitation = new Map(
    [...collection.metadataByCitation].filter(([key]) => keys.has(key)),
  );
  const coverage = collection.batch.coverage.filter(
    item => item.sourceKind === sourceKind,
  );

  // An unavailable memory reader still returns typed coverage so the shared runtime fails closed.
  if (sourceKind === 'reviewed_memory' && memoryUnavailable) {
    return {
      ...collection,
      batch: {
        items,
        coverage: [
          {
            sourceKind: 'reviewed_memory',
            searchedSourceIds: [],
            gaps: ['Local reviewed memory was unavailable for this search.'],
            truncated: false,
            resultLimit: limits.memoryResultLimit,
            returnedCount: 0,
          },
        ],
        conflicts: [],
      },
      metadataByCitation,
    };
  }

  return {
    ...collection,
    batch: {
      items,
      coverage,
      conflicts:
        sourceKind === 'personal_record' ? collection.batch.conflicts : [],
    },
    metadataByCitation,
  };
}
