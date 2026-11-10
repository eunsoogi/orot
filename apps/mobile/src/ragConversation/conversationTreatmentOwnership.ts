import type {
  ConversationSessionOptions,
  ConversationSnapshot,
} from './conversationSessionTypes';

/** A treatment sheet can only act under the active conversation's durable lease. */
export function conversationTreatmentOwnership(
  options: ConversationSessionOptions,
  snapshot: () => ConversationSnapshot | undefined,
) {
  function active(id: number) {
    const current = snapshot();
    const session = current?.sessions.find(item => item.id === id);
    return (
      current?.activeId === id &&
      session &&
      !session.quarantined &&
      !session.restoring &&
      !session.restoreFailed
    );
  }
  return {
    isActive: active,
    lease(id: number) {
      return active(id) ? (options.retention?.activeLease(id) ?? null) : null;
    },
    async begin(id: number, signal: AbortSignal) {
      if (!active(id) || !options.retention?.beginSession)
        throw new Error('Conversation is unavailable.');
      const lease = await options.retention.beginSession(id, signal);
      if (!active(id) || signal.aborted)
        throw new Error('Conversation is unavailable.');
      return lease;
    },
    resolveSource: options.resolveTreatmentSource,
  };
}
