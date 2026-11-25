// Plain explicit requests can remember any admissible topic. A reference to an
// AI artifact is not a user-authored statement (that requires its own typed action).
const commandPrefix =
  /^(?:(?:과거 건강 기록으로 저장|기억|기록|저장)해(?:\s*(?:줘|주세요))?|(?:please\s+)?(?:remember|save)(?:\s+(?:this|as (?:past health history|a memory)|this as (?:past health history|a memory)))?)\s*[:：]\s*([\s\S]+)$/iu;
const englishStatement = /^(?:please\s+)?remember that\s+([\s\S]+)$/iu;
const commandSuffix =
  /^([\s\S]+?)\s+(?:(?:과거 )?건강 기록(?:으로|에) |병력으로 )?(?:저장|기록|기억)해(?:\s*(?:줘|주세요))?[.!。]?$/u;
const payload = (question: string) => {
  const text = question.trim();
  return (
    commandPrefix.exec(text)?.[1] ??
    englishStatement.exec(text)?.[1] ??
    commandSuffix.exec(text)?.[1]
  )?.trim();
};

/** Do not turn raw secrets, opt-outs, hypothetical or quoted content into durable memory.
 * This is a conservative text classifier, not proof that general prose contains no sensitive values. */
export function isEligibleConversationMemorySource(text: string): boolean {
  return (
    Boolean(text.trim()) &&
    !/[?？`<>「」“”"]|https?:\/\/|예를\s*들|만약|가정(?:하|이|이라)|인용|기억하지|저장하지|기록하지|비밀|비밀번호|비밀\s*키|복구\s*(?:코드|구문)|인증\s*코드|토큰\s*값/iu.test(
      text,
    ) &&
    !/\b(?:password|passphrase|api[ _-]*key|secret|credential|access[ _-]*token|refresh[ _-]*token|recovery[ _-]*(?:code|phrase)|otp|pin|sk-(?:proj-)?[\w-]{10,}|gh[pousr]_[\w]{10,}|(?:never|not|don't)\s+(?:retain|preserve|memorize|archive|log|record|store|remember|save)|hypothetical|suppose|imagine|if|for example)\b/iu.test(
      text,
    )
  );
}

/** Recognize intent independently so a denied local payload cannot fall through to a provider. */
export function hasConversationMemoryCommand(question: string): boolean {
  return payload(question) !== undefined;
}

/** Identify the end of the existing colon control label, without selecting a
 * statement. A post-model source check can then prove exactly what was omitted. */
export function protectedMemoryControlPrefixEnd(message: string): number {
  const matched = commandPrefix.exec(message);
  if (!matched?.[1]) return 0;
  const end = matched[0].length - matched[1].length;
  // The explicit past-history label has a separate legacy action. Do not
  // erase that choice or reinterpret it through this source-span exception.
  return /과거 건강 기록|past health history/iu.test(message.slice(0, end))
    ? 0
    : end;
}

/** Keep the exact pre-existing action grammar as a distinct evidence lane. */
export function legacyConversationHistoryIntent(
  question: string,
): string | undefined {
  const match =
    /^(?:과거 건강 기록으로 저장해(?:\s*줘)?|save (?:this )?as past health history)\s*[:：]\s*([\s\S]+)$/iu.exec(
      question.trim(),
    );
  const legacy = match?.[1] ?? commandSuffix.exec(question.trim())?.[1];
  const text = legacy?.trim();
  return text && text.length <= 900 && !isHistoryPointer(text)
    ? text
    : undefined;
}

/** Only a complete current-message command authorizes a local write without a fresh review. */
export function conversationHistoryIntent(
  question: string,
): string | undefined {
  const text = payload(question);
  return text &&
    text.length <= 900 &&
    !isHistoryPointer(text) &&
    isEligibleConversationMemorySource(text)
    ? text
    : undefined;
}

/** A referential save command is not itself a user fact or report-save authority. */
export function isHistoryPointer(text: string): boolean {
  return /^(?:(?:이|그|저)(?:거|것| 내용| 보고서| 답변| 요약)|(?:방금|아까|위에서) 말한 (?:것|내용)|(?:위|방금|아까) (?:내용|답변|보고서|요약)|(?:this|that|the last|the previous) (?:answer|response|report|summary)|this|that)(?:을|를|은|는|도)?$/iu.test(
    text.trim(),
  );
}

export function isReferentialHistoryCommand(question: string): boolean {
  const text = payload(question);
  return Boolean(text && isHistoryPointer(text));
}
