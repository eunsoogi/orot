type MemoryAttempt = 'not_attempted' | 'not_saved' | 'saved';

export type ConversationMemoryReceipt =
  MemoryAttempt | 'authored-not-saved' | 'generated-report';

/** Separate approval outcomes cannot mask a proven storage commit. An already
 * approved report has dedicated copy; authored and prior-answer share local copy. */
export function settleConversationMemoryReceipt({
  authored = 'not_attempted',
  priorAnswer = 'not_attempted',
  reportCommitted,
}: {
  authored?: MemoryAttempt;
  priorAnswer?: MemoryAttempt;
  reportCommitted: boolean;
}): ConversationMemoryReceipt {
  if (reportCommitted) return 'generated-report';
  if (authored === 'saved' || priorAnswer === 'saved') return 'saved';
  if (priorAnswer === 'not_saved') return 'not_saved';
  if (authored === 'not_saved') return 'authored-not-saved';
  return 'not_attempted';
}
