import type { SelectedAiResolution } from './provider';
import { stableJson } from './evidenceUtils';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { ConversationWorkflowContinuation } from '../../ragConversation/conversationWorkflowContinuation';
import { lazyConversationContinuationStore } from './lazyConversationContinuationStore';

/** Only an owned retained turn can offer real continuation. No UI callback means no background resume contract. */
export async function prepareConversationContinuation(
  observer: RagConversationObserver | undefined,
  selected: Extract<SelectedAiResolution, { status: 'ready' }>,
  selectedAi: () => Promise<Extract<SelectedAiResolution, { status: 'ready' }>>,
  reconstruct?: import('../../storage/conversationContinuationCapture').ConversationColdReconstruction,
): Promise<ConversationWorkflowContinuation | undefined> {
  if (
    !observer?.retentionRequestId ||
    !observer.openWorkflowContinuation ||
    !observer.retentionSession ||
    !observer.onWorkflowPauseController ||
    !observer.onWorkflowPaused
  )
    return undefined;
  const fingerprint = (value: typeof selected) =>
    stableJson({
      selection: value.selection,
      provider: value.provider.id,
      model: value.modelId,
      recipient: value.recipient,
      remoteProcessing: value.remoteProcessing,
    });
  const original = fingerprint(selected);
  return {
    async validateSelection(signal) {
      if (
        signal.aborted ||
        fingerprint(await selectedAi()) !== original ||
        signal.aborted
      )
        throw new Error(
          'AI selection changed; saved execution cannot continue.',
        );
    },
    bindPause: observer.onWorkflowPauseController,
    waitForContinue: observer.onWorkflowPaused,
    persisted: lazyConversationContinuationStore(() =>
      observer.openWorkflowContinuation!(
        {
          requestId: observer.retentionRequestId!,
          sessionId: observer.retentionSession!.id,
          sessionVersion: observer.retentionSession!.version,
        },
        reconstruct,
      ),
    ),
  };
}
