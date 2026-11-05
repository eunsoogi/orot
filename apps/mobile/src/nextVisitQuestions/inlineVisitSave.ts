import { inlineReviewSelection } from './inlineVisitReview';
import type {
  InlineVisitReview,
  InlineVisitSelection,
} from './inlineVisitReview';
import type {
  NextVisitEvidenceReference,
  SaveReviewedQuestionsResult,
} from './types';

/** Own one message's explicit-save operation; a started database commit cannot be cancelled. */
export function createInlineVisitSave<T extends NextVisitEvidenceReference>(
  ownerKey: string,
  persist: (
    selection: InlineVisitSelection<T>,
  ) => Promise<SaveReviewedQuestionsResult<T>>,
  isCurrentOwner: () => boolean,
) {
  let pending = false;
  return async (state: InlineVisitReview<T>, signal?: AbortSignal) => {
    if (state.ownerKey !== ownerKey || !isCurrentOwner())
      return { status: 'inactive' as const };
    const selection = inlineReviewSelection(state);
    if (!selection) return { status: 'no_selection' as const };
    if (pending) return { status: 'busy' as const };
    if (signal?.aborted) return { status: 'cancelled' as const };
    pending = true;
    try {
      const result = await persist(selection);
      // Cancellation after dispatch cannot undo a committed write; report its actual outcome.
      return {
        status: 'committed' as const,
        ownerKey,
        result,
        deliverToOwner: !signal?.aborted && isCurrentOwner(),
      };
    } catch {
      return {
        status: 'failed' as const,
        ownerKey,
        deliverToOwner: !signal?.aborted && isCurrentOwner(),
      };
    } finally {
      pending = false;
    }
  };
}
