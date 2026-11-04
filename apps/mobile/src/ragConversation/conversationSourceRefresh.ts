import { createEmptyConversation } from './conversationEmptySession';
import type {
  ConversationSessionOptions,
  ConversationSnapshot,
  ConversationSession,
} from './conversationSessionTypes';
import type { createConversationSessionRequests } from './conversationSessionRequests';
import type { createConversationSessionRestoreState } from './conversationSessionRestoreState';

/** Withhold cached answers synchronously and reload only surviving durable turns. */
export function refreshConversationSources(input: {
  snapshot: ConversationSnapshot;
  options: ConversationSessionOptions;
  requests: ReturnType<typeof createConversationSessionRequests>;
  restoration: ReturnType<typeof createConversationSessionRestoreState>;
  update: (id: number, change: Partial<ConversationSession>) => void;
  apply: (next: ConversationSnapshot) => void;
}) {
  const { snapshot, options, requests, restoration, update } = input;
  for (const session of snapshot.sessions) {
    requests.abandon(session.id);
    requests.forgetSaves(session.id);
    restoration.forget(session.id);
    const durableId = options.retention?.activeIdentity(session.id);
    update(session.id, {
      messages: [],
      title: createEmptyConversation(session.id).title,
      pendingMessage: null,
      unsavedCount: 0,
      error: '',
      restoreFailed: false,
      artifactContinuation: null,
    });
    if (durableId && options.restoreSession)
      restoration.start(session.id, durableId).catch(() => {});
  }
  // Undo snapshots may hold deleted source text even when their session is hidden.
  if (snapshot.deleted) {
    const handle = snapshot.deleted.handle;
    input.apply({ ...snapshot, deleted: null });
    if (handle !== undefined)
      options.retention?.finalize(handle).catch(() => {});
  }
}
