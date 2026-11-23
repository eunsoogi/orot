import { observeConversationFinalHistory } from '../../ragConversation/conversationFinalizationDiagnostics';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { conversationGeneratedTools } from './conversationGeneratedTools';
import { conversationFallbackOutcome } from './conversationFallbackOutcome';
import { t } from '../../i18n';
import { finishRagConversation } from './finishRagConversation';

/** Both live and reconstructed workflows preserve final freshness, paging and retention gates. */
export async function finishConversationWorkflow(
  input: Omit<Parameters<typeof finishRagConversation>[0], 'continuation'> & {
    observer?: RagConversationObserver;
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
    return { status: 'failure', kind: 'retrieval_failed' };
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
