import type {
  ConversationSession,
  ConversationSessionOptions,
} from './conversationSessionTypes';

/** Inspect the existing protected checkpoint only; never send or replay a request. */
type RecoveryInput = {
  options: ConversationSessionOptions;
  find(id: number): ConversationSession | undefined;
  update(id: number, change: Partial<ConversationSession>): void;
  disposed(): boolean;
};
export function createConversationRecoveryRefresh(input: RecoveryInput) {
  return async (id: number, signal: AbortSignal) => {
    const session = input.find(id);
    const answer = session?.messages.at(-1);
    const lease = input.options.retention?.activeLease(id);
    if (
      input.disposed() ||
      signal.aborted ||
      !session ||
      session.busy ||
      session.restoring ||
      session.quarantined ||
      !answer?.incomplete ||
      answer.interruptionReason === 'user-stopped' ||
      !answer.toolMessageId ||
      !lease ||
      !input.options.coldResume
    )
      return false;
    const recovery = await input.options.coldResume.inspect(
      {
        sessionId: lease.id,
        sessionVersion: lease.version,
        requestId: answer.toolMessageId,
      },
      signal,
    );
    const current = input.find(id);
    const currentLease = input.options.retention?.activeLease(id);
    if (
      !recovery ||
      input.disposed() ||
      signal.aborted ||
      !current ||
      current.busy ||
      current.restoring ||
      current.quarantined ||
      current.messages !== session.messages ||
      currentLease?.id !== lease.id ||
      currentLease.version !== lease.version
    )
      return false;
    input.update(id, {
      messages: current.messages.map(message =>
        message === answer
          ? { ...message, coldResume: { attempt: recovery.attempt } }
          : message,
      ),
    });
    return true;
  };
}

/** Compact registration keeps session ownership wiring separate from the recovery implementation. */
export function recoveryFor(
  options: ConversationSessionOptions,
  find: RecoveryInput['find'],
  update: RecoveryInput['update'],
  disposed: RecoveryInput['disposed'],
) {
  return createConversationRecoveryRefresh({ options, find, update, disposed });
}
