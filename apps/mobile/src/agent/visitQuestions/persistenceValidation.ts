import { compareTimestamps } from '@orot/domain';
import type { Appointment, TranscriptEvidenceSegment } from '@orot/domain';
import type { RecordWriter } from '@orot/storage';
import { localEvidenceFingerprint, visitQuestionCitationKey } from './evidence';
import { hasUnsupportedDateOrValue } from './questionFacts';
import type { VisitQuestionEvidenceMetadata } from './evidence';
import type { VisitQuestionEvidenceCollection } from './evidenceCollection';
import type {
  VisitQuestionCandidate,
  VisitQuestionEvidenceItem,
} from './taskContract';

export function isUpcomingConfirmedCalendarAppointment(
  appointment: Appointment,
  now: string,
): boolean {
  return (
    (appointment.status === 'scheduled' ||
      appointment.status === 'rescheduled') &&
    Boolean(appointment.calendarEventIdentifier) &&
    appointment.calendarEventSnapshot !== undefined &&
    compareTimestamps(appointment.effectiveAt, now) >= 0
  );
}

export function collectVisitQuestionCitations(
  questions: readonly VisitQuestionCandidate[],
): VisitQuestionEvidenceItem[] {
  const citations = new Map<string, VisitQuestionEvidenceItem>();
  for (const question of questions) {
    for (const citation of question.citations) {
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
      question.citations.length < 1 ||
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
    if (new Set(citationKeys).size !== citationKeys.length) {
      throw new Error('A question contains duplicate evidence links.');
    }
    for (const citation of question.citations) {
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
): Promise<void> {
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

  const currentSourceRevisions: {
    readonly sourceId: string;
    readonly revision: string;
  }[] = [];
  // Missing source rows invalidate the citation; an ID-only fallback could hide deletion.
  for (const source of metadata.sourceRecordRevisions) {
    const currentSource = await writer.get('source_record', source.sourceId);
    if (!currentSource) {
      throw new Error(
        'A source record was deleted while the question list was under review.',
      );
    }
    currentSourceRevisions.push({
      sourceId: source.sourceId,
      revision: localEvidenceFingerprint(currentSource),
    });
  }
  if (
    localEvidenceFingerprint(currentSourceRevisions) !== item.sourceRevision
  ) {
    throw new Error(
      'A source record changed while the question list was under review.',
    );
  }
}
