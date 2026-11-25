import {
  isEligibleConversationMemorySource,
  protectedMemoryControlPrefixEnd,
} from '../manualHistory/conversationHistoryIntent';

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
  const source = message.trim();
  const sentences = source.split(/(?<=[.!。])\s+/u);
  const exactSentences = sentences.filter(sentence => sentence === candidate);
  // A colon in free prose can qualify or negate the text that follows.
  // Permit omission only of the existing standalone control label, and only
  // when the model supplied all remaining bytes of the sole authored sentence.
  const prefixEnd = protectedMemoryControlPrefixEnd(source);
  const firstAfterControl =
    prefixEnd > 0 && sentences[0]?.slice(prefixEnd) === candidate;
  if (exactSentences.length === 1) return !firstAfterControl;
  return (
    exactSentences.length === 0 &&
    firstAfterControl &&
    sentences.length === 1 &&
    !/[\r\n]/u.test(candidate) &&
    !/^['‘’«‹]/u.test(candidate) &&
    source.slice(prefixEnd) === candidate
  );
}
