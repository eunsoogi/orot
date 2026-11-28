import type { ReviewedOpening } from '../storage/conversationReviewedOpeningStorage';

const authoredInputs = new WeakMap<
  ReviewedOpening,
  { readonly input: string; readonly current: () => boolean }
>();

/** Keep provenance in the app, never in the model's result or tool payload.
 * Only the fresh contextual producer calls this after its independent review. */
export function approvedAuthoredContextualOpening<T extends ReviewedOpening>(
  opening: T,
  authored: { readonly input: string; readonly current: () => boolean },
): T {
  const approved = Object.freeze(opening);
  authoredInputs.set(approved, Object.freeze(authored));
  return approved;
}

export function contextualOpeningAuthoredProof(opening: ReviewedOpening) {
  return authoredInputs.get(opening);
}
