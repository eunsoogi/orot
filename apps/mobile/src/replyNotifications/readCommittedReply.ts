import { readInterruptedReply } from './readInterruptedReply';
import type { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import type { ReplyIdentity } from './replyNotificationCoordinator';

/** Resolve the same completion identity and source-validated answer under the session lease. */
export async function readCommittedReply(
  storage: ReturnType<typeof createConversationArtifactStorage>,
  identity: ReplyIdentity,
) {
  if (identity.purpose === 'interruption')
    return readInterruptedReply(storage, identity);
  const current = (await storage.listCompletionIdentities()).some(
    value =>
      value.requestId === identity.requestId &&
      value.sessionId === identity.sessionId &&
      value.messageId === identity.messageId &&
      value.sessionVersion === identity.sessionVersion,
  );
  if (!current) return null;
  const [answer] = await storage.readSessionMany(
    identity.sessionId,
    identity.sessionVersion,
    [identity.messageId],
  );
  return answer?.status === 'complete' ? answer : null;
}
