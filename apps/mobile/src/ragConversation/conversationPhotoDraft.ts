import { createConversationPhotoCleanup } from './conversationPhotoCleanup';

export type PhotoDraftFailure =
  'unsupported' | 'empty' | 'protection' | 'unavailable';
type State<T> =
  | { readonly status: 'empty' }
  | { readonly status: 'preparing'; readonly photo?: T }
  | { readonly status: 'ready'; readonly photo: T }
  | {
      readonly status: 'error';
      readonly photo?: T;
      readonly reason?: PhotoDraftFailure;
    };

/** Owns selected originals until the session explicitly removes or transfers them. */
export function createConversationPhotoDrafts<T>(operations: {
  readonly pick: () => Promise<T | null>;
  readonly discard: (photo: T) => Promise<void>;
  readonly captureValidity?: () => () => boolean;
  readonly errorReason?: (error: unknown) => PhotoDraftFailure | undefined;
}) {
  const states = new Map<number, State<T>>();
  const empty: State<T> = { status: 'empty' };
  const listeners = new Set<() => void>();
  const notify = () =>
    listeners.forEach(listener => {
      try {
        listener();
      } catch {
        /* A view cannot interrupt protected-file ownership. */
      }
    });
  const revisions = new Map<number, number>();
  const cleanup = createConversationPhotoCleanup(operations.discard, notify);
  const removing = new Map<number, Promise<void>>();
  let picking = false;
  let clearing: Promise<void> | undefined;
  const { discard, retire, retireAll, retry: retryCleanup } = cleanup;
  const get = (id: number): State<T> => states.get(id) ?? empty;
  const update = (id: number, state: State<T>) => {
    states.set(id, state);
    notify();
  };
  const previousPhoto = (state: State<T>): T | undefined =>
    'photo' in state ? state.photo : undefined;
  const advance = (id: number) => {
    const revision = (revisions.get(id) ?? 0) + 1;
    revisions.set(id, revision);
    return revision;
  };
  const remove = (id: number): Promise<void> => {
    const pending = removing.get(id);
    if (pending) return pending;
    const current = previousPhoto(get(id));
    const revision = advance(id);
    if (!current) {
      update(id, empty);
      return Promise.resolve();
    }
    const work = (async () => {
      try {
        await Promise.resolve().then(() => discard(current));
      } catch (error) {
        if (revisions.get(id) === revision)
          update(id, { status: 'error', photo: current });
        throw error;
      } finally {
        removing.delete(id);
      }
      if (revisions.get(id) === revision) update(id, empty);
    })();
    removing.set(id, work);
    return work;
  };
  return {
    get,
    isPicking: () => picking,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    cleanupPending: cleanup.hasFailure,
    failedCleanupSessionIds: cleanup.failedIds,
    retryCleanup,
    remove,
    clear() {
      if (clearing) return clearing;
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const task = new Promise<void>((done, fail) => {
        resolve = done;
        reject = fail;
      });
      clearing = task;
      const current = [...states].map(([id, state]) => ({
        id,
        photo: previousPhoto(state),
      }));
      // Hide every draft before asynchronous cleanup; a failed deletion must not restore visible health data.
      for (const { id } of current) {
        advance(id);
        update(id, empty);
      }
      const work = [
        ...current.flatMap(({ id, photo }) =>
          photo ? [retire(id, photo)] : [],
        ),
        ...cleanup.pendingIds().map(retryCleanup),
      ];
      Promise.allSettled(work).then(results => {
        clearing = undefined;
        notify();
        const failure = results.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') reject(failure.reason);
        else resolve();
      });
      return task;
    },
    async select(id: number) {
      // A second picker cannot use a file whose removal or replacement is still settling.
      if (
        clearing ||
        picking ||
        removing.has(id) ||
        get(id).status === 'preparing'
      )
        return;
      picking = true;
      try {
        const prior = previousPhoto(get(id));
        const valid = operations.captureValidity?.() ?? (() => true);
        const revision = advance(id);
        update(id, { status: 'preparing', photo: prior });
        // Subscribers may synchronously remove the session before the picker is presented.
        if (revisions.get(id) !== revision) return;
        if (!valid()) {
          update(id, { status: 'error' });
          if (prior) await retire(id, prior);
          return;
        }
        let selected: T | null;
        try {
          selected = await operations.pick();
        } catch (error) {
          if (revisions.get(id) === revision) {
            const reason = operations.errorReason?.(error);
            update(
              id,
              valid()
                ? {
                    status: 'error',
                    photo: prior,
                    ...(reason ? { reason } : {}),
                  }
                : { status: 'error' },
            );
            if (!valid() && prior) await retire(id, prior);
          }
          return;
        }
        if (revisions.get(id) !== revision) {
          if (selected) await retire(id, selected);
          return;
        }
        if (!valid()) {
          update(id, { status: 'error' });
          await retireAll(
            id,
            [selected, prior].filter((photo): photo is T => photo != null),
          );
          return;
        }
        if (!selected) {
          update(
            id,
            prior ? { status: 'ready', photo: prior } : { status: 'empty' },
          );
          return;
        }
        if (prior) {
          try {
            await discard(prior);
          } catch {
            if (revisions.get(id) === revision)
              update(id, { status: 'error', photo: prior });
            await retire(id, selected);
            return;
          }
        }
        if (revisions.get(id) !== revision) {
          await retire(id, selected);
          return;
        }
        if (!valid()) {
          update(id, { status: 'error' });
          await retire(id, selected);
          return;
        }
        update(id, { status: 'ready', photo: selected });
      } finally {
        picking = false;
        notify();
      }
    },
  };
}
