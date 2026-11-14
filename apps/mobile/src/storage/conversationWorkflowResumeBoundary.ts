export interface ConversationResumeBoundary {
  checkpointId: string;
  phase:
    | 'task_response'
    | 'evidence_research'
    | 'revised_response'
    | 'evidence_search';
  pendingOperation: boolean;
  terminal: boolean;
  awaitingAuthorization?: string;
}
/** A prepared external query is resumable only before dispatch, never an in-flight tool. */
export function isSafeConversationResumePhase(value: {
  phase: string;
  awaitingAuthorization?: string;
}) {
  return (
    ['task_response', 'evidence_research', 'revised_response'].includes(
      value.phase,
    ) ||
    (value.phase === 'evidence_search' &&
      /^tool-[1-9]\d*$/u.test(value.awaitingAuthorization ?? ''))
  );
}

/** Corrupt stored metadata cannot become a permissive boundary or crash the eligibility reader. */
export function decodeConversationResumeBoundary(
  value: string,
): ConversationResumeBoundary | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as ConversationResumeBoundary)
      : undefined;
  } catch {
    return undefined;
  }
}
