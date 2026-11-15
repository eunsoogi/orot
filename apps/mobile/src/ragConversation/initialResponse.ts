/** The review changes call ordering; old cold journals must fail closed, not replay it. */
export const initialResponseTaskVersion = '8';

/** Legacy fixture copy retained for checkpoint compatibility tests. New requests never
 * insert this text locally or require the model to repeat it. */
export const initialConversationResponse =
  '질문을 확인했어요. 필요한 정보를 확인한 뒤 이어서 답할게요.';

export const initialResponseInstruction =
  'For a direct answer, return the final result without an acknowledgment. When you need a supplied tool, write a brief natural Korean first reply in the tool-call assistant message text that responds to this particular request. Use non-factual conversational support or explain what you intend to look into. Do not copy a canned receipt. Do not answer medical questions, give advice, assert facts about records, expose measurements, or claim any investigation or action already occurred. Do not quote private details. The first reply is provisional, never the final result; continue the same task after tools and return the validated final answer. ';

/** Local checks are only defense in depth. Free prose additionally requires the runtime's
 * consent-gated semantic review; neither check is a guarantee of clinical safety. */
export function validateInitialConversationResponse(
  text: string,
): string | undefined {
  const candidate = text.trim();
  if (
    !candidate ||
    candidate.length > 300 ||
    /[\d{}<>]|https?:|\n/iu.test(candidate)
  )
    return undefined;
  if (
    /(?:확진|진단|정상|비정상|위험|복용|처방|확인했|검토했|분석했|찾았|완료|저장했)/u.test(
      candidate,
    )
  )
    return undefined;
  return candidate;
}
