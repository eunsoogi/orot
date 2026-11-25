import { observeConversationFinalHistory } from '../../ragConversation/conversationFinalizationDiagnostics';
import type { RagConversationOutcome } from '../../ragConversation/outcome';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { conversationGeneratedTools } from './conversationGeneratedTools';
import { conversationFallbackOutcome } from './conversationFallbackOutcome';
import { t } from '../../i18n';
import { recordingSelectionRecipient } from './recordingSelectionRecipient';
import { finishRagConversation } from './finishRagConversation';

/** Both live and reconstructed workflows preserve final freshness, paging and retention gates. */
export async function finishConversationWorkflow(
  input: Omit<Parameters<typeof finishRagConversation>[0], 'continuation'> & {
    observer?: RagConversationObserver;
    recordingSelection?: Parameters<typeof recordingSelectionRecipient>[0];
    priorDialogueOmitted?: boolean;
    generated: ReturnType<typeof conversationGeneratedTools>;
    localRetrievalFailed(): boolean;
    historyIsCurrent(): Promise<boolean>;
  },
): ReturnType<typeof finishRagConversation> {
  if (input.signal.aborted) return { status: 'failure', kind: 'cancelled' };
  const history = await observeConversationFinalHistory(
    () => input.historyIsCurrent(),
    input.signal,
  );
  // No continuation, fallback, preview or retention work owns a stopped turn.
  if (history === 'cancelled' || input.signal.aborted)
    return { status: 'failure', kind: 'cancelled' };
  if (history === 'rejected')
    return {
      status: 'failure',
      kind: 'retrieval_failed',
      discardUnverifiedDraft: true,
    };
  if (
    input.outcome.status === 'insufficient' &&
    input.outcome.guidance === 'recording_selector'
  ) {
    return input.observer?.inputOrigin === 'composer' &&
      input.recordingSelection &&
      (await input.observer.recordingClarification?.stage(
        recordingSelectionRecipient(input.recordingSelection),
      )) &&
      !input.signal.aborted
      ? input.outcome
      : { status: 'insufficient' };
  }
  const continuation = input.generated.choose(input.outcome);
  input.observer?.onArtifactContinuation?.(continuation);
  const fallback = conversationFallbackOutcome(
    input.outcome,
    Boolean(continuation),
    input.localRetrievalFailed(),
  );
  return (
    fallback ??
    finishRagConversation({
      ...input,
      outcome:
        input.outcome.status === 'answer' && input.priorDialogueOmitted
          ? {
              ...input.outcome,
              answer: `${input.outcome.answer}\n\n${t('ragConversation.conversation.priorDialogueOmitted')}`,
            }
          : input.outcome,
      continuation: Boolean(continuation),
    })
  );
}

/** The provider cannot create a success receipt. Render only a proven commit. */
export function answerMemoryOutcome(
  outcome: RagConversationOutcome,
  committed: boolean,
): RagConversationOutcome {
  return committed
    ? {
        status: 'answer',
        answer: t('historyDisplay.savedConversationMemory'),
        citations: [],
        committedAnswerMemory: true,
      }
    : outcome;
}
