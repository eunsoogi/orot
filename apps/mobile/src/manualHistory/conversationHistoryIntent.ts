/** Only an explicit current-message save command authorizes a local write.
 * Keep the user's words intact; dates and diagnoses are not inferred by this parser.
 */
export function conversationHistoryIntent(
  question: string,
): string | undefined {
  const match = question
    .trim()
    .match(
      /^(?:과거 건강 기록으로 저장해(?:줘)?|save (?:this )?as past health history)\s*[:：]\s*([\s\S]+)$/iu,
    );
  const suffix = question
    .trim()
    .match(
      /^([\s\S]+?)\s+(?:(?:과거 )?건강 기록으로 |병력으로 )?(?:저장|기록|기억)해(?:줘|주세요)?[.!]?$/u,
    );
  const text = (match?.[1] ?? suffix?.[1])?.trim();
  if (
    text &&
    /^(?:이거|그거|이것|그것|이 내용|그 내용|방금 말한 것|위 내용)$/u.test(text)
  )
    return undefined;
  return text && text.length <= 900 ? text : undefined;
}
