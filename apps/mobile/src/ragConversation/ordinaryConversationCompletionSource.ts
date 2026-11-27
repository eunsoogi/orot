import type { OrdinaryConversationCompletionIdentity } from '../storage/ordinaryConversationMemoryCompletion';

/** Construct source identity only from the successfully admitted protected checkpoint. */
export function completedMemorySource(
  input: {
    sessionId: string;
    sessionVersion?: number;
    turnId: string;
    createdAt: string;
  },
  question: string | undefined,
): OrdinaryConversationCompletionIdentity | undefined {
  return question !== undefined
    ? {
        requestId: input.turnId,
        sessionId: input.sessionId,
        sessionVersion: input.sessionVersion ?? 0,
        question,
        createdAt: input.createdAt,
      }
    : undefined;
}
