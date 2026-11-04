import { assertGeneratedVisitQuestionSource } from './generatedVisitQuestionValidation';
import { readVisitEvidenceSnapshots } from './evidenceSourceSnapshots';
import type { TranscriptEvidenceSegment } from '@orot/domain';
import type { RecordWriter, SqlExecutor } from '@orot/storage';
import { localEvidenceFingerprint, visitQuestionCitationKey } from './evidence';
import { hasUnsupportedDateOrValue } from './questionFacts';
import type { VisitQuestionEvidenceMetadata } from './evidence';
import type { VisitQuestionEvidenceCollection } from './evidenceCollection';
import type {
  VisitQuestionCandidate,
  VisitQuestionEvidenceItem,
} from './taskContract';

export { isUpcomingConfirmedCalendarAppointment } from './appointmentFreshness';

export function collectVisitQuestionCitations(
  questions: readonly VisitQuestionCandidate[],
): VisitQuestionEvidenceItem[] {
  const citations = new Map<string, VisitQuestionEvidenceItem>();
  for (const question of questions) {
    for (const citation of [
      ...question.citations,
      ...(question.generatedArtifactContext ?? []),
    ]) {
      citations.set(visitQuestionCitationKey(citation), citation);
    }
  }
  return [...citations.values()];
}

export function assertReviewedVisitQuestions(
  questions: readonly VisitQuestionCandidate[],
  metadataByCitation: VisitQuestionEvidenceCollection['metadataByCitation'],
  appointmentDate?: string,
): void {
  if (questions.length < 1 || questions.length > 5) {
    throw new Error(
      'Choose between one and five visit questions before saving.',
    );
  }
  const texts = new Set<string>();
  for (const question of questions) {
    const text = question.questionText.trim();
    const rationale = question.rationale.trim();
    if (
      text.length < 2 ||
      text.length > 300 ||
      rationale.length < 2 ||
      rationale.length > 400 ||
      !/[\uac00-\ud7a3]/u.test(text) ||
      !/[\uac00-\ud7a3]/u.test(rationale) ||
      !text.endsWith('?') ||
      (question.priority !== 'routine' && question.priority !== 'important') ||
      (question.kind === 'clarification'
        ? question.citations.length !== 0
        : question.citations.length < 1 && !question.legacySource) ||
      (question.legacySource !== undefined &&
        (question.kind === 'clarification' ||
          question.citations.length !== 0 ||
          !question.legacySource.id ||
          !question.legacySource.revision)) ||
      question.citations.length > 3
    ) {
      throw new Error(
        'A reviewed question is missing its text, reason, priority, or evidence.',
      );
    }
    const normalizedText = text.toLocaleLowerCase('ko-KR');
    if (texts.has(normalizedText))
      throw new Error('The reviewed list contains a duplicate question.');
    texts.add(normalizedText);
    const citationKeys = question.citations.map(visitQuestionCitationKey);
    if (
      (question.generatedArtifactContext ?? []).some(
        item => item.sourceKind !== 'generated_artifact',
      )
    )
      throw new Error('Generated context must reference retained artifacts.');
    if (new Set(citationKeys).size !== citationKeys.length) {
      throw new Error('A question contains duplicate evidence links.');
    }
    for (const citation of [
      ...question.citations,
      ...(question.generatedArtifactContext ?? []),
    ]) {
      if (!metadataByCitation.has(visitQuestionCitationKey(citation))) {
        throw new Error(
          'A reviewed question refers to evidence outside the current result set.',
        );
      }
    }
    // The saved draft may have been edited after model validation, so its exact cited facts are checked again.
    if (
      appointmentDate &&
      hasUnsupportedDateOrValue(
        `${text} ${rationale}`,
        question.citations,
        appointmentDate,
      )
    ) {
      throw new Error(
        'A reviewed question contains a date or value that its evidence does not support.',
      );
    }
  }
}

export async function assertCurrentVisitQuestionRecord(
  writer: RecordWriter,
  item: VisitQuestionEvidenceItem,
  metadata: VisitQuestionEvidenceMetadata,
  sql?: SqlExecutor,
): Promise<void> {
  if (item.sourceKind === 'generated_artifact')
    return assertGeneratedVisitQuestionSource(item, metadata, sql);
  if (metadata.recordKind && metadata.evidenceRecordId) {
    const currentEvidence = await writer.get(
      metadata.recordKind,
      metadata.evidenceRecordId,
    );
    if (
      !currentEvidence ||
      localEvidenceFingerprint(currentEvidence) !== item.evidenceRevision
    ) {
      throw new Error(
        'Cited local evidence changed while the question list was under review.',
      );
    }

    if (metadata.recordKind === 'transcript_segment') {
      const segment = currentEvidence as TranscriptEvidenceSegment;
      const segments = await writer.list('transcript_segment');
      const latestRevision = segments
        .filter(
          candidate =>
            candidate.transcriptId === segment.transcriptId &&
            candidate.segmentOrdinal === segment.segmentOrdinal,
        )
        .reduce((latest, candidate) => Math.max(latest, candidate.revision), 0);
      if (segment.revision !== latestRevision) {
        throw new Error(
          'A newer transcript revision replaced cited evidence during review.',
        );
      }
    }
  } else if (item.sourceKind === 'personal_record') {
    throw new Error(
      'The local evidence reference is missing its record identity.',
    );
  }

  if (item.sourceKind !== 'personal_record') return;

  // Use the same typed provenance resolver as search, within the save transaction.
  const { sourceIds, snapshots } = await readVisitEvidenceSnapshots(
    writer,
    metadata.recordKind!,
    {
      evidenceId: metadata.evidenceRecordId!,
      sourceRecordIds: metadata.sourceRecordRevisions.map(
        source => source.sourceId,
      ),
      structured:
        item.locator !== null &&
        typeof item.locator === 'object' &&
        'kind' in item.locator &&
        item.locator.kind === 'structured_record',
    },
  );
  const currentSourceRevisions = snapshots.map((snapshot, index) => ({
    sourceId: sourceIds[index]!,
    revision: localEvidenceFingerprint(snapshot),
  }));
  if (
    localEvidenceFingerprint(currentSourceRevisions) !== item.sourceRevision
  ) {
    throw new Error(
      'A source record changed while the question list was under review.',
    );
  }
}
