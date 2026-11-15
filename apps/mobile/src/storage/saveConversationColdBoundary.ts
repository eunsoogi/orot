import type { JsonObject } from '@orot/model-runtime';
import type { SqlDatabase } from '@orot/storage';
import type { ConversationContinuationCapture } from './conversationContinuationCapture';
import {
  continuationInput,
  continuationManifest,
  type ConversationContinuationIdentity,
} from './conversationWorkflowContinuationIdentity';
import { createConversationColdResumeStorage } from './conversationColdResumeStorage';

/** Capture private application state with a source epoch before reads, never with a stored grant. */
export function saveConversationColdBoundary(
  database: SqlDatabase,
  identity: ConversationContinuationIdentity,
  reconstruct: (
    input: Parameters<ConversationContinuationCapture>[0],
  ) => Promise<JsonObject>,
): ConversationContinuationCapture {
  const store = createConversationColdResumeStorage(database);
  return async input => {
    const sourceEpoch = await store.sourceEpoch();
    const exactInput = continuationInput(input.options);
    const reconstruction = await reconstruct(input);
    if (continuationInput(input.options) !== exactInput)
      throw new Error('Original invocation changed while capturing recovery.');
    if (
      input.submittedInput !== null &&
      typeof input.submittedInput !== 'string'
    )
      throw new Error('Unsupported submitted input for recovery.');
    await store.save({
      version: 1,
      sourceEpoch,
      exactInput,
      manifest: continuationManifest(
        identity,
        `conversation-resume:${identity.requestId}`,
        input.options,
      ),
      checkpointId: input.checkpointId,
      attempt: input.attempt,
      request: input.options.request,
      submittedInput: input.submittedInput,
      reconstruction,
    });
  };
}
