import { createInlineVisitReview } from './inlineVisitReview';
import type {
  GenerationOutcome,
  NextVisitEvidenceReference,
  SavedQuestionsState,
} from './types';

/** A message owns its generation and saved-list snapshot; late results cannot move to another message. */
export async function generateInlineVisitReview<
  T extends NextVisitEvidenceReference,
  TResult extends GenerationOutcome<T>,
>(input: {
  readonly ownerKey: string;
  readonly appointmentId: string;
  readonly loadSaved: (
    appointmentId: string,
  ) => Promise<SavedQuestionsState<T>>;
  readonly generate: () => Promise<TResult>;
  readonly isCurrentOwner: () => boolean;
  readonly signal: AbortSignal;
  readonly createId?: () => string;
}) {
  const current = () => !input.signal.aborted && input.isCurrentOwner();
  if (!current()) return { status: 'cancelled' as const };
  const saved = await input.loadSaved(input.appointmentId);
  if (!current()) return { status: 'cancelled' as const };
  if (
    saved &&
    (saved.status !== 'ready' || saved.appointmentId !== input.appointmentId)
  )
    return { status: 'saved_unavailable' as const };
  const outcome = await input.generate();
  if (!current()) return { status: 'cancelled' as const };
  if (outcome.status !== 'ready')
    return outcome as Exclude<TResult, { status: 'ready' }>;
  const generation = outcome as Extract<TResult, { status: 'ready' }>;
  const fresh = createInlineVisitReview(
    input.ownerKey,
    saved?.status === 'ready' ? saved.questions : [],
    outcome.questions,
    outcome.caveats,
    input.createId,
  );
  // Each generation owns a new message; existing reviews remain untouched.
  return {
    status: 'ready' as const,
    review: fresh,
    generation,
    restorationNotice: saved.restorationNotice,
  };
}
