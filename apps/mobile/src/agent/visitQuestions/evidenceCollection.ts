import type { LocalMemoryHit } from '@orot/agent-runtime';
import { compareTimestamps } from '@orot/domain';
import type { RecordRepository } from '@orot/storage';
import type { HybridEvidenceSearchHit } from '@orot/rag';
import {
  mapMemoryHitToVisitQuestionEvidence,
  mapRagHitToVisitQuestionEvidence,
  visitQuestionCitationKey,
} from './evidence';
import type { VisitQuestionEvidenceMetadata } from './evidence';
import type { VisitQuestionEvidenceBatch } from './taskContract';

export interface VisitQuestionEvidenceCollection {
  readonly batch: VisitQuestionEvidenceBatch;
  readonly metadataByCitation: ReadonlyMap<
    string,
    VisitQuestionEvidenceMetadata
  >;
  readonly memoryStatus:
    'available' | 'no_matching_current_memory' | 'local_memory_unavailable';
}

function hasConflictingHealthObservations(
  values: readonly {
    readonly metadata: VisitQuestionEvidenceMetadata;
  }[],
): boolean {
  const facts = values.flatMap(value =>
    value.metadata.healthObservationConflict
      ? [value.metadata.healthObservationConflict]
      : [],
  );
  for (let leftIndex = 0; leftIndex < facts.length; leftIndex += 1) {
    const left = facts[leftIndex]!;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < facts.length;
      rightIndex += 1
    ) {
      const right = facts[rightIndex]!;
      if (
        left.conceptKey === right.conceptKey &&
        left.valueFingerprint !== right.valueFingerprint &&
        compareTimestamps(left.effectiveAt, right.effectiveAt) === 0
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Keeps RAG, transcript, and reviewed Rememori hits inside one bounded evidence budget. */
export async function createVisitQuestionEvidenceCollection(input: {
  readonly repository: Pick<RecordRepository, 'get'>;
  readonly recordHits: readonly HybridEvidenceSearchHit[];
  readonly transcriptHits: readonly HybridEvidenceSearchHit[];
  readonly memoryHits?: readonly LocalMemoryHit[];
  readonly memoryUnavailable?: boolean;
  readonly recordResultLimit: number;
  readonly transcriptResultLimit: number;
  readonly memoryResultLimit: number;
  readonly maxEvidenceItems: number;
}): Promise<VisitQuestionEvidenceCollection> {
  if (
    !Number.isInteger(input.maxEvidenceItems) ||
    input.maxEvidenceItems < 1 ||
    !Number.isInteger(input.recordResultLimit) ||
    input.recordResultLimit < 1 ||
    !Number.isInteger(input.transcriptResultLimit) ||
    input.transcriptResultLimit < 1 ||
    !Number.isInteger(input.memoryResultLimit) ||
    input.memoryResultLimit < 1
  ) {
    throw new Error('Visit-question evidence needs a positive item limit.');
  }

  const mappedRecords = await Promise.all(
    input.recordHits.map(hit =>
      mapRagHitToVisitQuestionEvidence(input.repository, hit),
    ),
  );
  const mappedTranscripts = await Promise.all(
    input.transcriptHits.map(hit =>
      mapRagHitToVisitQuestionEvidence(input.repository, hit),
    ),
  );
  const mappedMemories = (input.memoryHits ?? [])
    .map(mapMemoryHitToVisitQuestionEvidence)
    .filter((value): value is NonNullable<typeof value> => value !== null);

  const candidates = [
    ...mappedRecords,
    ...mappedTranscripts,
    ...mappedMemories,
  ];
  const hasConflict = hasConflictingHealthObservations([
    ...mappedRecords,
    ...mappedTranscripts,
  ]);
  const seen = new Set<string>();
  const selected = candidates.filter(({ item }) => {
    const key = visitQuestionCitationKey(item);
    if (seen.has(key) || seen.size >= input.maxEvidenceItems) return false;
    seen.add(key);
    return true;
  });
  const items = selected.map(value => value.item);
  const metadataByCitation = new Map(
    selected.map(value => [
      visitQuestionCitationKey(value.item),
      value.metadata,
    ]),
  );
  const recordItems = items.filter(
    item => item.sourceKind === 'personal_record',
  );
  const memoryItems = items.filter(
    item => item.sourceKind === 'reviewed_memory',
  );
  const memoryStatus = input.memoryUnavailable
    ? 'local_memory_unavailable'
    : mappedMemories.length > 0
      ? 'available'
      : 'no_matching_current_memory';

  return {
    batch: {
      items,
      conflicts: hasConflict
        ? [
            'Conflicting health observation values exist for the same concept and time.',
          ]
        : [],
      coverage: [
        {
          sourceKind: 'personal_record',
          searchedSourceIds: [
            ...new Set(recordItems.map(item => item.sourceId)),
          ],
          gaps:
            recordItems.length > 0
              ? []
              : ['No current RAG evidence matched the visit context.'],
          truncated:
            input.recordHits.length >= input.recordResultLimit ||
            input.transcriptHits.length >= input.transcriptResultLimit ||
            input.recordHits.length + input.transcriptHits.length >
              recordItems.length,
          resultLimit: input.recordResultLimit + input.transcriptResultLimit,
          returnedCount: recordItems.length,
        },
        ...(memoryStatus === 'local_memory_unavailable'
          ? []
          : [
              {
                sourceKind: 'reviewed_memory' as const,
                searchedSourceIds: [
                  ...new Set(memoryItems.map(item => item.sourceId)),
                ],
                // A completed search with no matching memory is a known empty result, not a gap.
                gaps: [],
                truncated:
                  (input.memoryHits?.length ?? 0) >= input.memoryResultLimit,
                resultLimit: input.memoryResultLimit,
                returnedCount: memoryItems.length,
              },
            ]),
      ],
    },
    metadataByCitation,
    memoryStatus,
  };
}
