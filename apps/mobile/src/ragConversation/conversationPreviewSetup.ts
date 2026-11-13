import { createConversationRequestPreview } from './conversationRequestPreview';
import type { createConversationTurnRetention } from './conversationTurnRetention';
import type { ConversationSession } from './conversationSessionTypes';

/** Preview storage errors are reported without exposing unvalidated response text. */
export function conversationPreviewSetup(input: {
  readonly id: number;
  readonly retained?: ReturnType<typeof createConversationTurnRetention>;
  readonly current: () => boolean;
  readonly find: (id: number) => ConversationSession;
  readonly update: (id: number, value: Partial<ConversationSession>) => void;
  readonly error: string;
}) {
  if (!input.retained) return undefined;
  return createConversationRequestPreview({
    turn: input.retained,
    current: input.current,
    reportFailure: () => {
      if (!input.find(input.id)?.error)
        input.update(input.id, { error: input.error });
    },
  });
}
