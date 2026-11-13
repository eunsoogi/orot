import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { ConversationSubmittedInput } from '../../ragConversation/conversationSubmittedInput';
import { validateConversationPhotoOriginal } from '../../ragConversation/conversationPhotoOriginal';
import { stableJson } from './evidenceUtils';

/** Rechecks the protected request and original; stored consent never authorizes a new send. */
export function createConversationPhotoInputValidator(
  storage: ReturnType<typeof createConversationArtifactStorage>,
) {
  return async (input: ConversationSubmittedInput, signal: AbortSignal) => {
    if (!input.ocr || signal.aborted) return false;
    const expected = stableJson(input);
    return validateConversationPhotoOriginal({
      sourceId: input.ocr.source.id,
      contentHash: input.ocr.source.contentHash,
      signal,
      async isCurrent() {
        // The durable generation changes on a full conversation-data clear; individual
        // source removals are fenced by readRequestInput and its source ownership row.
        if (
          (await storage.currentGeneration()) !== input.ocr!.deletionGeneration
        )
          return false;
        const version = await storage.activeSessionVersion(input.sessionId);
        if (version === null || signal.aborted) return false;
        const current = await storage.readRequestInput(
          input.requestId,
          input.sessionId,
          version,
        );
        return (
          !signal.aborted &&
          current !== null &&
          stableJson(current) === expected
        );
      },
    });
  };
}
