import type { AiFeatureServices } from './featureServices';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { loadVisitQuestionAppointment } from './visitQuestionAppointment';
import { createInlineVisitReview } from '../../nextVisitQuestions/inlineVisitReview';
import type { NextVisitQuestion } from '../../nextVisitQuestions/types';
import type { VisitQuestionEvidenceItem } from '../../agent/visitQuestions/taskContract';

/** Rebuild a retained message from the current saved list; the turn never owns an asked record. */
export async function restoreConversationVisitQuestions(input: {
  readonly appointmentId: string;
  readonly ownerKey: string;
  readonly loadSaved: AiFeatureServices['loadSavedVisitQuestions'];
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly signal: AbortSignal;
  readonly candidates: readonly NextVisitQuestion<VisitQuestionEvidenceItem>[];
  readonly loadAppointment?: typeof loadVisitQuestionAppointment;
}) {
  const appointment = await (
    input.loadAppointment ?? loadVisitQuestionAppointment
  )(new Date().toISOString(), input.appointmentId);
  if (!appointment || input.signal.aborted) return null;
  const saved = await input.loadSaved(appointment.id);
  if (
    input.signal.aborted ||
    saved.status !== 'ready' ||
    saved.appointmentId !== appointment.id
  )
    return null;
  const savedIds = new Set(
    saved.questions.map(question => question.identity.id),
  );
  const candidates = input.candidates.filter(
    question => !savedIds.has(question.identity!.id),
  );
  const ids = candidates.map(question => question.identity!.id);
  return {
    appointment,
    restoredFromSnapshot: true,
    restorationNotice: saved.restorationNotice,
    review: createInlineVisitReview(
      input.ownerKey,
      saved.questions,
      candidates,
      saved.caveats,
      () => ids.shift()!,
    ),
    validateSource: (
      reference: import('../../agent/visitQuestions/taskContract').VisitQuestionEvidenceItem,
      signal: AbortSignal,
    ) => input.registry.revalidateEvidence([reference], signal),
  };
}
