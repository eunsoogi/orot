import { admittedDisplayLease } from './conversationSavedHistoryDisplay';
import {
  createCanonicalHistoryRetry,
  type CanonicalRetryStore,
} from './canonicalHistoryRetry';
import { createConversationWarmAdmission } from './conversationWarmAdmission';
import {
  createConversationRootRestoreOwnership,
  createRootRestoreVisibility,
  ownedArchiveRestore,
} from './conversationRootRestoreOwnership';
import {
  activeRestoringConversation,
  conversationSelectionReady,
  matchesInterruptedConversation,
  type InterruptedConversation,
  type ContinuousConversationStore,
} from './conversationSelectionReady';
import type { SourceDeletionEvent } from '../storage/localDataClearEvents';
import type {
  ConversationSession,
  ConversationSessionOptions,
} from './conversationSessionTypes';
/** Block dispatch on selection failure rather than starting an apparently empty conversation. */
export function continuousConversationPolicy<
  T extends ContinuousConversationStore & CanonicalRetryStore,
>(
  store: T,
  options: ConversationSessionOptions,
  update: (id: number, change: Partial<ConversationSession>) => void,
) {
  let model: { providerId: string; modelId: string } | undefined;
  let pending: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let epoch = 0;
  let disposed = false;
  let interrupted: InterruptedConversation | undefined;
  const enabled = Boolean(options.continuousSession);
  const rootRestore = createConversationRootRestoreOwnership();
  const holdArchive = Boolean(options.readSavedHistoryDisplay);
  const activeRestoration = () =>
    activeRestoringConversation(store.getSnapshot(), options.retention);
  const cancelSelection = () => {
    ++epoch;
    controller?.abort();
    pending = undefined;
  };
  const abandonInitial = (recover = false) => {
    const target = rootRestore.target;
    if (!target) return undefined;
    const id = store.getSnapshot().activeId;
    const active = recover ? activeRestoration() : undefined;
    interrupted = active && model ? { ...active, model } : undefined;
    rootRestore.clear();
    cancelSelection();
    update(id, { modelSelectionPending: false });
    return store.toolSourceSessionId(id) === target.id ? id : undefined;
  };
  const synchronizeModel = (
    refresh = false,
    recovery?: 'restart-interrupted-initial-page',
    origin?: 'send',
  ): Promise<void> => {
    if (!enabled || disposed) return Promise.resolve();
    if (pending && !refresh) return pending;
    const resume = refresh && recovery && resumeRootRestore();
    if (resume) return resume;
    const reopenInterruptedPage =
      recovery === 'restart-interrupted-initial-page';
    if (refresh && reopenInterruptedPage) {
      const active = activeRestoration();
      if (pending && active && model) interrupted = { ...active, model };
    } else if (refresh) interrupted = undefined;
    rootRestore.clear();
    controller?.abort();
    const signal = (controller = new AbortController()).signal;
    const version = ++epoch;
    const current = () => version === epoch && !signal.aborted;
    const start = store.getSnapshot();
    const activeId = start.activeId;
    const admitted = start.sessions.find(item => item.id === activeId);
    const keepDisplay =
      origin === 'send'
        ? admittedDisplayLease(admitted, options.retention)
        : undefined;
    update(activeId, {
      modelSelectionPending: true,
      modelSelectionFailed: false,
      modelSelectionKeepsDisplay: Boolean(keepDisplay),
    });
    const run = async () => {
      try {
        const target = await options.continuousSession!(signal);
        keepDisplay?.withholdUnless(target, () => {
          if (current())
            update(activeId, { modelSelectionKeepsDisplay: false });
        });
        if (!current()) return;
        model = target.model;
        const archive = ownedArchiveRestore({
          root: rootRestore,
          store,
          holdArchive,
          target,
          signal,
          current,
          retention: options.retention,
        });
        const existing = store
          .getSnapshot()
          .sessions.find(
            session => store.toolSourceSessionId(session.id) === target.id,
          );
        if (existing) {
          const lease = options.retention?.activeLease(existing.id);
          const restart =
            reopenInterruptedPage &&
            matchesInterruptedConversation(
              interrupted,
              existing,
              activeId,
              store.getSnapshot().activeId,
              target,
              lease,
            );
          if (
            !lease ||
            lease.version !== target.version ||
            existing.leaseRefreshRequired
          ) {
            await store.refreshLease(existing.id, target, current, signal);
            if (!current()) return;
          } else if (restart) {
            // The cancelled reader cannot publish. Only a fresh matching retained
            // lease may start another initial page under this selection owner.
            await archive.restart(existing.id);
            if (!current()) return;
          }
          interrupted = undefined;
          if (existing.id !== activeId) store.cancel(activeId);
          store.select(existing.id);
          update(activeId, {
            modelSelectionPending: false,
            modelSelectionFailed: false,
          });
          return;
        }
        interrupted = undefined;
        // The old request keeps its own identity and late-event fences; it cannot migrate providers.
        store.cancel(activeId);
        await archive.attach();
        if (current())
          update(activeId, {
            modelSelectionPending: false,
            modelSelectionFailed: false,
          });
      } catch {
        if (current())
          update(store.getSnapshot().activeId, {
            modelSelectionPending: false,
            modelSelectionFailed: true,
          });
      }
    };
    const work = run();
    pending = work;
    work
      .finally(() => {
        if (pending === work) pending = undefined;
      })
      .catch(() => {});
    return work;
  };
  const restartInitial = () =>
    synchronizeModel(true, 'restart-interrupted-initial-page');
  const { resume: resumeRootRestore, setVisible: setRootConversationVisible } =
    createRootRestoreVisibility(
      rootRestore,
      options.continuousSession!,
      activeRestoration,
      restartInitial,
      () => Boolean(interrupted && !pending),
    );
  const retireSelection = () => {
    rootRestore.clear();
    interrupted = undefined;
    cancelSelection();
  };
  const ready = conversationSelectionReady({
    enabled,
    snapshot: store.getSnapshot,
    synchronize: () => synchronizeModel(false, undefined, 'send'),
    controller: () => controller,
    disposed: () => disposed,
    cancel() {
      rootRestore.clear();
      cancelSelection();
      update(store.getSnapshot().activeId, { modelSelectionPending: false });
    },
  });
  const selectionEpoch = () => (pending || disposed ? -1 : epoch);
  const warm = createConversationWarmAdmission(
    store,
    options,
    selectionEpoch,
    ready,
    update,
  );
  return {
    ...store,
    continuous: enabled,
    synchronizeModel,
    retryRestore: createCanonicalHistoryRetry(
      store,
      options,
      rootRestore.captureVisibility,
      selectionEpoch,
      update,
    ),
    setRootConversationVisible,
    cancel(id: number) {
      if (store.getSnapshot().activeId === id) abandonInitial();
      store.cancel(id);
    },
    remove(id: number) {
      if (store.getSnapshot().activeId === id) abandonInitial();
      return store.remove(id);
    },
    refreshAfterSourceDeletion(...event: SourceDeletionEvent) {
      const deferReloadId = abandonInitial(true);
      store.refreshAfterSourceDeletionOwned(event, deferReloadId);
      if (interrupted && rootRestore.visible) restartInitial().catch(() => {});
    },
    prepareLocalReportModel: warm.prepareLocalReportModel,
    create: () => {
      if (!enabled) store.create();
    },
    prepareSend: warm.prepare,
    bindSender: warm.binder(() => (enabled ? model : undefined)),
    invalidateAll() {
      retireSelection();
      store.invalidateAll();
    },
    dispose() {
      disposed = true;
      retireSelection();
      store.dispose();
    },
  };
}
