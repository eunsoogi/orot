import { createConversationSessionRequests } from './conversationSessionRequests';
import { getRagConversationCopy } from './copy';
import type {
  ConversationSender,
  ConversationSession,
} from './conversationSessionRequests';
import type { createConversationSessionRetention } from './conversationSessionRetention';
import type { EvidenceReference } from '@orot/agent-runtime';
import { createConversationSessionRestoreState } from './conversationSessionRestoreState';

export type {
  ConversationSender,
  ConversationSession,
} from './conversationSessionRequests';

let nextSessionOwner = 0;

/** App-owned memory-only sessions survive route removal without persisting health text. */
export function createConversationSessions(
  options: {
    readonly retention?: ReturnType<typeof createConversationSessionRetention>;
    readonly restoreSession?: (
      id: string,
      signal: AbortSignal,
    ) => Promise<
      readonly {
        question: string;
        answer: string;
        citations: readonly EvidenceReference[];
      }[]
    >;
  } = {},
) {
  const owner = ++nextSessionOwner;
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
    deleted: null as {
      session: ConversationSession;
      index: number;
      handle?: { id: string; version: number | null } | null;
    } | null,
  };
  const listeners = new Set<() => void>();
  let disposed = false;
  const emit = () => listeners.forEach(listener => listener());
  const update = (id: number, change: Partial<ConversationSession>) => {
    if (disposed) return;
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
  const requests = createConversationSessionRequests(
    find,
    update,
    id => `${owner}:${id}`,
    options.retention,
  );
  const restoration = createConversationSessionRestoreState({
    read: options.restoreSession,
    update,
  });
  let deleting = false;
  const removeLocal = (
    id: number,
    handle?: { id: string; version: number | null } | null,
  ) => {
    const index = snapshot.sessions.findIndex(session => session.id === id);
    if (index < 0) return;
    const session = find(id);
    const remaining = snapshot.sessions.filter(item => item.id !== id);
    if (!remaining.length) remaining.push(empty());
    snapshot = {
      sessions: remaining,
      activeId: snapshot.activeId === id ? remaining[0]!.id : snapshot.activeId,
      deleted: { session, index, ...(handle !== undefined ? { handle } : {}) },
    };
    emit();
  };
  const removeRetained = async (id: number) => {
    if (
      disposed ||
      deleting ||
      !snapshot.sessions.some(session => session.id === id)
    )
      return;
    deleting = true;
    requests.abandon(id);
    restoration.forget(id);
    // A lost acknowledgement may mean the hide committed; withhold cached prose immediately.
    update(id, {
      busy: true,
      deletionError: '',
      quarantined: true,
      messages: [],
      draft: '',
      title: getRagConversationCopy().newConversation,
      unsavedCount: 0,
    });
    try {
      if (snapshot.deleted?.handle !== undefined) {
        await options.retention!.finalize(snapshot.deleted.handle);
        snapshot = { ...snapshot, deleted: null };
        emit();
      }
      const handle = await options.retention!.hide(id);
      if (disposed) {
        await options.retention!.finalize(handle);
        return;
      }
      update(id, {
        busy: false,
        messages: [],
        draft: '',
        title: getRagConversationCopy().newConversation,
        unsavedCount: 0,
      });
      removeLocal(id, handle);
    } catch {
      update(id, {
        busy: false,
        error: '대화를 삭제하지 못했어요. 다시 시도해 주세요.',
        deletionError: '대화를 삭제하지 못했어요. 다시 시도해 주세요.',
      });
    } finally {
      deleting = false;
    }
  };
  const undoRetained = async () => {
    const deleted = snapshot.deleted;
    if (disposed || deleting || !deleted || deleted.handle === undefined)
      return;
    deleting = true;
    try {
      if (deleted.handle?.version != null && !options.restoreSession)
        throw new Error('Conversation restoration is unavailable.');
      await options.retention!.undo(deleted.session.id, deleted.handle);
      if (disposed) return;
      const session = {
        ...deleted.session,
        messages: [],
        error: '',
        quarantined: false,
      };
      const sessions = [...snapshot.sessions];
      sessions.splice(Math.min(deleted.index, sessions.length), 0, session);
      snapshot = { activeId: session.id, sessions, deleted: null };
      emit();
      if (deleted.handle?.version != null)
        await restoration.start(session.id, deleted.handle.id);
    } catch {
      update(snapshot.activeId, {
        error: '대화를 복원하지 못했어요. 다시 시도해 주세요.',
        deletionError: '대화를 복원하지 못했어요. 다시 시도해 주세요.',
      });
    } finally {
      deleting = false;
    }
  };
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
      if (disposed) return;
      if (!snapshot.sessions.some(session => session.id === id)) return;
      snapshot = { ...snapshot, activeId: id };
      emit();
    },
    create() {
      if (disposed) return;
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
      if (disposed) return;
      if (options.retention) return removeRetained(id);
      const index = snapshot.sessions.findIndex(session => session.id === id);
      if (index < 0) return;
      requests.cancel(id);
      requests.forgetSaves(id);
      removeLocal(id);
    },
    undoRemove() {
      if (disposed) return;
      if (options.retention) return undoRetained();
      if (!snapshot.deleted) return;
      const { session, index } = snapshot.deleted;
      const sessions = [...snapshot.sessions];
      sessions.splice(Math.min(index, sessions.length), 0, session);
      snapshot = { activeId: session.id, sessions, deleted: null };
      emit();
    },
    cancel: (id: number) => {
      if (!disposed) requests.cancel(id);
    },
    retrySave: (id: number) =>
      disposed ? Promise.resolve() : requests.retrySave(id),
    retryRestore: (id: number) =>
      disposed ? Promise.resolve() : restoration.retry(id),
    // View subscribers never cancel on exit; only the app owner disposes requests.
    dispose() {
      disposed = true;
      requests.dispose();
      restoration.dispose();
      if (snapshot.deleted?.handle !== undefined)
        options.retention?.finalize(snapshot.deleted.handle).catch(() => {});
    },
    send: (id: number, onSend: ConversationSender) =>
      disposed ? Promise.resolve() : requests.send(id, onSend),
  };
}
export type ConversationSessions = ReturnType<
  typeof createConversationSessions
>;
