import type {
  ConversationSession,
  PendingTurn,
} from './conversationSessionTypes';

/** The exact live final bubble, not provider output or a phase event, proves
 * that expiry no longer interrupts model work. An unsaved answer remains
 * unsaved; this decision never promotes it into durable history. */
export function hasShownUnsavedAnswer(
  request: PendingTurn | undefined,
  session: ConversationSession | undefined,
) {
  const id = request?.liveFinalResponseId;
  return (
    id !== undefined &&
    !request?.committed &&
    session?.pendingMessage === null &&
    session.messages.some(
      message =>
        message.id === id &&
        message.role === 'assistant' &&
        !message.incomplete &&
        Boolean(message.content),
    )
  );
}
