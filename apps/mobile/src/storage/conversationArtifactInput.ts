import { decodeConversationSubmittedInput } from '../ragConversation/conversationSubmittedInput';

export function artifactInputObject(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Photo answers are bound to the exact submitted input and selected model. */
export function validConversationArtifactInput(
  value: Record<string, unknown>,
): boolean {
  const submitted =
    value.submittedInput === undefined
      ? undefined
      : decodeConversationSubmittedInput(value.submittedInput);
  return !(
    (value.submittedInput !== undefined && !submitted) ||
    (!value.question && !submitted?.ocr) ||
    (submitted &&
      (submitted.requestId !== value.id ||
        submitted.sessionId !== value.sessionId ||
        submitted.question !== value.question ||
        (submitted.ocr &&
          (submitted.ocr.providerId !== value.providerId ||
            submitted.ocr.modelId !== value.modelId))))
  );
}
