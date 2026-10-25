import type { VisitQuestion } from '@orot/domain';
import type {
  RecordKind,
  RecordRepository,
  StaleTranscriptArtifact,
} from '@orot/storage';

export type StaleEvidenceArtifact = Pick<
  StaleTranscriptArtifact,
  'kind' | 'id'
>;

/** Reads transcript-scoped invalidation rows because corrections leave saved payload rows unchanged. */
export async function readCurrentTranscriptInvalidations(
  records: RecordRepository,
): Promise<readonly StaleEvidenceArtifact[]> {
  const segments = await records.list('transcript_segment');
  const transcriptIds = [
    ...new Set(segments.map(segment => segment.transcriptId)),
  ];
  const artifacts = await Promise.all(
    transcriptIds.map(transcriptId =>
      records.transcripts.listStaleArtifacts(transcriptId),
    ),
  );
  return artifacts.flat().map(({ kind, id }) => ({ kind, id }));
}

export function isTranscriptArtifactStale(
  artifacts: readonly StaleEvidenceArtifact[],
  kind: RecordKind,
  id: string,
): boolean {
  return artifacts.some(
    artifact => artifact.kind === kind && artifact.id === id,
  );
}

export function hasStaleVisitQuestionEvidence(
  artifacts: readonly StaleEvidenceArtifact[],
  question: Pick<VisitQuestion, 'id' | 'evidenceSpanIds'>,
): boolean {
  return (
    isTranscriptArtifactStale(artifacts, 'visit_question', question.id) ||
    question.evidenceSpanIds.some(id =>
      isTranscriptArtifactStale(artifacts, 'evidence_span', id),
    )
  );
}

export async function isCurrentTranscriptArtifactStale(
  records: RecordRepository,
  kind: RecordKind,
  id: string,
): Promise<boolean> {
  return isTranscriptArtifactStale(
    await readCurrentTranscriptInvalidations(records),
    kind,
    id,
  );
}
