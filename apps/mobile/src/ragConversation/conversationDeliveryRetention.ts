import {
  parseConversationMessageDelivery,
  type ConversationMessageDelivery,
} from './conversationMessageDelivery';

/** Display receipts share the protected turn lifetime, never provider history.
 * Deletion permanently revokes this attempt, including late callbacks and save retries. */
export function createConversationDeliveryRetention() {
  let delivery: ConversationMessageDelivery | undefined;
  let revoked = false;
  return {
    retainDelivery(value: ConversationMessageDelivery) {
      if (revoked) return;
      const next = parseConversationMessageDelivery(value);
      if (!next) return;
      // Retain first observations even if an older callback arrives after read.
      delivery = delivery
        ? {
            submittedAt: delivery.submittedAt,
            ...(delivery.acceptedAt || next.acceptedAt
              ? { acceptedAt: delivery.acceptedAt ?? next.acceptedAt }
              : {}),
            ...(delivery.readAt || next.readAt
              ? { readAt: delivery.readAt ?? next.readAt }
              : {}),
          }
        : next;
    },
    discardDelivery() {
      revoked = true;
      delivery = undefined;
    },
    withoutRevokedDelivery<T extends { delivery?: unknown }>(value: T): T {
      return revoked && value.delivery
        ? { ...value, delivery: undefined }
        : value;
    },
    deliveryMetadata: () => (delivery ? { delivery } : {}),
  };
}
