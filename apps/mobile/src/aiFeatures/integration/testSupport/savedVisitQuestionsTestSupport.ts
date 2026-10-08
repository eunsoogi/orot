import {
  EvidenceSpanSchema,
  SourceRecordSchema,
  TranscriptEvidenceSegmentSchema,
} from '@orot/domain';
import type {
  EvidenceSpan,
  SourceRecord,
  TranscriptEvidenceSegment,
  VisitQuestion,
} from '@orot/domain';
import type { RecordRepository, StaleTranscriptArtifact } from '@orot/storage';
import type { LocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';

const recordedAt = '2026-10-01T09:00:00.000Z';

export function sourceRecord(id: string): SourceRecord {
  return SourceRecordSchema.parse({
    id,
    effectiveAt: recordedAt,
    recordedAt,
    ingestedAt: recordedAt,
    provenance: { origin: 'clinician_recorded', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    sourceKind: 'clinician_note',
    title: '진료 기록',
    contentHash: 'sha256:' + 'a'.repeat(64),
  });
}

export function evidenceSpan(
  id: string,
  sourceRecordId: string,
  transcriptSegmentId?: string,
): EvidenceSpan {
  return EvidenceSpanSchema.parse({
    id,
    effectiveAt: recordedAt,
    recordedAt,
    ingestedAt: recordedAt,
    provenance: transcriptSegmentId
      ? {
          origin: 'derived',
          sourceRecordIds: [sourceRecordId, transcriptSegmentId],
        }
      : {
          origin: 'clinician_recorded',
          sourceRecordIds: [sourceRecordId],
        },
    reviewState: {
      status: 'reviewed',
      reviewerId: 'reviewer-1',
      reviewedAt: recordedAt,
    },
    sourceRecordId,
    text: '최근 진료 기록의 원문 근거',
    locator: { kind: 'text_range', startOffset: 0, endOffset: 15 },
  });
}

function transcriptSegment(
  id: string,
  transcriptId: string,
  recordingSourceId: string,
): TranscriptEvidenceSegment {
  return TranscriptEvidenceSegmentSchema.parse({
    id,
    transcriptId,
    recordingSourceId,
    segmentOrdinal: 0,
    revision: 1,
    text: '상담 녹취 원문',
    language: 'ko-KR',
    recordingDurationMs: 1000,
    audioRange: { startMs: 0, endMs: 1000 },
    effectiveAt: recordedAt,
    recordedAt,
    ingestedAt: recordedAt,
    provenance: {
      origin: 'derived',
      sourceRecordIds: [recordingSourceId],
      source: {
        system: 'Apple Speech',
        sourceIdentifier: 'test-fixture',
        sourceVersion: '1',
      },
    },
    reviewState: { status: 'unreviewed' },
  });
}

export function question(
  id: string,
  appointmentId: string,
  position: number,
  evidenceSpanIds: readonly string[],
  transcriptSegmentId?: string,
): VisitQuestion {
  return {
    id,
    effectiveAt: recordedAt,
    recordedAt,
    ingestedAt: recordedAt,
    provenance: transcriptSegmentId
      ? { origin: 'derived', sourceRecordIds: [transcriptSegmentId] }
      : { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    questionText: '질문 ' + id,
    priority: 'important',
    evidenceSpanIds: [...evidenceSpanIds],
    appointmentId,
    rationale: '근거를 확인할 질문 ' + id,
    position,
  } as VisitQuestion;
}

export function repositories(input: {
  readonly questions: readonly VisitQuestion[];
  readonly spans: readonly EvidenceSpan[];
  readonly sources: readonly SourceRecord[];
  readonly transcriptId?: string;
  readonly staleArtifacts?: readonly StaleTranscriptArtifact[];
}) {
  const spans = new Map(input.spans.map(span => [span.id, span]));
  const sources = new Map(input.sources.map(source => [source.id, source]));
  // Transcript segments have their own table and must not be treated as SourceRecords.
  const transcriptSegments = new Map<string, TranscriptEvidenceSegment>();
  if (input.transcriptId) {
    for (const span of input.spans) {
      for (const id of span.provenance.sourceRecordIds) {
        if (id !== `${input.transcriptId}:r1`) continue;
        transcriptSegments.set(
          id,
          transcriptSegment(id, input.transcriptId, span.sourceRecordId),
        );
      }
    }
  }
  let currentStaleArtifacts = [...(input.staleArtifacts ?? [])];
  const records = {
    get: jest.fn(async (kind: string, id: string) => {
      if (kind === 'transcript_segment')
        return transcriptSegments.get(id) ?? null;
      return null;
    }),
    list: jest.fn(async (kind: string) => {
      if (kind === 'visit_question') return [...input.questions];
      if (kind === 'transcript_segment')
        return [...transcriptSegments.values()];
      return [];
    }),
    evidenceSpans: {
      get: jest.fn(async (id: string) => spans.get(id) ?? null),
    },
    sourceRecords: {
      get: jest.fn(async (id: string) => sources.get(id) ?? null),
    },
    transcripts: {
      listStaleArtifacts: jest.fn(async (transcriptId: string) =>
        transcriptId === input.transcriptId ? [...currentStaleArtifacts] : [],
      ),
    },
  } as unknown as RecordRepository;
  const sourceReader = {
    querySource: jest.fn(async (sourceRecordId: string) => {
      const source = sources.get(sourceRecordId);
      return source
        ? {
            status: 'available' as const,
            sourceRecordId,
            records: [{ kind: 'source_record' as const, record: source }],
            queriedKinds: ['source_record'] as const,
            availableKinds: ['source_record'] as const,
            truncatedKinds: [],
            complete: true,
          }
        : {
            status: 'source_missing' as const,
            sourceRecordId,
            records: [],
            queriedKinds: ['source_record'] as const,
            availableKinds: [],
            truncatedKinds: [],
            complete: true,
          };
    }),
  } as unknown as LocalHealthEvidenceRepository;
  return {
    records,
    sourceReader,
    setCurrentStaleArtifacts(value: readonly StaleTranscriptArtifact[]) {
      // Transcript correction writes invalidation rows without rewriting saved question/span payloads.
      currentStaleArtifacts = [...value];
    },
  };
}

export function staleTranscriptArtifacts(): StaleTranscriptArtifact[] {
  return [
    {
      kind: 'visit_question',
      id: 'question-1',
      supersededSegmentId: 'transcript-1:r1',
      currentSegmentId: 'transcript-1:r2',
      invalidatedAt: '2026-10-01T09:10:00.000Z',
    },
    {
      kind: 'evidence_span',
      id: 'span-1',
      supersededSegmentId: 'transcript-1:r1',
      currentSegmentId: 'transcript-1:r2',
      invalidatedAt: '2026-10-01T09:10:00.000Z',
    },
  ];
}
