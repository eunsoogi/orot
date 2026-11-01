import { createConversationSessionRequests } from './conversationSessionRequests';
import { getRagConversationCopy } from './copy';
import type {
  ConversationSender,
  ConversationSession,
} from './conversationSessionRequests';

export type {
  ConversationSender,
  ConversationSession,
} from './conversationSessionRequests';

/** App-owned memory-only sessions survive route removal without persisting health text. */
export function createConversationSessions() {
  let nextId = 0;
  const empty = (): ConversationSession => ({
    id: ++nextId,
    title: getRagConversationCopy().newConversation,
    createdAt: new Date().toISOString(),
    draft: '',
    messages: [],
    pendingMessage: null,
    busy: false,
    error: '',
  });
  let snapshot = {
    activeId: 1,
    sessions: [empty()] as readonly ConversationSession[],
    deleted: null as { session: ConversationSession; index: number } | null,
  };
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());
  const update = (id: number, change: Partial<ConversationSession>) => {
    snapshot = {
      ...snapshot,
      sessions: snapshot.sessions.map(session =>
        session.id === id ? { ...session, ...change } : session,
      ),
    };
    emit();
  };
  const find = (id: number) =>
    snapshot.sessions.find(session => session.id === id)!;
  const requests = createConversationSessionRequests(find, update);
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    setDraft: (id: number, draft: string) => update(id, { draft }),
    setError: (id: number, error: string) => update(id, { error }),
    select(id: number) {
      if (!snapshot.sessions.some(session => session.id === id)) return;
      snapshot = { ...snapshot, activeId: id };
      emit();
    },
    create() {
      const session = empty();
      snapshot = {
        ...snapshot,
        activeId: session.id,
        sessions: [...snapshot.sessions, session],
      };
      emit();
    },
    // Deleting a conversation never removes its source records. Undo retains a stopped snapshot.
    remove(id: number) {
      const index = snapshot.sessions.findIndex(session => session.id === id);
      if (index < 0) return;
      requests.cancel(id);
      const session = find(id);
      const remaining = snapshot.sessions.filter(item => item.id !== id);
      if (!remaining.length) remaining.push(empty());
      snapshot = {
        sessions: remaining,
        activeId:
          snapshot.activeId === id ? remaining[0]!.id : snapshot.activeId,
        deleted: { session, index },
      };
      emit();
    },
    undoRemove() {
      if (!snapshot.deleted) return;
      const { session, index } = snapshot.deleted;
      const sessions = [...snapshot.sessions];
      sessions.splice(Math.min(index, sessions.length), 0, session);
      snapshot = { activeId: session.id, sessions, deleted: null };
      emit();
    },
    cancel: requests.cancel,
    // View subscribers never cancel on exit; only the app owner disposes requests.
    dispose: requests.dispose,
    send: (id: number, onSend: ConversationSender) => requests.send(id, onSend),
  };
}
export type ConversationSessions = ReturnType<
  typeof createConversationSessions
>;
