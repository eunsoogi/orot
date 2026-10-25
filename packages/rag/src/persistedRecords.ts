// Read persisted evidence through repository APIs and honor transcript invalidation without mutating source records.
import type { RecordKind, RecordRepository } from '@orot/storage';
import {
  chunkEvidenceSpan,
  chunkStructuredRecord,
  chunkTranscriptSegment,
  STRUCTURED_RECORD_KINDS,
} from './chunking';
import type { EvidenceChunk, StructuredRecordKind } from './chunking';

export type PersistedEvidenceReader = Pick<RecordRepository, 'list'> & {
  evidenceSpans: Pick<RecordRepository['evidenceSpans'], 'listForSourceRecord'>;
  transcripts: Pick<RecordRepository['transcripts'], 'listForRecording' | 'listStaleArtifacts'>;
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function recordKey(kind: RecordKind, id: string): string {
  return kind + '\u0000' + id;
}

function latestTranscriptRevisions(
  segments: Awaited<ReturnType<RecordRepository['transcripts']['listForRecording']>>,
) {
  const latest = new Map<string, (typeof segments)[number]>();
  for (const segment of segments) {
    const current = latest.get(segment.transcriptId);
    if (!current || segment.revision > current.revision) {
      latest.set(segment.transcriptId, segment);
    } else if (segment.revision === current.revision && segment.id !== current.id) {
      throw new Error('A transcript segment has conflicting records for the same revision.');
    }
  }
  return [...latest.values()].sort(
    (left, right) =>
      compareText(left.recordingSourceId, right.recordingSourceId) ||
      left.audioRange.startMs - right.audioRange.startMs ||
      left.segmentOrdinal - right.segmentOrdinal ||
      compareText(left.transcriptId, right.transcriptId),
  );
}

async function readStaleArtifactKeys(
  reader: PersistedEvidenceReader,
  transcriptIds: readonly string[],
): Promise<Set<string>> {
  const staleArtifacts = await Promise.all(
    transcriptIds.map((transcriptId) => reader.transcripts.listStaleArtifacts(transcriptId)),
  );
  return new Set(staleArtifacts.flat().map((artifact) => recordKey(artifact.kind, artifact.id)));
}

function compareChunks(left: EvidenceChunk, right: EvidenceChunk): number {
  return (
    compareText(left.metadata.recordType, right.metadata.recordType) ||
    compareText(left.metadata.sourceId, right.metadata.sourceId) ||
    compareText(left.metadata.evidenceId, right.metadata.evidenceId)
  );
}

export async function buildPersistedEvidenceChunks(
  reader: PersistedEvidenceReader,
): Promise<EvidenceChunk[]> {
  const sourceRecords = await reader.list('source_record');
  const sourceEvidence = await Promise.all(
    sourceRecords.map(async (source) => {
      const [spans, segments] = await Promise.all([
        reader.evidenceSpans.listForSourceRecord(source.id),
        source.sourceKind === 'audio_recording'
          ? reader.transcripts.listForRecording(source.id)
          : Promise.resolve([]),
      ]);
      return { spans, segments };
    }),
  );
  const allSegments = sourceEvidence.flatMap((items) => items.segments);
  const transcriptIds = [...new Set(allSegments.map((segment) => segment.transcriptId))].sort(
    compareText,
  );
  const [staleKeys, structuredRecords] = await Promise.all([
    readStaleArtifactKeys(reader, transcriptIds),
    Promise.all(
      STRUCTURED_RECORD_KINDS.map(async (kind) => ({
        kind,
        records: await reader.list(kind),
      })),
    ),
  ]);

  const chunks: EvidenceChunk[] = [];
  for (const segment of latestTranscriptRevisions(allSegments)) {
    chunks.push(chunkTranscriptSegment(segment));
  }
  for (const { spans } of sourceEvidence) {
    for (const span of spans) {
      if (!staleKeys.has(recordKey('evidence_span', span.id))) {
        chunks.push(chunkEvidenceSpan(span));
      }
    }
  }
  for (const { kind, records } of structuredRecords) {
    for (const record of records) {
      if (staleKeys.has(recordKey(kind, record.id))) continue;
      chunks.push(chunkStructuredRecord(kind as StructuredRecordKind, record));
    }
  }
  return chunks.sort(compareChunks);
}
