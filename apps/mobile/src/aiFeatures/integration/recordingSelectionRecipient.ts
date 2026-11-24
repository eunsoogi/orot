import type { requireSelectedAi } from './provider';
import type { RecordingRecipient } from '../../ragConversation/conversationRecordingClarification';

/** Bind the recipient identified during the clarification; a reply cannot follow an AI setting change. */
export function recordingSelectionRecipient(
  selected: ReturnType<typeof requireSelectedAi>,
): RecordingRecipient {
  return {
    providerId: selected.provider.id,
    modelId: selected.modelId,
    recipient: selected.recipient,
    remoteProcessing: selected.remoteProcessing,
  };
}

export function sameRecordingRecipient(
  a: RecordingRecipient,
  b: RecordingRecipient,
): boolean {
  return (
    a.providerId === b.providerId &&
    a.modelId === b.modelId &&
    a.recipient === b.recipient &&
    a.remoteProcessing === b.remoteProcessing
  );
}
