import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { conversationGeneratedTools } from './conversationGeneratedTools';
import { conversationFallbackOutcome } from './conversationFallbackOutcome';
import { finishRagConversation } from './finishRagConversation';

/** Both live and reconstructed workflows preserve final freshness, paging and retention gates. */
export async function finishConversationWorkflow(
  input: Omit<Parameters<typeof finishRagConversation>[0], 'continuation'> & {
    observer?: RagConversationObserver;
    generated: ReturnType<typeof conversationGeneratedTools>;
    localRetrievalFailed(): boolean;
    historyIsCurrent(): Promise<boolean>;
  },
): ReturnType<typeof finishRagConversation> {
  if (input.signal.aborted) return { status: 'failure', kind: 'cancelled' };
  if (!(await input.historyIsCurrent()))
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
    finishRagConversation({ ...input, continuation: Boolean(continuation) })
  );
}
