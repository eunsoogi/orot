import type {
  EvidenceSpan,
  EvidenceSpanLocator,
  ReviewState,
  TranscriptEvidenceSegment,
} from '@orot/domain';
import type { RecordMap } from '@orot/storage';

export const STRUCTURED_RECORD_KINDS = [
  'appointment',
  'encounter',
  'health_observation',
  'medication_assertion',
  'medication_definition',
  'dose_event',
  'symptom_entry',
] as const;

export type StructuredRecordKind = (typeof STRUCTURED_RECORD_KINDS)[number];
export type ChunkRecordType = StructuredRecordKind | 'evidence_span' | 'transcript_segment';

export type ChunkEvidenceLocator =
  EvidenceSpanLocator | { kind: 'structured_record'; recordId: string };

export interface TranscriptRevisionMetadata {
  readonly transcriptId: string;
  readonly segmentOrdinal: number;
  readonly revision: number;
  readonly supersedesId?: string;
}

export interface EvidenceChunkMetadata {
  readonly sourceId: string;
  readonly sourceRecordIds: readonly string[];
  readonly evidenceId: string;
  readonly evidenceLocator: ChunkEvidenceLocator;
  readonly effectiveTime: string | null;
  readonly recordType: ChunkRecordType;
  readonly reviewState: ReviewState;
  // Store only explicit encounter links; provenance source IDs are not encounter relationships.
  readonly encounterId?: string;
  readonly transcriptRevision?: TranscriptRevisionMetadata;
}

export interface EvidenceChunk {
  readonly id: string;
  readonly text: string;
  readonly metadata: EvidenceChunkMetadata;
}

function hash32(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return hash >>> 0;
}

// IDs hash stable record identity rather than text or revision so corrections can replace a chunk without exposing its contents.
function chunkId(recordType: ChunkRecordType, sourceId: string, evidenceId: string): string {
  const identity = JSON.stringify([recordType, sourceId, evidenceId]);
  const first = hash32(identity, 0x811c9dc5).toString(16).padStart(8, '0');
  const second = hash32(identity, 0x9e3779b9).toString(16).padStart(8, '0');
  return 'rag-v1-' + first + second;
}

export function chunkTranscriptSegment(segment: TranscriptEvidenceSegment): EvidenceChunk {
  return {
    id: chunkId('transcript_segment', segment.recordingSourceId, segment.transcriptId),
    text: segment.text,
    metadata: {
      sourceId: segment.recordingSourceId,
      sourceRecordIds: [...segment.provenance.sourceRecordIds],
      evidenceId: segment.id,
      evidenceLocator: {
        kind: 'audio_time_range',
        startMs: segment.audioRange.startMs,
        endMs: segment.audioRange.endMs,
      },
      effectiveTime: segment.effectiveAt,
      recordType: 'transcript_segment',
      reviewState: { ...segment.reviewState },
      transcriptRevision: {
        transcriptId: segment.transcriptId,
        segmentOrdinal: segment.segmentOrdinal,
        revision: segment.revision,
        ...(segment.supersedesId ? { supersedesId: segment.supersedesId } : {}),
      },
    },
  };
}

export function chunkEvidenceSpan(span: EvidenceSpan): EvidenceChunk {
  if (!span.locator) {
    throw new Error('Evidence spans need a source locator before they can be chunked.');
  }

  return {
    id: chunkId('evidence_span', span.sourceRecordId, span.id),
    text: span.text,
    metadata: {
      sourceId: span.sourceRecordId,
      sourceRecordIds: [...span.provenance.sourceRecordIds],
      evidenceId: span.id,
      evidenceLocator: { ...span.locator },
      effectiveTime: span.effectiveAt,
      recordType: 'evidence_span',
      reviewState: { ...span.reviewState },
    },
  };
}

const METADATA_FIELDS = new Set([
  'id',
  'effectiveAt',
  'recordedAt',
  'ingestedAt',
  'provenance',
  'reviewState',
]);

function stableJson(value: unknown): string {
  return (
    JSON.stringify(value, (_, current: unknown) => {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return current;
      const object = current as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(object)
          .sort()
          .map((key) => [key, object[key]]),
      );
    }) ?? 'null'
  );
}

// Structured values stay in one record chunk so medication names, quantities, and units retain their source relationship.
export function chunkStructuredRecord<K extends StructuredRecordKind>(
  recordType: K,
  record: RecordMap[K],
): EvidenceChunk {
  const sourceRecordIds = [...record.provenance.sourceRecordIds];
  const sourceId = sourceRecordIds[0] ?? record.id;
  const content = Object.fromEntries(
    Object.entries(record).filter(([key]) => !METADATA_FIELDS.has(key)),
  );
  const effectiveTime =
    'effectiveAt' in record && typeof record.effectiveAt === 'string' ? record.effectiveAt : null;
  const encounterId =
    recordType === 'encounter'
      ? record.id
      : 'encounterId' in record && typeof record.encounterId === 'string'
        ? record.encounterId
        : undefined;

  return {
    id: chunkId(recordType, sourceId, record.id),
    text: recordType + ': ' + stableJson(content),
    metadata: {
      sourceId,
      sourceRecordIds,
      evidenceId: record.id,
      evidenceLocator: { kind: 'structured_record', recordId: record.id },
      effectiveTime,
      recordType,
      reviewState: { ...record.reviewState },
      ...(encounterId ? { encounterId } : {}),
    },
  };
}
