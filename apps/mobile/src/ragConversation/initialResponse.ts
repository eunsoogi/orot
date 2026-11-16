/** Changed call ordering restores only through an exact matching legacy contract. */
export const initialResponseTaskVersion = '10';

/** Legacy fixture copy retained for checkpoint compatibility tests. New requests never
 * insert this text locally or require the model to repeat it. */
export const initialConversationResponse =
  '질문을 확인했어요. 필요한 정보를 확인한 뒤 이어서 답할게요.';

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
