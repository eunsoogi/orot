import type { ConversationContinuationIdentity } from './conversationWorkflowContinuationIdentity';
import { conversationWorkflowContinuationOpener } from './conversationWorkflowContinuationOpener';

export async function openConversationWorkflowContinuationStore(
  identity: ConversationContinuationIdentity,
  reconstruct?: import('./conversationContinuationCapture').ConversationColdReconstruction,
) {
  const { openLocalAgentMemoryDatabase } = await import('./secureDatabase');
  const database = await openLocalAgentMemoryDatabase();
  return conversationWorkflowContinuationOpener(database)(
    identity,
    reconstruct,
  );
}
