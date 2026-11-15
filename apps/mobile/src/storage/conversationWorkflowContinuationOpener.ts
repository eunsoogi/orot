import type { SqlDatabase } from '@orot/storage';
import type { ConversationContinuationIdentity } from './conversationWorkflowContinuationIdentity';
import type { ConversationColdReconstruction } from './conversationContinuationCapture';
import { createConversationWorkflowContinuationStore } from './conversationWorkflowContinuationStore';
import { createOptionalConversationColdCapture } from './optionalConversationColdCapture';

/** Both secure-database and retention-owned openers use the same optional cold writer. */
export function conversationWorkflowContinuationOpener(database: SqlDatabase) {
  return (
    identity: ConversationContinuationIdentity,
    reconstruct?: ConversationColdReconstruction,
  ) =>
    createConversationWorkflowContinuationStore(
      database,
      identity,
      reconstruct
        ? createOptionalConversationColdCapture(database, identity, reconstruct)
        : undefined,
    );
}
