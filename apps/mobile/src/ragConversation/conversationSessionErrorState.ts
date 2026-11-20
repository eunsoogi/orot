import type {
  ConversationSession,
  ConversationSnapshot,
} from './conversationSessionTypes';

// Keep local preflight notice placement tied to its original error and draft.
export const conversationSessionErrorState = {
  update(
    snapshot: ConversationSnapshot,
    id: number,
    change: Partial<ConversationSession>,
  ): ConversationSnapshot {
    return {
      ...snapshot,
      sessions: snapshot.sessions.map(session =>
        session.id === id
          ? {
              ...session,
              // A subsequent ordinary error must not inherit local preflight placement.
              ...(change.error !== undefined && session.errorSurface
                ? { errorSurface: undefined }
                : {}),
              ...change,
            }
          : session,
      ),
    };
  },
  editDraft(
    session: ConversationSession | undefined,
    draft: string,
  ): Partial<ConversationSession> {
    return {
      draft,
      // The notice describes the rejected draft, not the newly edited text.
      ...(session?.errorSurface === 'composerPreflight' &&
      session.draft !== draft
        ? { error: '' }
        : {}),
    };
  },
};
