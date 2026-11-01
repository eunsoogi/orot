// Record nouns plus an end-of-question availability predicate avoid treating a
// request to explain a health problem as an inventory question.
const koreanAvailabilityQuestion =
  /(?:(?:어떤|무슨).{0,16}(?:건강|의료|증상|혈압).{0,10}(?:기록|데이터).{0,20}(?:있(?:나요|어요|습니까)?|볼 수 있(?:나요|어요|습니까)?|확인할 수 있(?:나요|어요|습니까)?)|(?:저장된|연동된|연결된).{0,24}(?:건강|의료|증상|혈압).{0,10}(?:기록|데이터).{0,20}(?:있(?:나요|어요|습니까)?|볼 수 있(?:나요|어요|습니까)?|확인할 수 있(?:나요|어요|습니까)?)|(?:건강|의료|증상|혈압).{0,10}(?:기록|데이터).{0,20}(?:앱에 저장되어|앱에서 확인할 수|볼 수 있|확인할 수|연동되어 있)(?:나요|어요|습니까)?)\s*[?!.]*$/u;

const englishAvailabilityQuestion =
  /\b(?:(?:what|which)\b.{0,80}\b(?:health|medical|symptom|blood pressure|record|data)\b.{0,50}\b(?:available|saved|stored|visible|accessible|connected|linked)|(?:do i have|do you have|is there|are there)\b.{0,80}\b(?:health|medical|symptom|blood pressure|record|data)\b.{0,40}\b(?:available|saved|stored|visible|accessible|connected|linked))\b(?:\s+(?:here|in (?:the )?(?:app|library)|on (?:the )?(?:app|library|device|phone)|to me))?\s*[?.!]*$/iu;

const englishAccessQuestion =
  /(?:\b(?:can|could)\s+(?:you|i)\s+(?:see|view|access)\b.{0,60}\b(?:(?:apple\s+)?health|medical|symptom|blood pressure)?\s*(?:records?|data)\b|\b(?:what|which)\b.{0,60}\b(?:health|medical|symptom|blood pressure)\s+(?:records?|data)\b.{0,30}\b(?:can|could)\s+(?:i|you)\s+(?:see|view|access)\b)(?:\s+(?:here|in (?:the )?(?:app|library)|on (?:the )?(?:app|library|device|phone)))?\s*[?.!]*$/iu;

/** Routes only explicit saved-record availability questions to a local-only summary. */
export function isRagConversationAvailabilityQuestion(
  question: string,
): boolean {
  const normalized = question.trim().replace(/\s+/gu, ' ');
  if (!normalized) return false;
  return (
    koreanAvailabilityQuestion.test(normalized) ||
    englishAvailabilityQuestion.test(normalized) ||
    englishAccessQuestion.test(normalized)
  );
}
