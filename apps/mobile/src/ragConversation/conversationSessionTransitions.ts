import type {
  ConversationSession,
  ConversationSnapshot,
  DeletedConversation,
} from './conversationSessionTypes';

/** Navigation mutates only the app-owned session list. */
export function createConversationNavigation(input: {
  snapshot: () => ConversationSnapshot;
  apply: (value: ConversationSnapshot | null) => void;
  empty: () => ConversationSession;
  disposed: () => boolean;
}) {
  return {
    select(id: number) {
      if (!input.disposed())
        input.apply(selectConversation(input.snapshot(), id));
    },
    create() {
      if (!input.disposed())
        input.apply(addConversation(input.snapshot(), input.empty()));
    },
  };
}

/** Apply local list transitions without touching source records or restoring retained prose. */
export function removeConversation(
  snapshot: ConversationSnapshot,
  id: number,
  empty: () => ConversationSession,
  handle?: DeletedConversation['handle'],
): ConversationSnapshot | null {
  const index = snapshot.sessions.findIndex(session => session.id === id);
  if (index < 0) return null;
  const session = snapshot.sessions[index]!;
  const remaining = snapshot.sessions.filter(item => item.id !== id);
  if (!remaining.length) remaining.push(empty());
  return {
    sessions: remaining,
    activeId: snapshot.activeId === id ? remaining[0]!.id : snapshot.activeId,
    deleted: { session, index, ...(handle !== undefined ? { handle } : {}) },
  };
}

/** Memory-only deletion undo preserves the stopped snapshot and its original list position. */
export function undoMemoryConversation(
  snapshot: ConversationSnapshot,
): ConversationSnapshot | null {
  if (!snapshot.deleted) return null;
  const { session, index } = snapshot.deleted;
  const sessions = [...snapshot.sessions];
  sessions.splice(Math.min(index, sessions.length), 0, session);
  return { activeId: session.id, sessions, deleted: null };
}

/** Retained undo starts empty so only revalidated storage can refill the transcript. */
export function undoRetainedConversation(
  snapshot: ConversationSnapshot,
  deleted: DeletedConversation,
): ConversationSnapshot {
  const session = {
    ...deleted.session,
    messages: [],
    error: '',
    quarantined: false,
  };
  const sessions = [...snapshot.sessions];
  sessions.splice(Math.min(deleted.index, sessions.length), 0, session);
  return { activeId: session.id, sessions, deleted: null };
}

/** Creating and selecting a session never starts inference or changes another draft. */
export function selectConversation(
  snapshot: ConversationSnapshot,
  id: number,
): ConversationSnapshot | null {
  return snapshot.sessions.some(session => session.id === id)
    ? { ...snapshot, activeId: id }
    : null;
}

export function addConversation(
  snapshot: ConversationSnapshot,
  session: ConversationSession,
): ConversationSnapshot {
  return {
    ...snapshot,
    activeId: session.id,
    sessions: [...snapshot.sessions, session],
  };
}
