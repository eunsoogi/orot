import {
  createConversationRootRestoreOwnership,
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
  ConversationSender,
} from './conversationSessionTypes';

/** App-level policy, not a new transcript store. Existing restore/retention fences remain authoritative.
 * A selection failure blocks dispatch instead of starting an apparently empty conversation. */
export function continuousConversationPolicy<
  T extends ContinuousConversationStore,
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
  const abandonInitial = (recover = false) => {
    const target = rootRestore.target;
    if (!target) return undefined;
    const id = store.getSnapshot().activeId;
    const active = recover ? activeRestoration() : undefined;
    interrupted = active && model ? { ...active, model } : undefined;
    rootRestore.clear();
    ++epoch;
    controller?.abort();
    pending = undefined;
    update(id, { modelSelectionPending: false });
    return store.toolSourceSessionId(id) === target.id ? id : undefined;
  };
  const synchronizeModel = (
    refresh = false,
    recovery?: 'restart-interrupted-initial-page',
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
    const activeId = store.getSnapshot().activeId;
    update(activeId, { modelSelectionPending: true });
    const run = async () => {
      try {
        const target = await options.continuousSession!(signal);
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
  const resumeRootRestore = () =>
    rootRestore.reconcile({
      resolve: options.continuousSession!,
      attached: ({ id, version }) => {
        const active = activeRestoration();
        return active?.lease.id === id && active.lease.version === version;
      },
      restart: restartInitial,
    });
  const ready = conversationSelectionReady({
    enabled,
    snapshot: store.getSnapshot,
    synchronize: synchronizeModel,
    controller: () => controller,
    disposed: () => disposed,
    cancel() {
      rootRestore.clear();
      ++epoch;
      controller?.abort();
      pending = undefined;
      update(store.getSnapshot().activeId, { modelSelectionPending: false });
    },
  });
  return {
    ...store,
    continuous: enabled,
    synchronizeModel,
    setRootConversationVisible(visible: boolean) {
      rootRestore.setVisible(visible);
      // A leave and return can land in one React batch without a scene effect.
      if (visible)
        (
          resumeRootRestore() ??
          (interrupted && !pending ? restartInitial() : undefined)
        )?.catch(() => {});
    },
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
    // Route intent may update the current conversation, but cannot create a parallel chat.
    create: () => {
      if (!enabled) store.create();
    },
    prepareSend: ready,
    bindSender(sender: ConversationSender): ConversationSender {
      const expectedConversationModel = model;
      return !enabled || !expectedConversationModel
        ? sender
        : (question, history, signal, observer) =>
            sender(question, history, signal, {
              ...observer,
              expectedConversationModel,
            });
    },
    invalidateAll() {
      rootRestore.clear();
      interrupted = undefined;
      ++epoch;
      controller?.abort();
      pending = undefined;
      store.invalidateAll();
    },
    dispose() {
      rootRestore.clear();
      interrupted = undefined;
      disposed = true;
      ++epoch;
      controller?.abort();
      pending = undefined;
      store.dispose();
    },
  };
}
