/** A model-selected acknowledgment is not a medical answer or a claim that a tool has run.
 * Exact copy admission keeps unsupported clinical prose and injected data out of this early surface. */
export const initialConversationResponse =
  '질문을 확인했어요. 필요한 정보를 확인한 뒤 이어서 답할게요.';

export const initialResponseInstruction =
  'For a direct answer, return the final result without an acknowledgment. When you need a supplied tool, include exactly the short Korean acknowledgment supplied in initialResponseText as the tool-call assistant message text before requesting the tool. Do not claim that information was already checked, that work completed, or add medical advice to this acknowledgment. Continue the same task after the tool and return the validated final answer; the acknowledgment is never a final result. ';

export function validateInitialConversationResponse(
  text: string,
): string | undefined {
  return text.trim() === initialConversationResponse
    ? initialConversationResponse
    : undefined;
}

/** Local receipt states only that the user's request arrived; no model or tool work is implied. */
export const conversationRequestReceipt =
  '질문을 받았어요. 확인한 내용을 이어서 알려드릴게요.';
