import { EvidenceSpanSchema, SourceRecordSchema } from '@orot/domain';
import type { EvidenceSpan, SourceRecord, VisitQuestion } from '@orot/domain';
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
  let currentStaleArtifacts = [...(input.staleArtifacts ?? [])];
  const records = {
    list: jest.fn(async (kind: string) => {
      if (kind === 'visit_question') return [...input.questions];
      if (kind === 'transcript_segment' && input.transcriptId) {
        return [{ transcriptId: input.transcriptId }];
      }
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
      supersededSegmentId: 'segment-1:r1',
      currentSegmentId: 'segment-1:r2',
      invalidatedAt: '2026-10-01T09:10:00.000Z',
    },
    {
      kind: 'evidence_span',
      id: 'span-1',
      supersededSegmentId: 'segment-1:r1',
      currentSegmentId: 'segment-1:r2',
      invalidatedAt: '2026-10-01T09:10:00.000Z',
    },
  ];
}
