import type { ConversationTurnRetentionInput } from './conversationTurnRetentionInput';
import type { createConversationOpeningRetention } from './conversationOpeningRetention';
import type { createConversationDeliveryRetention } from './conversationDeliveryRetention';

/** Only the judged opening and delivery metadata can accompany the fixed app-authored question. */
export function conversationLocalClarification(
  input: ConversationTurnRetentionInput,
  opening: ReturnType<typeof createConversationOpeningRetention>,
  delivery: ReturnType<typeof createConversationDeliveryRetention>,
): {
  completeLocalClarification?: (
    question: string,
    signal: AbortSignal,
    current: () => boolean,
  ) => Promise<void>;
} {
  const save = input.storage.completeLocalClarification;
  if (input.restored || !save) return {};
  return {
    async completeLocalClarification(
      question: string,
      signal: AbortSignal,
      current: () => boolean,
    ) {
      const { initialResponse } = opening.openingMetadata();
      const receipt = delivery.deliveryMetadata();
      await save({
        id: input.turnId,
        sessionId: input.sessionId,
        version: input.sessionVersion ?? 0,
        question,
        createdAt: input.createdAt,
        display: { ...receipt, initialResponse },
        current: () =>
          current() &&
          opening.openingMetadata().initialResponse === initialResponse &&
          delivery.deliveryMetadata().delivery === receipt.delivery,
        signal,
      });
    },
  };
}
