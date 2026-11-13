import { createConversationSessionRequests } from './conversationSessionRequests';
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
} from './conversationEmptySession';
import { createConversationNavigation } from './conversationSessionTransitions';
import { conversationTreatmentOwnership } from './conversationTreatmentOwnership';
import { createConversationTaskState } from './conversationTaskState';
import { createConversationHistoryLoader } from './conversationHistoryLoader';
import { createConversationSessionRemoval } from './conversationSessionRemoval';
import { createConversationTaskRefresh } from './conversationTaskRefresh';
export type { ConversationSender, ConversationSession };
export type { ConversationSessions } from './conversationSessionTypes';
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
  const taskRefresh = createConversationTaskRefresh({
    options,
    find: id => snapshot.sessions.find(session => session.id === id),
    update,
    valid: () => !disposed,
  });
  const taskState = createConversationTaskState({
    retention: options.retention,
    find: id => snapshot.sessions.find(session => session.id === id),
    update,
    valid: () => !disposed,
    activeId: () => snapshot.activeId,
  });
  const requests = createConversationSessionRequests(
    find,
    update,
    id => `${owner}:${id}`,
    options.retention,
    options.execution,
  );
  const restoration = createConversationSessionRestoreState({
    read: options.restoreSession,
    readTasks: options.restoreTasks,
    update,
  });
  const attachExisting = createConversationSessionAttachment({
    retention: options.retention,
    restoration,
    canRestore: Boolean(options.restoreSession),
    empty,
    snapshot: () => snapshot,
    apply,
    valid: () => !disposed,
  });
  const loadHistory = createConversationHistoryLoader({
    options,
    attach: attachExisting,
    snapshot: () => snapshot,
    lifecycle: () => lifecycle,
    disposed: () => disposed,
  });
  const retrySave = createConversationRetrySave({
    find: id => snapshot.sessions.find(session => session.id === id),
    update,
    disposed: () => disposed,
    requests,
    restoration,
    options,
  });
  const removal = createConversationSessionRemoval({
    options,
    snapshot: () => snapshot,
    apply,
    update,
    empty,
    find,
    requests,
    restoration,
    disposed: () => disposed,
    lifecycle: () => lifecycle,
  });
  return {
    attachExisting,
    loadHistory,
    subscribe: listeners.subscribe,
    getSnapshot: () => snapshot,
    setDraft: (id: number, draft: string) => update(id, { draft }),
    setEntryPrompt: (id: number, entryPrompt?: string) =>
      update(id, { entryPrompt }),
    saveTaskCard: taskState.save,
    forgetTaskCard: taskState.forgetTaskCard,
    setError: (id: number, error: string) => update(id, { error }),
    reportTaskOwner: taskState.reportTaskOwner,
    selectDailyReport: taskState.selectDailyReport,
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
    remove: removal.remove,
    undoRemove: removal.undo,
    cancel: (id: number) => {
      if (!disposed) requests.cancel(id);
    },
    retrySave,
    retryRestore: (id: number, signal?: AbortSignal) =>
      disposed
        ? Promise.resolve()
        : taskRefresh.has(id)
          ? taskRefresh.retry(id)
          : restoration.retry(id, signal),
    refreshAfterSourceDeletion(...event: SourceDeletionEvent) {
      if (disposed) return;
      taskState.invalidateWrites();
      const retryTaskIds = new Set(
        snapshot.sessions
          .filter(session => taskRefresh.has(session.id))
          .map(session => session.id),
      );
      taskRefresh.invalidate();
      refreshConversationSources({
        snapshot,
        event,
        options,
        requests,
        restoration,
        refreshTasks: taskRefresh.start,
        retryTaskIds,
        update,
        apply: change => apply({ ...snapshot, ...change }),
      });
    },
    invalidateAll() {
      if (disposed) return;
      lifecycle++;
      taskState.invalidate();
      taskRefresh.invalidate();
      requests.dispose();
      restoration.dispose();
      options.retention?.invalidate();
      removal.invalidate();
      const session = empty();
      snapshot = { activeId: session.id, sessions: [session], deleted: null };
      emit();
    },
    // View subscribers never cancel on exit; only the app owner disposes requests.
    dispose() {
      disposed = true;
      lifecycle++;
      taskState.invalidate();
      taskRefresh.invalidate();
      requests.dispose();
      restoration.dispose();
      options.retention?.invalidate();
      removal.invalidate();
      if (snapshot.deleted?.handle !== undefined)
        options.retention?.finalize(snapshot.deleted.handle).catch(() => {});
    },
    send: (id: number, onSend: ConversationSender) =>
      disposed ? Promise.resolve() : requests.send(id, onSend),
    /** Adds an explicit turn to the transcript without moving its prompt into the composer. */
    sendPrompt: (id: number, prompt: string, onSend: ConversationSender) =>
      disposed ? Promise.resolve() : requests.send(id, onSend, prompt),
    treatment: conversationTreatmentOwnership(options, () =>
      disposed ? undefined : snapshot,
    ),
    toolSourceSessionId: options.retention?.activeIdentity ?? (() => null),
  };
}
