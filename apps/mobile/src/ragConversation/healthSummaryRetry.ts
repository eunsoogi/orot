import type { ConversationSession } from './conversationSessionTypes';
import type { HealthSummaryResult } from './healthSummary';

/** Retry one card's own saved result and update only its originating message. */
export function healthSummaryRetry(input: {
  id: number;
  messageId: number;
  retry: () => Promise<HealthSummaryResult | null>;
  find: (id: number) => ConversationSession | undefined;
  update: (id: number, change: Partial<ConversationSession>) => void;
}) {
  let running = false;
  return async () => {
    if (running) return null;
    running = true;
    try {
      const result = await input.retry();
      const session = input.find(input.id);
      if (result && session && !session.quarantined) {
        input.update(input.id, {
          messages: session.messages.map(message =>
            message.id === input.messageId
              ? {
                  ...message,
                  healthSummary: result,
                  ...(result.analysis.savedSummary?.status === 'saved'
                    ? { retryHealthSummary: undefined }
                    : {}),
                }
              : message,
          ),
        });
      }
      return result;
    } finally {
      running = false;
    }
  };
}
