import { reportOpening } from '../aiFeatures/integration/openingObservation';
import type { ReviewedOpening } from '../storage/conversationReviewedOpeningStorage';
import type { ConversationSession } from './conversationSessionTypes';
import type { createConversationTurnRetention } from './conversationTurnRetention';

/** Review success is authoritative for provider receipts, not for a successful local write. */
export function conversationOpeningDelivery(input: {
  pending: () => ConversationSession['pendingMessage'];
  publish: (
    message: NonNullable<ConversationSession['pendingMessage']>,
  ) => void;
  receipt: () => void;
  retained?: ReturnType<typeof createConversationTurnRetention>;
}) {
  const eligible = () => {
    const pending = input.pending();
    return pending &&
      !pending.withholdHealthBody &&
      (!pending.initialResponse || pending.initialResponse.source === 'receipt')
      ? pending
      : null;
  };
  const show = (value: ReviewedOpening, presentation?: 'card') => {
    const pending = eligible();
    if (!pending || !value.text.trim()) {
      reportOpening('opening_display', 'unavailable');
      return false;
    }
    input.retained?.retainOpening(value);
    input.publish({
      ...pending,
      initialResponse: {
        callId: value.callId,
        text: value.text,
        ...(presentation ? { presentation } : {}),
      },
    });
    reportOpening('opening_display', 'completed');
    return true;
  };
  const validOpening = (value: ReviewedOpening) => {
    if (value.text.trim()) return true;
    reportOpening('opening_display', 'unavailable');
    return false;
  };
  return {
    /** New reviewed producer capability. Raw/preview stream tokens never get a durable write. */
    async onReviewedOpening(
      { callId, text, presentation }: ReviewedOpening & {
        readonly presentation?: 'card';
      },
      signal: AbortSignal,
    ) {
      const value = { callId, text };
      if (!eligible() || signal.aborted || !validOpening(value)) return false;
      input.receipt();
      try {
        await input.retained?.persistReviewedOpening?.(value, signal, () =>
          Boolean(eligible()),
        );
      } catch {
        // Optional opening storage failure cannot turn a final reply into an interruption.
        reportOpening('opening_display', 'unavailable');
        return false;
      }
      return !signal.aborted && show(value, presentation);
    },
    onLegacyOpening(value: ReviewedOpening) {
      // Reviewed first-tool openings still use the legacy event. Preserve live
      // display without giving that shape the independent journal capability.
      if (!eligible() || !validOpening(value)) return;
      input.receipt();
      show(value);
    },
  };
}
