import type { DisplayMessage } from './conversationDisplayMessage';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';

type Question = Readonly<{
  identity?: { readonly id: string };
  questionText: string;
  rationale: string;
  priority: string;
}>;

/** Bind the visible generated list without treating editable saved rows or source aliases as the original. */
export function visitQuestionsBookmarkTarget(
  appointmentId: string,
  candidates: readonly Question[],
) {
  if (!appointmentId || !candidates.length || candidates.some(q => !q.identity))
    return undefined;
  return fingerprint([
    appointmentId,
    candidates.map(q => [
      q.identity!.id,
      q.questionText,
      q.rationale,
      q.priority,
    ]),
  ]);
}
/** The live button and typed command must describe the same visible original. */
export function displayedVisitQuestionsBookmarkTarget(message: DisplayMessage) {
  const visit = message.visitQuestions;
  if (
    message.role !== 'assistant' ||
    message.incomplete ||
    message.streaming ||
    message.dailyReport ||
    message.healthSummary ||
    message.visitQuestionsUnavailable ||
    !visit
  )
    return;
  return visitQuestionsBookmarkTarget(
    visit.appointment.id,
    visit.review.items
      .filter(item => item.origin === 'candidate')
      .map(item => item.question),
  );
}
