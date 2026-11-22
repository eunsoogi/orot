/** A durable graph checkpoint is a deliberate pause, not proof of an iOS expiration. */
export type ConversationCheckpointPauseReason =
  'background-paused' | 'decision-required';

export function conversationCheckpointPauseReason(
  awaitingAuthorization: string | null | undefined,
): ConversationCheckpointPauseReason {
  return awaitingAuthorization ? 'decision-required' : 'background-paused';
}

/** Historic real/ambiguous expirations keep the old eligibility and still need
 * a protected, independently revalidated checkpoint to offer Continue. */
export function mayHaveConversationCheckpoint(reason: string | undefined) {
  return (
    reason === 'background-paused' ||
    reason === 'decision-required' ||
    reason === 'expired'
  );
}
