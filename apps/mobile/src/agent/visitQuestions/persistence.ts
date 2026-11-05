import type { AgentMemoryService } from '@orot/agent-memory';
import { localEvidenceFingerprint, visitQuestionCitationKey } from './evidence';
import type { VisitQuestionCreate } from '@orot/domain';
import type { RecordRepository } from '@orot/storage';
import type { VisitQuestionEvidenceCollection } from './evidenceCollection';
import type {
  VisitQuestionCandidate,
  VisitQuestionEvidenceItem,
  SavedQuestionRevision,
} from './taskContract';
import {
  sameQuestionContent,
  validateQuestionIdentities,
} from './persistenceIdentity';
import { VisitQuestionCreateSchema } from '@orot/domain';
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
import { assertHealthPeriodCurrent } from '../../storage/healthPeriodDependencies';
import { appendVisitQuestionPeriod } from '../../storage/visitQuestionPeriods';

export interface SaveReviewedVisitQuestionsInput {
  readonly appointmentId: string;
  readonly expectedAppointmentRevision: string;
  readonly questions: readonly VisitQuestionCandidate[];
  readonly expectedSavedQuestions: readonly SavedQuestionRevision[];
  readonly evidence: VisitQuestionEvidenceCollection;
  readonly repository: RecordRepository;
  readonly memory?: Pick<AgentMemoryService, 'remember'>;
  readonly now: string;
  /** Rechecks the cited RAG and Rememori references immediately before the write. */
  readonly revalidateEvidence: (
    citations: readonly VisitQuestionEvidenceItem[],
    options?: { readonly allowEmpty: boolean },
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
  const current = citations.length
    ? await input.revalidateEvidence(citations)
    : await input.revalidateEvidence(citations, { allowEmpty: true });
  if (!current) {
    throw new Error(
      'Cited evidence is no longer current. Refresh the suggestions before saving.',
    );
  }

  const saved = await input.repository.transaction(async (writer, sql) => {
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
      if (metadata.healthContextSource) {
        if (!sql)
          throw new Error('Atomic health-period validation is unavailable.');
        await assertHealthPeriodCurrent(sql, metadata.healthContextSource);
      } else
        await assertCurrentVisitQuestionRecord(writer, citation, metadata, sql);
    }

    const previous = await writer.list('visit_question');
    const existing = validateQuestionIdentities(
      previous,
      input.appointmentId,
      input.expectedSavedQuestions,
      input.questions,
    );
    const legacyRecords = new Map<string, (typeof previous)[number]>();
    for (const question of input.questions) {
      const reference = question.legacySource;
      if (!reference) continue;
      const original = previous.find(row => row.id === reference.id);
      if (
        !original ||
        original.appointmentId !== input.appointmentId ||
        original.kind !== question.kind ||
        original.kind === 'clarification' ||
        original.evidenceSpanIds.length !== 0 ||
        original.healthContextSources?.length ||
        localEvidenceFingerprint(original) !== reference.revision ||
        legacyRecords.has(reference.id)
      ) {
        throw new Error(
          'The saved legacy question changed or cannot be verified.',
        );
      }
      if (!sql)
        throw new Error('Atomic legacy source validation is unavailable.');
      const stale = await sql.execute(
        "SELECT artifact_id FROM transcript_artifact_staleness WHERE artifact_kind = 'visit_question' AND artifact_id = ? LIMIT 1",
        [original.id],
      );
      if (stale.rows.length)
        throw new Error(
          'The saved legacy question has stale transcript evidence.',
        );
      // Preserve historical provenance; a legacy reference never certifies its source as current.
      legacyRecords.set(reference.id, original);
    }
    const reviewed = input.questions.map((question, index) =>
      createReviewedVisitQuestionRecord({
        appointment,
        appointmentId: input.appointmentId,
        question,
        position: index + 1,
        now: input.now,
        metadataByCitation: input.evidence.metadataByCitation,
        ...(question.legacySource
          ? { legacyRecord: legacyRecords.get(question.legacySource.id)! }
          : {}),
      }),
    );
    const retained = new Set(reviewed.map(question => question.id));
    for (const question of previous) {
      if (
        question.appointmentId === input.appointmentId &&
        !retained.has(question.id)
      )
        await writer.delete('visit_question', question.id);
    }
    for (let index = 0; index < reviewed.length; index += 1) {
      const question = reviewed[index]!;
      const prior = existing.get(question.id);
      if (prior && sameQuestionContent(prior, question)) {
        reviewed[index] = VisitQuestionCreateSchema.parse(prior);
        continue;
      }
      if (prior?.healthContextSources?.length) {
        if (!sql)
          throw new Error('Atomic health-period storage is unavailable.');
        await sql.execute(
          'DELETE FROM visit_question_periods WHERE question_id = ?',
          [question.id],
        );
      }
      await writer.put('visit_question', question);
      for (const source of question.healthContextSources ?? []) {
        if (!sql)
          throw new Error('Atomic health-period storage is unavailable.');
        await appendVisitQuestionPeriod(sql, question.id, source);
      }
    }
    return { appointment, questions: reviewed };
  });

  // A restored legacy row has no verifiable source location; do not promote it
  // into freshly reviewed memory as though its original evidence were current.
  const memoryStatus = input.questions.some(question => question.legacySource)
    ? ('retry_required' as const)
    : await saveReviewedVisitQuestionMemory(
        input.memory,
        saved.appointment,
        input.appointmentId,
        saved.questions,
        citations,
        input.evidence.metadataByCitation,
      );
  return { questions: saved.questions, memoryStatus };
}
