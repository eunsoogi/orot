import { createInlineVisitReview } from './inlineVisitReview';
import type {
  GenerationOutcome,
  NextVisitEvidenceReference,
  SavedQuestionsState,
} from './types';
import {
  recoveryForSavedQuestionReadFailure,
  type VisitQuestionPreflightRecovery,
} from './savedQuestionRecovery';

/** A message owns its saved snapshot; preflight failures retain safe recovery codes and never mutate another review. */
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
  let saved: SavedQuestionsState<T>;
  try {
    saved = await input.loadSaved(input.appointmentId);
  } catch {
    if (!current()) return { status: 'cancelled' as const };
    return {
      status: 'saved_unavailable' as const,
      recovery: recoveryForSavedQuestionReadFailure('storage_read_failed'),
    };
  }
  if (!current()) return { status: 'cancelled' as const };
  if (!saved) {
    return {
      status: 'saved_unavailable' as const,
      recovery: recoveryForSavedQuestionReadFailure('unknown_read_failure'),
    };
  }
  if (saved.status === 'loading') {
    return {
      status: 'saved_unavailable' as const,
      recovery: {
        status: 'loading',
        action: 'retry_saved_question_read',
      } satisfies VisitQuestionPreflightRecovery,
    };
  }
  if (saved.status === 'error') {
    const failureReason = saved.failureReason ?? 'unknown_read_failure';
    return {
      status: 'saved_unavailable' as const,
      recovery: recoveryForSavedQuestionReadFailure(failureReason),
    };
  }
  if (saved.appointmentId !== input.appointmentId) {
    return {
      status: 'saved_unavailable' as const,
      recovery: {
        status: 'appointment_mismatch',
        action: 'refresh_appointment',
      } satisfies VisitQuestionPreflightRecovery,
    };
  }
  const outcome = await input.generate();
  if (!current()) return { status: 'cancelled' as const };
  if (outcome.status !== 'ready')
    return outcome as Exclude<TResult, { status: 'ready' }>;
  const generation = outcome as Extract<TResult, { status: 'ready' }>;
  const fresh = createInlineVisitReview(
    input.ownerKey,
    saved.questions,
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
