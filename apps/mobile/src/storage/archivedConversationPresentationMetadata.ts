import { parseConversationMessageDelivery } from '../ragConversation/conversationMessageDelivery';
import type { DisplayMessage } from '../ragConversation/conversationDisplayMessage';

export type ArchivedConversationPresentationMetadata = Pick<
  DisplayMessage,
  'delivery' | 'initialResponse'
>;

/** Carry already persisted display metadata. No evidence, inference or backfill. */
export function archivedConversationPresentationMetadata(
  value: Record<string, unknown>,
): ArchivedConversationPresentationMetadata {
  const delivery = parseConversationMessageDelivery(value.delivery);
  const candidate = value.initialResponse;
  let initialResponse: DisplayMessage['initialResponse'];
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    const { callId, text } = candidate as Record<string, unknown>;
    if (
      typeof callId === 'string' &&
      callId.length > 0 &&
      callId.length <= 200 &&
      typeof text === 'string' &&
      text.trim() &&
      Object.keys(candidate).every(key => key === 'callId' || key === 'text')
    )
      initialResponse = { callId, text };
  }
  return {
    ...(delivery && { delivery }),
    ...(initialResponse && { initialResponse }),
  };
}
