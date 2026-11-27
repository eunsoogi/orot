import {
  ownsActiveArchiveLease,
  type ContinuousConversationStore,
} from './conversationSelectionReady';
import type { ConversationHistoryReaderOwner } from './conversationHistoryPage';
import type {
  ConversationSession,
  ConversationSessionOptions,
} from './conversationSessionTypes';

export const unfinishedCanonical = (owner?: ConversationHistoryReaderOwner) =>
  Boolean(owner?.canonicalInitial && !owner.initialized);

type Lease = { readonly id: string; readonly version: number };
export type PrepareSavedHistoryRetry = (
  lease: Lease,
  signal: AbortSignal,
) => Promise<{ current(): boolean; recheck(): Promise<boolean> } | undefined>;

export type CanonicalRetryStore = {
  hasTaskRestore(id: number): boolean;
  needsCanonicalRetry(id: number): boolean;
  retryRestore(id: number, signal?: AbortSignal): Promise<void>;
};

/** An explicit retry of an abandoned canonical first page never runs selection or creates a lease. */
export function createCanonicalHistoryRetry(
  store: ContinuousConversationStore & CanonicalRetryStore,
  options: ConversationSessionOptions,
  captureVisibility: () => () => boolean,
  epoch: () => number,
  update: (id: number, change: Partial<ConversationSession>) => void,
) {
  let flight: Promise<void> | undefined;
  return (id: number, callerSignal?: AbortSignal): Promise<void> => {
    if (store.hasTaskRestore(id) || !store.needsCanonicalRetry(id))
      return store.retryRestore(id, callerSignal);
    if (flight) return flight;
    const lease = options.retention?.activeLease(id);
    const active = store.getSnapshot().sessions.find(row => row.id === id);
    if (!lease || !active?.restoreFailed || !options.prepareSavedHistoryRetry)
      return Promise.resolve();
    const signal = callerSignal ?? new AbortController().signal;
    const stillVisible = captureVisibility();
    const started = epoch();
    const current = () =>
      started >= 0 &&
      epoch() === started &&
      !signal.aborted &&
      stillVisible() &&
      ownsActiveArchiveLease(store.getSnapshot(), options.retention, id, lease);
    if (!current()) return Promise.resolve();
    const work = Promise.resolve()
      .then(async () => {
        if (!current()) return;
        const proof = await options.prepareSavedHistoryRetry?.(lease, signal);
        const owned = () => current() && proof?.current() === true;
        if (!proof || !owned()) return;
        await store.retryInitialRestore(id, lease.id, signal, owned, {
          async wait(readSignal) {
            if (readSignal.aborted || !owned() || !(await proof.recheck()))
              throw new Error('Conversation restoration was cancelled.');
            return () => {
              if (readSignal.aborted || !owned())
                throw new Error('Conversation restoration was cancelled.');
            };
          },
        });
      })
      .catch(() => {
        // A denied or unavailable proof leaves the original failed state retryable.
      });
    flight = work;
    // A presentation flag leaves the existing recovery and dispatch guards intact.
    update(id, { historyRetryPending: true });
    work
      .finally(() => {
        if (flight !== work) return;
        flight = undefined;
        update(id, { historyRetryPending: false });
      })
      .catch(() => {});
    return work;
  };
}
