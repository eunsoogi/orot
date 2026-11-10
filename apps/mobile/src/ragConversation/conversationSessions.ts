import { createConversationSessionRequests } from './conversationSessionRequests';
import { t } from '../i18n';
import type {
  ConversationSender,
  ConversationSession,
  ConversationSessionOptions,
  ConversationSnapshot,
} from './conversationSessionTypes';
import { createConversationSessionRestoreState } from './conversationSessionRestoreState';
import { createConversationSessionAttachment } from './conversationSessionAttachment';
import { createConversationRetrySave } from './conversationRetrySave';
import { refreshConversationSources } from './conversationSourceRefresh';
import type { SourceDeletionEvent } from '../storage/localDataClearEvents';
import { createConversationListeners } from './conversationListeners';
import { createConversationVisitReviewUpdater } from './conversationVisitReviewUpdate';
import {
  createEmptyConversation,
  initialConversationSnapshot,
  quarantineConversation,
} from './conversationEmptySession';
import {
  createConversationNavigation,
  removeConversation,
  undoMemoryConversation,
  undoRetainedConversation,
} from './conversationSessionTransitions';
export type { ConversationSender, ConversationSession };
let nextSessionOwner = 0;
/** The app owns session state across routes and may provide durable retention. */
export function createConversationSessions(
  options: ConversationSessionOptions = {},
) {
  const owner = ++nextSessionOwner;
  let nextId = 0;
  const empty = () => createEmptyConversation(++nextId);
  let snapshot = initialConversationSnapshot(empty());
  const listeners = createConversationListeners();
  let disposed = false;
  let lifecycle = 0;
  const emit = listeners.emit;
  const apply = (next: ConversationSnapshot | null) => {
    if (next) {
      snapshot = next;
      emit();
    }
  };
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
  const retrySave = createConversationRetrySave({
    find: id => snapshot.sessions.find(session => session.id === id),
    update,
    disposed: () => disposed,
    requests,
    restoration,
    options,
  });
  let deleting = false;
  const quarantinedDrafts = new Map<number, string>();
  const removeRetained = async (id: number) => {
    const exists = snapshot.sessions.some(session => session.id === id);
    if (disposed || deleting || !exists) return;
    if (!quarantinedDrafts.has(id)) quarantinedDrafts.set(id, find(id).draft);
    const started = lifecycle;
    deleting = true;
    options.retention!.prepareRemoval(id);
    requests.abandon(id);
    restoration.forget(id);
    update(id, quarantineConversation());
    try {
      if (snapshot.deleted?.handle !== undefined) {
        await options.retention!.finalize(snapshot.deleted.handle);
        if (lifecycle !== started) return;
        snapshot = { ...snapshot, deleted: null };
        emit();
      }
      const handle = await options.retention!.hide(id);
      if (disposed) {
        await options.retention!.finalize(handle);
        return;
      }
      if (lifecycle !== started) return;
      quarantinedDrafts.delete(id);
      requests.forgetSaves(id);
      update(id, { ...quarantineConversation(), busy: false });
      apply(removeConversation(snapshot, id, empty, handle));
    } catch {
      if (lifecycle !== started) return;
      let activeId: string | null = null;
      try {
        activeId = await options.retention!.resumeIfActive(id);
      } catch {
        /* Unknown state remains quarantined. */
      }
      if (lifecycle !== started) return;
      if (activeId && !disposed) {
        update(id, {
          quarantined: false,
          draft: find(id).draft || quarantinedDrafts.get(id) || '',
          restoreAfterRetry: true,
        });
        quarantinedDrafts.delete(id);
        if (options.restoreSession) await restoration.start(id, activeId);
        else update(id, { restoreFailed: true });
        if (lifecycle !== started) return;
        requests.resumeSaves(id);
        update(id, { restoreAfterRetry: Boolean(find(id).unsavedCount) });
      }
      update(id, {
        busy: false,
        error: t('ragConversation.conversation.deleteFailed'),
        deletionError: t('ragConversation.conversation.deleteFailed'),
      });
    } finally {
      if (lifecycle === started) deleting = false;
    }
  };
  const undoRetained = async () => {
    const deleted = snapshot.deleted;
    if (disposed || deleting || !deleted || deleted.handle === undefined)
      return;
    const started = lifecycle;
    deleting = true;
    try {
      if (deleted.handle?.version != null && !options.restoreSession)
        throw new Error('Conversation restoration is unavailable.');
      await options.retention!.undo(deleted.session.id, deleted.handle);
      if (disposed || lifecycle !== started) return;
      apply(undoRetainedConversation(snapshot, deleted));
      if (deleted.handle?.version != null)
        await restoration.start(deleted.session.id, deleted.handle.id);
    } catch {
      if (lifecycle !== started) return;
      update(snapshot.activeId, {
        error: t('ragConversation.conversation.restoreFailed'),
        deletionError: t('ragConversation.conversation.restoreFailed'),
      });
    } finally {
      if (lifecycle === started) deleting = false;
    }
  };
  return {
    attachExisting: createConversationSessionAttachment({
      retention: options.retention,
      restoration,
      canRestore: Boolean(options.restoreSession),
      empty,
      snapshot: () => snapshot,
      apply,
      valid: () => !disposed,
    }),
    subscribe: listeners.subscribe,
    getSnapshot: () => snapshot,
    setDraft: (id: number, draft: string) => update(id, { draft }),
    setError: (id: number, error: string) => update(id, { error }),
    updateVisitQuestionReview: createConversationVisitReviewUpdater(
      () => snapshot,
      update,
      () => disposed,
    ),
    ...createConversationNavigation({
      snapshot: () => snapshot,
      apply,
      empty,
      disposed: () => disposed,
    }),
    remove(id: number) {
      if (disposed) return;
      if (options.retention) return removeRetained(id);
      const index = snapshot.sessions.findIndex(session => session.id === id);
      if (index < 0) return;
      requests.cancel(id);
      requests.forgetSaves(id);
      apply(removeConversation(snapshot, id, empty));
    },
    undoRemove() {
      if (disposed) return;
      if (options.retention) return undoRetained();
      apply(undoMemoryConversation(snapshot));
    },
    cancel: (id: number) => {
      if (!disposed) requests.cancel(id);
    },
    retrySave,
    retryRestore: (id: number) =>
      disposed ? Promise.resolve() : restoration.retry(id),
    refreshAfterSourceDeletion(...event: SourceDeletionEvent) {
      if (disposed) return;
      refreshConversationSources({
        snapshot,
        event,
        options,
        requests,
        restoration,
        update,
        apply: change => apply({ ...snapshot, ...change }),
      });
    },
    invalidateAll() {
      if (disposed) return;
      lifecycle++;
      requests.dispose();
      restoration.dispose();
      options.retention?.invalidate();
      quarantinedDrafts.clear();
      deleting = false;
      const session = empty();
      snapshot = { activeId: session.id, sessions: [session], deleted: null };
      emit();
    },
    // View subscribers never cancel on exit; only the app owner disposes requests.
    dispose() {
      disposed = true;
      lifecycle++;
      requests.dispose();
      restoration.dispose();
      options.retention?.invalidate();
      quarantinedDrafts.clear();
      if (snapshot.deleted?.handle !== undefined)
        options.retention?.finalize(snapshot.deleted.handle).catch(() => {});
    },
    send: (id: number, onSend: ConversationSender) =>
      disposed ? Promise.resolve() : requests.send(id, onSend),
    // This local identity scopes source access to the selected retained conversation.
    toolSourceSessionId: (id: number) =>
      options.retention?.activeIdentity(id) ?? null,
  };
}
export type ConversationSessions = ReturnType<
  typeof createConversationSessions
>;
