import { observeConversationFinalization as finalize } from '../../ragConversation/conversationFinalizationDiagnostics';
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
  if (
    !(await finalize('conversation_final_history_validation', () =>
      input.historyIsCurrent(),
    ))
  )
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
