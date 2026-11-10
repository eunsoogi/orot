import type { RagConversationOutcome } from '../../ragConversation/outcome';

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
      answer:
        '아직 일치하는 결과를 찾지 못했어요. 더 이전 결과를 계속 찾아볼 수 있어요.',
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
