import type { AgentMemoryService } from '@orot/agent-memory';
import { localEvidenceFingerprint, visitQuestionCitationKey } from './evidence';
import type { VisitQuestionCreate } from '@orot/domain';
import type { RecordRepository } from '@orot/storage';
import type { VisitQuestionEvidenceCollection } from './evidenceCollection';
import type {
  VisitQuestionCandidate,
  VisitQuestionEvidenceItem,
} from './taskContract';
import {
  assertCurrentVisitQuestionRecord,
  assertReviewedVisitQuestions,
  collectVisitQuestionCitations,
  isUpcomingConfirmedCalendarAppointment,
} from './persistenceValidation';
import {
  createReviewedVisitQuestionRecord,
  saveReviewedVisitQuestionMemory,
} from './persistenceRecords';

export interface SaveReviewedVisitQuestionsInput {
  readonly appointmentId: string;
  readonly expectedAppointmentRevision: string;
  readonly questions: readonly VisitQuestionCandidate[];
  readonly evidence: VisitQuestionEvidenceCollection;
  readonly repository: RecordRepository;
  readonly memory?: Pick<AgentMemoryService, 'remember'>;
  readonly now: string;
  /** Rechecks the cited RAG and Rememori references immediately before the write. */
  readonly revalidateEvidence: (
    citations: readonly VisitQuestionEvidenceItem[],
  ) => Promise<boolean>;
}

export interface SaveReviewedVisitQuestionsResult {
  readonly questions: readonly VisitQuestionCreate[];
  readonly memoryStatus: 'saved' | 'retry_required';
}

/** Replaces only this appointment's reviewed list, then upserts its source-linked memory. */
export async function saveReviewedVisitQuestions(
  input: SaveReviewedVisitQuestionsInput,
): Promise<SaveReviewedVisitQuestionsResult> {
  if (!input.appointmentId.trim())
    throw new Error('An appointment ID is required.');
  assertReviewedVisitQuestions(
    input.questions,
    input.evidence.metadataByCitation,
  );
  const citations = collectVisitQuestionCitations(input.questions);
  if (!(await input.revalidateEvidence(citations))) {
    throw new Error(
      'Cited evidence is no longer current. Refresh the suggestions before saving.',
    );
  }

  const saved = await input.repository.transaction(async writer => {
    const appointment = await writer.get('appointment', input.appointmentId);
    if (
      !appointment ||
      !isUpcomingConfirmedCalendarAppointment(appointment, input.now)
    ) {
      throw new Error(
        'The confirmed appointment changed or is no longer upcoming.',
      );
    }
    if (
      localEvidenceFingerprint(appointment) !==
      input.expectedAppointmentRevision
    ) {
      throw new Error(
        'The appointment changed while the question list was under review.',
      );
    }
    // Recheck edits against the appointment read in this transaction before any prior list is replaced.
    assertReviewedVisitQuestions(
      input.questions,
      input.evidence.metadataByCitation,
      appointment.effectiveAt,
    );

    for (const citation of citations) {
      const metadata = input.evidence.metadataByCitation.get(
        visitQuestionCitationKey(citation),
      );
      if (!metadata)
        throw new Error('A cited evidence reference is no longer available.');
      await assertCurrentVisitQuestionRecord(writer, citation, metadata);
    }

    const previous = await writer.list('visit_question');
    for (const question of previous) {
      if (question.appointmentId === input.appointmentId) {
        await writer.delete('visit_question', question.id);
      }
    }

    const reviewed = input.questions.map((question, index) =>
      createReviewedVisitQuestionRecord({
        appointment,
        appointmentId: input.appointmentId,
        question,
        position: index + 1,
        now: input.now,
        metadataByCitation: input.evidence.metadataByCitation,
      }),
    );
    for (const question of reviewed)
      await writer.put('visit_question', question);
    return { appointment, questions: reviewed };
  });

  const memoryStatus = await saveReviewedVisitQuestionMemory(
    input.memory,
    saved.appointment,
    input.appointmentId,
    saved.questions,
    citations,
    input.evidence.metadataByCitation,
  );
  return { questions: saved.questions, memoryStatus };
}
