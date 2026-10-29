const koreanAvailabilityQuestion =
  /(?:어떤|무슨).{0,24}(?:건강|의료|증상|혈압|기록|데이터).{0,24}(?:있|볼 수|확인할 수|저장|연동)|(?:저장된|연동된|연결된).{0,24}(?:건강|의료|증상|혈압|기록|데이터).{0,24}(?:있|볼 수|확인할 수)|(?:건강|의료|증상|혈압|기록|데이터).{0,24}(?:앱에 저장|앱에서 확인|볼 수|확인할 수 있|연동되어 있)/u;

const englishAvailabilityQuestion =
  /\b(?:what|which|can|could|do|does|is|are)\b.{0,100}\b(?:health|medical|symptom|blood pressure|record|data)\b.{0,60}\b(?:available|saved|stored|see|visible|accessible|connected|linked|here|in (?:the )?app)\b/iu;

const englishAccessQuestion =
  /\b(?:can|could)\b.{0,24}\b(?:you|i)\b.{0,24}\b(?:see|view|access)\b.{0,60}\b(?:my\s+)?(?:(?:apple\s+)?health|medical|symptom|blood pressure)?\s*(?:records?|data)\b/iu;

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
