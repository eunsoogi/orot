import { t } from '../../i18n';
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
  reportIsCurrent?: () => Promise<boolean>;
}): Promise<RagConversationOutcome> {
  const annotated =
    input.outcome.status === 'answer' && input.publicSearch.status !== 'success'
      ? {
          ...input.outcome,
          answer: `${input.outcome.answer}\n\n${publicSearchNotice(input.publicSearch.status)}`,
        }
      : input.outcome;
  const finished = await input.retention.finish(annotated);
  // Retention can await a transaction after the workflow's last report check.
  const reportChanged =
    !input.signal.aborted &&
    input.reportIsCurrent &&
    !(await input.reportIsCurrent());
  if (input.signal.aborted && !finished.retained)
    return { status: 'failure', kind: 'cancelled' };
  if (reportChanged && !input.signal.aborted)
    return { status: 'failure', kind: 'stale_evidence' };
  if (
    input.continuation &&
    finished.outcome.status === 'answer' &&
    finished.outcome.citations.some(
      citation => citation.sourceKind === 'generated_artifact',
    )
  )
    return {
      ...finished.outcome,
      answer: `${finished.outcome.answer}\n\n${t('ragConversation.conversation.continuationAvailable')}`,
    };
  return finished.outcome;
}
