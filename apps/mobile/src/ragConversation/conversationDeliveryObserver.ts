import type { ConversationSession } from './conversationSessionTypes';
import {
  observeConversationDelivery,
  type ConversationMessageDelivery,
} from './conversationMessageDelivery';

/** Only the still-owning request may advance its user message; late retries never borrow another receipt. */
export function createConversationDeliveryObserver(input: {
  sessionId: number;
  messageId: number;
  current(): boolean;
  find(id: number): ConversationSession;
  update(id: number, change: Partial<ConversationSession>): void;
  retain?: (value: ConversationMessageDelivery) => void;
}) {
  const initial = input
    .find(input.sessionId)
    ?.messages.find(message => message.id === input.messageId)?.delivery;
  if (initial) input.retain?.(initial);
  return {
    onProviderReceipt(receipt: 'accepted' | 'response_started') {
      if (!input.current()) return;
      const session = input.find(input.sessionId);
      const previous = session?.messages.find(
        message => message.id === input.messageId,
      )?.delivery;
      if (!previous) return;
      const delivery = observeConversationDelivery(
        previous,
        receipt,
        new Date().toISOString(),
      );
      input.retain?.(delivery);
      input.update(input.sessionId, {
        messages: session.messages.map(message =>
          message.id === input.messageId
            ? { ...message, delivery, deliveryPending: false }
            : message,
        ),
      });
    },
    settle() {
      const session = input.find(input.sessionId);
      if (!session) return;
      // A failed/local-only request stops saying sending, without inventing success or failure details.
      input.update(input.sessionId, {
        messages: session.messages.map(message =>
          message.id === input.messageId
            ? { ...message, deliveryPending: false }
            : message,
        ),
      });
    },
  };
}
