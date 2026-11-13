import type { JsonValue } from '@orot/model-runtime';
import type { RagConversationRunOptions } from './service';
import { boundedProviderHistory } from './conversationHistoryPayload';

/** Keep validated prior dialogue distinct from ordinary, bounded provider history. */
export function conversationWorkflowContext(
  options: RagConversationRunOptions,
): JsonValue {
  const history = boundedProviderHistory(options.previousMessages);
  if (
    !options.entryIntent &&
    !options.photoEvidence?.length &&
    !options.validatedPriorTurns?.length &&
    !options.priorDialogueOmitted
  )
    return history as unknown as JsonValue;
  return {
    history,
    ...(options.photoEvidence?.length ? { photoAttachment: true } : {}),
    ...(options.entryIntent ? { intent: options.entryIntent } : {}),
    ...(options.validatedPriorTurns?.length
      ? { priorDialogue: options.validatedPriorTurns }
      : {}),
    ...(options.priorDialogueOmitted ? { priorDialogueOmitted: true } : {}),
    ...(options.targetVisitEvidence
      ? { targetEvidenceId: options.targetVisitEvidence.evidenceId }
      : {}),
  } as unknown as JsonValue;
}
