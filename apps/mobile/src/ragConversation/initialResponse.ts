/** The review changes call ordering; old cold journals must fail closed, not replay it. */
export const initialResponseTaskVersion = '9';

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
  request = '',
): string | undefined {
  // Conservative latency guard, not triage: do not add a preview-review round trip
  // for recognizable urgent requests. The grounded response path remains unchanged.
  if (
    /(?:응급|숨\s*못|호흡\s*곤란|가슴\s*통증|흉통|의식|자살|자해|과다\s*복용|chest pain|cannot breathe|suicid|overdose)/iu.test(
      request,
    )
  )
    return undefined;
  const candidate = text.trim();
  if (
    !candidate ||
    candidate.length > 300 ||
    /[\d{}<>]|https?:|\n/iu.test(candidate)
  )
    return undefined;
  if (
    /(?:확진|진단|정상|비정상|위험|복용|처방|확인했|검토했|분석했|찾았|완료|저장했|괜찮|안심|걱정\s*마|기다리|응급|안전|문제없|문제\s*없)/u.test(
      candidate,
    )
  )
    return undefined;
  return candidate;
}

/** Display original model prose only after local checks and consent-gated review.
 * Rejection leaves loading visible; it never substitutes a canned response. */
export const contextualInitialResponsePolicy = {
  taskVersion: initialResponseTaskVersion,
  initialToolResponse: validateInitialConversationResponse,
  reviewInitialToolResponse: true,
} as const;
