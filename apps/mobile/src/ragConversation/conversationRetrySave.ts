import type {
  ConversationSession,
  ConversationSessionOptions,
} from './conversationSessionTypes';
import type { createConversationSessionRequests } from './conversationSessionRequests';
import type { createConversationSessionRestoreState } from './conversationSessionRestoreState';

/** A saved retry becomes visible only after the same source-validated restore used by undo. */
export function createConversationRetrySave(input: {
  find: (id: number) => ConversationSession | undefined;
  update: (id: number, change: Partial<ConversationSession>) => void;
  disposed: () => boolean;
  requests: ReturnType<typeof createConversationSessionRequests>;
  restoration: ReturnType<typeof createConversationSessionRestoreState>;
  options: ConversationSessionOptions;
}) {
  return async (id: number) => {
    const before = input.find(id);
    if (
      input.disposed() ||
      !before ||
      before.busy ||
      before.restoring ||
      before.quarantined
    )
      return;
    await input.requests.retrySave(id);
    const after = input.find(id);
    const durableId = input.options.retention?.activeIdentity(id);
    if (
      !input.disposed() &&
      after &&
      !after.quarantined &&
      after.restoreAfterRetry &&
      durableId &&
      input.options.restoreSession &&
      (after.unsavedCount ?? 0) < (before.unsavedCount ?? 0)
    ) {
      await input.restoration.start(id, durableId);
      if (!input.disposed() && input.find(id) && !input.find(id)?.unsavedCount)
        input.update(id, { restoreAfterRetry: false });
    }
  };
}
