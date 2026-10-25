import { TimestampSchema, type ReviewState } from '@orot/domain';
import { LocalEmbeddingJobError } from './localEmbeddings';
import type { ChunkRecordType, EvidenceChunk } from './chunking';

export interface EvidenceSearchFilters {
  readonly timeRange?: {
    /** Inclusive effective-time lower bound. */
    readonly start?: string;
    /** Inclusive effective-time upper bound. */
    readonly end?: string;
  };
  readonly recordTypes?: readonly ChunkRecordType[];
  readonly encounterId?: string;
  readonly reviewStates?: readonly ReviewState['status'][];
}

function parseBound(value: string, name: 'start' | 'end'): number {
  const parsed = TimestampSchema.safeParse(value);
  if (!parsed.success) {
    throw new LocalEmbeddingJobError(
      'invalid_request',
      `The time-range ${name} must be an ISO timestamp with an explicit offset.`,
    );
  }
  return Date.parse(parsed.data);
}

function timeRangeFor(filters?: EvidenceSearchFilters) {
  const range = filters?.timeRange;
  if (!range || (range.start === undefined && range.end === undefined)) return undefined;

  const start = range.start === undefined ? undefined : parseBound(range.start, 'start');
  const end = range.end === undefined ? undefined : parseBound(range.end, 'end');
  if (start !== undefined && end !== undefined && start > end) {
    throw new LocalEmbeddingJobError(
      'invalid_request',
      'The time-range start must not be after its end.',
    );
  }
  return { start, end };
}

/** Filters before ranking so excluded evidence cannot consume lexical or vector rank positions. */
export function filterEvidenceChunks(
  chunks: readonly EvidenceChunk[],
  filters?: EvidenceSearchFilters,
): EvidenceChunk[] {
  const range = timeRangeFor(filters);
  return chunks.filter((chunk) => {
    if (range) {
      if (chunk.metadata.effectiveTime === null) return false;
      const effectiveTime = Date.parse(chunk.metadata.effectiveTime);
      if (!Number.isFinite(effectiveTime)) return false;
      if (range.start !== undefined && effectiveTime < range.start) return false;
      if (range.end !== undefined && effectiveTime > range.end) return false;
    }
    if (filters?.recordTypes && !filters.recordTypes.includes(chunk.metadata.recordType)) {
      return false;
    }
    if (filters?.encounterId && chunk.metadata.encounterId !== filters.encounterId) {
      return false;
    }
    if (
      filters?.reviewStates &&
      !filters.reviewStates.includes(chunk.metadata.reviewState.status)
    ) {
      return false;
    }
    return true;
  });
}
