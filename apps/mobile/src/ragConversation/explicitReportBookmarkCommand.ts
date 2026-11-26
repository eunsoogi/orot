/** Existing whole-message control. It preserves the no-transfer route; it does not select text for memory. */
export function explicitReportBookmarkCommand(draft: string) {
  const matched =
    /^(?:(?:이( 일일)?|지금 이)\s*보고서(?:를)?\s*(?:기억해(?:\s*줘)?|기억에\s*(?:저장|보관)해(?:\s*줘)?|저장해(?:\s*줘)?|보관해(?:\s*줘)?)|(?:please\s+)?(?:remember|save|bookmark)\s+this\s+(?:(daily)\s+)?report)[.!]?$/iu.exec(
      draft.trim(),
    );
  return matched
    ? { namedDaily: Boolean(matched[1] || matched[2]) }
    : undefined;
}
