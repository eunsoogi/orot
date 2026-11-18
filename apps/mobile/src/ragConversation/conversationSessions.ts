import { withConversationArchive } from './conversationArchive';
import { invalidateTasks } from './invalidateConversationTaskRefresh';
import { conversationPhotoSurface } from './conversationPhotoSurface';
import { prepareConversationSend } from './conversationSendPreflight';
import type { SourceDeletionEvent } from '../storage/localDataClearEvents';
import { continuousConversationPolicy } from './continuousConversationPolicy';
import { conversationRecoveryActions } from './conversationRecoveryActions';
import { createConversationSessionRequests } from './conversationSessionRequests';
import { conversationDispatch } from './conversationDispatch';
import type * as S from './conversationSessionTypes';
import { createConversationSessionRestoreState } from './conversationSessionRestoreState';
import { createConversationSessionAttachment } from './conversationSessionAttachment';
import { createConversationRetrySave } from './conversationRetrySave';
import { refreshConversationSources } from './conversationSourceRefresh';
import { createConversationListeners } from './conversationListeners';
import { createConversationVisitReviewUpdater } from './conversationVisitReviewUpdate';
import {
  createConversationSessionSeed,
  initialConversationSnapshot,
} from './conversationEmptySession';
import { createConversationNavigation } from './conversationSessionTransitions';
import { conversationTreatmentOwnership } from './conversationTreatmentOwnership';
import { createConversationHistoryLoader } from './conversationHistoryLoader';
import { createConversationSessionRemoval } from './conversationSessionRemoval';
import { createConversationTasks } from './createConversationTasks';
export type ConversationSender = S.ConversationSender;
export type ConversationSession = S.ConversationSession;
export type ConversationSessions = S.ConversationSessions;
export function createConversationSessions(
  options: S.ConversationSessionOptions = {},
) {
  const { owner, empty } = createConversationSessionSeed();
  let bindSender = (sender: S.ConversationSender) => sender;
  let beforeSend: Parameters<typeof conversationDispatch>[0]['beforeSend'];
  let snapshot = initialConversationSnapshot(empty());
  const listeners = createConversationListeners();
  let disposed = false;
  let lifecycle = 0;
  const photoSurface = conversationPhotoSurface(options);
  const { photoDrafts, photoConsent } = photoSurface;
  const apply = (next: S.ConversationSnapshot | null) => {
    if (next) {
      snapshot = next;
      listeners.emit();
    }
  };
  const update = (
    id: number,
    change: Partial<S.ConversationSession>,
    stream = false,
  ) => {
    if (disposed) return;
    snapshot = {
      ...snapshot,
      sessions: snapshot.sessions.map(session =>
        session.id === id ? { ...session, ...change } : session,
      ),
    };
    if (stream) listeners.emitStream();
    else listeners.emit();
  };
  const find = (id: number) => snapshot.sessions.find(item => item.id === id)!;
  const { taskState, taskRefresh } = createConversationTasks({
    options,
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
    {
      requested: false,
      drafts: photoDrafts,
      consent: photoConsent,
      preparation: options.photoPreparation,
    },
    options.coldResume,
  );
  const restoration = createConversationSessionRestoreState({
    read: options.restoreSession,
    page: options.restoreSessionPage,
    find,
    readSteering: options.restoreSteering,
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
    finalizeDraft: id => {
      photoDrafts.retireSession(id).catch(() => {});
    },
  });
  const dispatch = conversationDispatch({
    bindSender: sender => bindSender(sender),
    beforeSend: options.continuousSession
      ? (id, signal) => beforeSend!(id, signal)
      : undefined,
    requests,
    find,
    update,
    current: id => !options.continuousSession || snapshot.activeId === id,
    photoDrafts,
    retention: options.retention,
    disposed: () => disposed,
  });
  const store = {
    ...conversationRecoveryActions({
      options,
      find,
      update,
      restoration,
      taskRefresh,
      disposed: () => disposed,
    }),
    resumeCold: requests.resumeCold,
    steer: requests.steer,
    ...photoSurface,
    attachExisting,
    loadHistory,
    loadOlderHistory: restoration.loadOlder,
    subscribe: listeners.subscribe,
    getSnapshot: () => snapshot,
    setDraft: (id: number, draft: string) => update(id, { draft }),
    setEntryPrompt: (id: number, entryPrompt?: string) =>
      update(id, { entryPrompt }),
    prepareEntry: taskState.prepareEntry,
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
      dispatch.cancelBeforeSend(id);
      if (!disposed) requests.cancel(id);
    },
    retrySave,
    refreshAfterSourceDeletion(...event: SourceDeletionEvent) {
      if (disposed) return;
      const retryIds = invalidateTasks(snapshot, taskState, taskRefresh);
      refreshConversationSources({
        snapshot,
        event,
        options,
        requests,
        restoration,
        refreshTasks: taskRefresh.start,
        retryTaskIds: retryIds,
        update,
        apply: change => apply({ ...snapshot, ...change }),
      });
    },
    invalidateAll() {
      if (disposed) return;
      photoConsent.dispose();
      photoDrafts.clear().catch(() => {});
      lifecycle++;
      taskState.invalidate();
      taskRefresh.invalidate();
      dispatch.disposeBeforeSend();
      requests.dispose();
      restoration.dispose();
      options.retention?.invalidate();
      removal.invalidate();
      const session = empty();
      snapshot = { activeId: session.id, sessions: [session], deleted: null };
      listeners.emit();
    },
    dispose() {
      photoConsent.dispose();
      photoDrafts.clear().catch(() => {});
      disposed = true;
      listeners.dispose();
      lifecycle++;
      taskState.invalidate();
      taskRefresh.invalidate();
      dispatch.disposeBeforeSend();
      requests.dispose();
      restoration.dispose();
      options.retention?.invalidate();
      removal.invalidate();
      if (snapshot.deleted?.handle !== undefined)
        options.retention?.finalize(snapshot.deleted.handle).catch(() => {});
    },
    ...dispatch,
    treatment: conversationTreatmentOwnership(options, () =>
      disposed ? undefined : snapshot,
    ),
    toolSourceSessionId: options.retention?.activeIdentity ?? (() => null),
  };
  const policy = continuousConversationPolicy(store, options, update);
  beforeSend = prepareConversationSend({
    select: policy.prepareSend,
    context: restoration.prepareContext,
    find,
    current: id => !disposed && snapshot.activeId === id,
  });
  bindSender = policy.bindSender;
  return withConversationArchive(policy, options);
}
