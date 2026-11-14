/** Only an explicit current-message save command authorizes a local write.
 * Keep the user's words intact; dates and diagnoses are not inferred by this parser.
 */
export function conversationHistoryIntent(
  question: string,
): string | undefined {
  const match = question
    .trim()
    .match(
      /^(?:과거 건강 기록으로 저장해(?:\s*줘)?|save (?:this )?as past health history)\s*[:：]\s*([\s\S]+)$/iu,
    );
  const suffix = question
    .trim()
    .match(
      /^([\s\S]+?)\s+(?:(?:과거 )?건강 기록(?:으로|에) |병력으로 )?(?:저장|기록|기억)해(?:\s*(?:줘|주세요))?[.!]?$/u,
    );
  const text = (match?.[1] ?? suffix?.[1])?.trim();
  if (text && isHistoryPointer(text)) return undefined;
  return text && text.length <= 900 ? text : undefined;
}

/** A referential save command is not itself a health fact. */
export function isHistoryPointer(text: string): boolean {
  return /^(?:(?:이|그|저)(?:거|것| 내용)|(?:방금|아까|위에서) 말한 (?:것|내용)|위 내용)(?:을|를|은|는|도)?$/u.test(
    text.trim(),
  );
}

export function isReferentialHistoryCommand(question: string): boolean {
  const prefix = question
    .trim()
    .replace(
      /\s+(?:(?:과거 )?건강 기록(?:으로|에) |병력으로 )?(?:저장|기록|기억)해(?:\s*(?:줘|주세요))?[.!]?$/u,
      '',
    );
  return prefix !== question.trim() && isHistoryPointer(prefix);
}
