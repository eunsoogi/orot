import type { AiFeatureLocalData } from './localData';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { stableJson } from './evidenceUtils';

/** Restoration cannot rely on protected SQL alone to validate a separately owned native file. */
export async function validateInterruptedPhotoInputs(input: {
  readonly requests: Awaited<
    ReturnType<
      ReturnType<
        typeof createConversationArtifactStorage
      >['listInterruptedRequests']
    >
  >;
  readonly storage: ReturnType<typeof createConversationArtifactStorage>;
  readonly data: AiFeatureLocalData;
  readonly sessionId: string;
  readonly version: number;
  readonly signal: AbortSignal;
}) {
  for (const request of input.requests) {
    if (!request.submittedInput?.ocr) continue;
    if (
      input.signal.aborted ||
      !(await input.data.validateConversationPhotoInput?.(
        request.submittedInput,
        input.signal,
      ))
    )
      throw new Error('Conversation attachment is unavailable.');
    const current = await input.storage.readRequestInput(
      request.id,
      input.sessionId,
      input.version,
    );
    if (
      input.signal.aborted ||
      !current ||
      stableJson(current) !== stableJson(request.submittedInput)
    )
      throw new Error('Conversation attachment changed.');
  }
}
