import { isEligibleConversationMemorySource } from '../manualHistory/conversationHistoryIntent';

/** Validate a model-selected verbatim sentence, without selecting content or
 * deciding intent. The separate local confirmation displays these exact bytes. */
export function exactAuthoredMemorySentence(
  message: string,
  candidate: unknown,
): candidate is string {
  if (
    typeof candidate !== 'string' ||
    candidate.length < 8 ||
    candidate.length > 900 ||
    message.length > 1000 ||
    !isEligibleConversationMemorySource(message) ||
    !isEligibleConversationMemorySource(candidate) ||
    !/[.!。]$/u.test(candidate)
  )
    return false;
  const sentences = message.trim().split(/(?<=[.!。])\s+/u);
  return sentences.filter(sentence => sentence === candidate).length === 1;
}
