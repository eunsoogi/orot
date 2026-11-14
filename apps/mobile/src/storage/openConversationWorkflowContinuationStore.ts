import type { ConversationContinuationIdentity } from './conversationWorkflowContinuationIdentity';
import { createConversationWorkflowContinuationStore } from './conversationWorkflowContinuationStore';

export async function openConversationWorkflowContinuationStore(
  identity: ConversationContinuationIdentity,
) {
  const { openLocalAgentMemoryDatabase } = await import('./secureDatabase');
  return createConversationWorkflowContinuationStore(
    await openLocalAgentMemoryDatabase(),
    identity,
  );
}
