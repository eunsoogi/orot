import type { RagConversationOutcome } from '../../ragConversation/outcome';
import { t } from '../../i18n';

/** Keep a failed local lookup distinct from a genuinely empty continuation page. */
export function conversationFallbackOutcome(
  outcome: RagConversationOutcome,
  continuation: boolean,
  localRetrievalFailed: boolean,
): RagConversationOutcome | undefined {
  if (
    continuation &&
    (outcome.status === 'no_evidence' || outcome.status === 'insufficient')
  )
    return {
      status: 'answer',
      citations: [],
      answer: t('ragConversation.conversation.continuationNoMatch'),
    };
  if (
    localRetrievalFailed &&
    (outcome.status === 'no_evidence' ||
      outcome.status === 'insufficient' ||
      (outcome.status === 'failure' && outcome.kind === 'unavailable'))
  )
    return { status: 'failure', kind: 'retrieval_failed' };
  return undefined;
}
