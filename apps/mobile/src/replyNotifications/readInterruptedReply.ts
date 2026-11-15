import type { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import type { ReplyIdentity } from './replyNotificationCoordinator';

/** Only a current protected interrupted checkpoint can be opened, never a fabricated completion. */
export async function readInterruptedReply(
  storage: Pick<
    ReturnType<typeof createConversationArtifactStorage>,
    'listInterruptedRequests'
  >,
  identity: ReplyIdentity,
) {
  if (
    identity.purpose !== 'interruption' ||
    identity.requestId !== `interruption:${identity.messageId}`
  )
    return null;
  const interrupted = (
    await storage.listInterruptedRequests(
      identity.sessionId,
      identity.sessionVersion,
    )
  ).find(
    value =>
      value.id === identity.messageId &&
      value.interruptionReason !== 'user-stopped',
  );
  return interrupted ? { createdAt: interrupted.createdAt, answer: '' } : null;
}
