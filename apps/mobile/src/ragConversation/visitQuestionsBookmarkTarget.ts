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
