import type {
  ConversationSession,
  ConversationSessionOptions,
  ConversationSnapshot,
  ConversationSender,
} from './conversationSessionTypes';

type Store = {
  getSnapshot(): ConversationSnapshot;
  toolSourceSessionId(id: number): string | null;
  attachExisting(
    id: string,
    version: number,
    updatedAt: string,
    select?: boolean,
    current?: () => boolean,
    signal?: AbortSignal,
  ): Promise<number>;
  refreshLease(
    id: number,
    lease: { id: string; version: number },
    current: () => boolean,
    signal: AbortSignal,
  ): Promise<void>;
  select(id: number): void;
  cancel(id: number): void;
  create(): void;
  dispose(): void;
  invalidateAll(): void;
  retryRestore(id: number, signal?: AbortSignal): Promise<void>;
  send(id: number, sender: ConversationSender): Promise<void>;
  sendPrompt(
    id: number,
    prompt: string,
    sender: ConversationSender,
  ): Promise<void>;
};
/** App-level policy, not a new transcript store. Existing restore/retention fences remain authoritative.
 * A selection failure blocks dispatch instead of starting an apparently empty conversation. */
export function continuousConversationPolicy<T extends Store>(
  store: T,
  options: ConversationSessionOptions,
  update: (id: number, change: Partial<ConversationSession>) => void,
) {
  let model: { providerId: string; modelId: string } | undefined;
  let pending: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let epoch = 0;
  let disposed = false;
  const enabled = Boolean(options.continuousSession);
  const synchronizeModel = (refresh = false): Promise<void> => {
    if (!enabled || disposed) return Promise.resolve();
    if (pending && !refresh) return pending;
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
        const existing = store
          .getSnapshot()
          .sessions.find(
            session => store.toolSourceSessionId(session.id) === target.id,
          );
        if (existing) {
          const lease = options.retention?.activeLease(existing.id);
          if (
            !lease ||
            lease.version !== target.version ||
            existing.leaseRefreshRequired
          ) {
            await store.refreshLease(existing.id, target, current, signal);
            if (!current()) return;
          }
          if (existing.id !== activeId) store.cancel(activeId);
          store.select(existing.id);

          update(activeId, {
            modelSelectionPending: false,
            modelSelectionFailed: false,
          });
          return;
        }
        // The old request keeps its own identity and late-event fences; it cannot migrate providers.
        store.cancel(activeId);
        await store.attachExisting(
          target.id,
          target.version,
          target.updatedAt,
          true,
          current,
          signal,
        );
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
  const ready = async (id: number, signal?: AbortSignal) => {
    if (signal?.aborted) return false;
    if (!enabled) return true;
    const work = synchronizeModel();
    const expected = controller;
    const cancel = () => {
      if (controller !== expected) return;
      ++epoch;
      expected?.abort();
      pending = undefined;
      update(store.getSnapshot().activeId, { modelSelectionPending: false });
    };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    try {
      await work;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
    if (
      signal?.aborted ||
      disposed ||
      expected !== controller ||
      expected?.signal.aborted
    )
      return false;
    const snapshot = store.getSnapshot();
    const session = snapshot.sessions.find(item => item.id === id);
    return (
      snapshot.activeId === id &&
      Boolean(session) &&
      !session?.quarantined &&
      !session?.modelSelectionPending &&
      !session?.modelSelectionFailed
    );
  };
  return {
    ...store,
    continuous: enabled,
    synchronizeModel,
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
      ++epoch;
      controller?.abort();
      pending = undefined;
      store.invalidateAll();
    },
    dispose() {
      disposed = true;
      ++epoch;
      controller?.abort();
      pending = undefined;
      store.dispose();
    },
  };
}
