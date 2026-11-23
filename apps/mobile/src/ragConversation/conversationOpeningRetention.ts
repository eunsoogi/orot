import type { ConversationTurnRetentionInput } from './conversationTurnRetentionInput';
import type { ReviewedOpening } from '../storage/conversationReviewedOpeningStorage';

/** Reviewed opening prose is optional display metadata, never answer/history evidence.
 * Revocation is permanent for this attempt; late events cannot restore deleted metadata. */
export function createConversationOpeningRetention(
  input?: ConversationTurnRetentionInput,
) {
  let opening: { callId: string; text: string } | undefined;
  let revoked = false;
  const save = !input?.restored && input?.storage.writeReviewedOpening;
  return {
    persistReviewedOpening:
      save && input
        ? (
            candidate: ReviewedOpening,
            signal: AbortSignal,
            current: () => boolean,
          ) =>
            save({
              id: input.turnId,
              sessionId: input.sessionId,
              version: input.sessionVersion ?? 0,
              createdAt: input.createdAt,
              opening: candidate,
              current: () => !revoked && current(),
              signal,
            })
        : undefined,
    retainOpening(value: { callId: string; text: string }) {
      if (
        !revoked &&
        value.callId &&
        value.callId.length <= 200 &&
        value.text.trim() &&
        value.text.length <= 300
      )
        opening ??= { callId: value.callId, text: value.text };
    },
    discardOpening() {
      revoked = true;
      opening = undefined;
    },
    withoutRevokedOpening<T extends { initialResponse?: unknown }>(
      value: T,
    ): T {
      if (!revoked || !value.initialResponse) return value;
      return { ...value, initialResponse: undefined };
    },
    openingMetadata: () => (opening ? { initialResponse: opening } : {}),
  };
}
