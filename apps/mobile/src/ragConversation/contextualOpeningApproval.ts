import type { ReviewedOpening } from '../storage/conversationReviewedOpeningStorage';

export type AuthoredContextualOpeningProof = Readonly<{
  input: string;
  current: () => boolean;
  requestId: string;
  sessionId: string;
  sessionVersion: number;
}>;

const authoredInputs = new WeakMap<
  ReviewedOpening,
  AuthoredContextualOpeningProof
>();

/** Keep provenance in the app, never in the model's result or tool payload.
 * Only the fresh contextual producer calls this after its independent review. */
export function approvedAuthoredContextualOpening<T extends ReviewedOpening>(
  opening: T,
  authored: AuthoredContextualOpeningProof,
): T {
  const approved = Object.freeze(opening);
  authoredInputs.set(approved, Object.freeze(authored));
  return approved;
}

export function contextualOpeningAuthoredProof(opening: ReviewedOpening) {
  return authoredInputs.get(opening);
}
