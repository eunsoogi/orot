import type { RagConversationOutcome } from '../../ragConversation/outcome';
import type { createConversationRetentionBridge } from './conversationRetentionBridge';
import {
  publicSearchNotice,
  type DefaultPublicSearchResult,
} from './defaultPublicSearch';

/** Preserve the displayed limitations with the validated retained answer. */
export async function finishRagConversation(input: {
  outcome: RagConversationOutcome;
  publicSearch: DefaultPublicSearchResult;
  retention: ReturnType<typeof createConversationRetentionBridge>;
  signal: AbortSignal;
  continuation: boolean;
}): Promise<RagConversationOutcome> {
  const annotated =
    input.outcome.status === 'answer' && input.publicSearch.status !== 'success'
      ? {
          ...input.outcome,
          answer: `${input.outcome.answer}\n\n${publicSearchNotice(input.publicSearch.status)}`,
        }
      : input.outcome;
  const finished = await input.retention.finish(annotated);
  if (input.signal.aborted && !finished.retained)
    return { status: 'failure', kind: 'cancelled' };
  if (
    input.continuation &&
    finished.outcome.status === 'answer' &&
    finished.outcome.citations.some(
      citation => citation.sourceKind === 'generated_artifact',
    )
  )
    return {
      ...finished.outcome,
      answer: `${finished.outcome.answer}\n\n더 이전 결과를 계속 찾아볼 수 있어요.`,
    };
  return finished.outcome;
}
