import { createConversationPhotoCleanup } from './conversationPhotoCleanup';
import { createConversationPhotoHandoffs } from './conversationPhotoHandoff';
import { createPhotoNotifications } from './conversationPhotoNotifications';
import { previousConversationPhoto as previousPhoto } from './conversationPhotoTypes';
import type { PhotoRequestIdentity } from './conversationPhotoHandoff';
import type {
  ConversationPhotoState as State,
  PhotoDraftFailure,
  PhotoValidity,
} from './conversationPhotoTypes';

/** Owns selected originals until the session explicitly removes or transfers them. */
export function createConversationPhotoDrafts<T>(operations: {
  readonly pick: () => Promise<T | null>;
  readonly discard: (photo: T) => Promise<void>;
  readonly captureValidity?: () => () => boolean;
  readonly captureGeneration?: () => number;
  readonly errorReason?: (error: unknown) => PhotoDraftFailure | undefined;
  readonly snapshot?: (photo: T) => T;
}) {
  const states = new Map<number, State<T>>();
  const empty: State<T> = { status: 'empty' };
  const { notify, subscribe } = createPhotoNotifications();
  const revisions = new Map<number, number>();
  const validity = new Map<number, PhotoValidity>();
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
  const advance = (id: number) => {
    const revision = (revisions.get(id) ?? 0) + 1;
    revisions.set(id, revision);
    return revision;
  };
  const handoffs = createConversationPhotoHandoffs<T>({
    committed: id => {
      validity.delete(id);
      update(id, empty);
    },
    rolledBack: async (id, photo, removed) => {
      if (removed) {
        validity.delete(id);
        update(id, empty);
        await retire(id, photo);
      } else update(id, { status: 'ready', photo });
    },
  });
  const remove = (id: number): Promise<void> => {
    const pending = removing.get(id);
    if (pending) return pending;
    const handoff = handoffs.detach(id);
    if (handoff) {
      advance(id);
      validity.delete(id);
      update(id, empty);
      return handoff;
    }
    const current = previousPhoto(get(id));
    const revision = advance(id);
    if (!current) {
      validity.delete(id);
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
      if (revisions.get(id) === revision) {
        validity.delete(id);
        update(id, empty);
      }
    })();
    removing.set(id, work);
    return work;
  };
  return {
    get,
    isPicking: () => picking,
    subscribe,
    cleanupPending: cleanup.hasFailure,
    failedCleanupSessionIds: cleanup.failedIds,
    retryCleanup,
    remove,
    retireSession(id: number) {
      const handoff = handoffs.detach(id);
      const photo = previousPhoto(get(id));
      advance(id);
      validity.delete(id);
      update(id, empty);
      return handoff ?? (photo ? retire(id, photo) : Promise.resolve());
    },
    beginHandoff(id: number, identity: PhotoRequestIdentity) {
      const state = get(id);
      if (clearing || picking || removing.has(id) || state.status !== 'ready')
        return null;
      const captured = validity.get(id);
      const valid = captured?.valid ?? (() => true);
      const photo = operations.snapshot?.(state.photo) ?? state.photo;
      const lease = handoffs.begin(
        id,
        photo,
        identity,
        valid,
        captured?.generation,
      );
      if (lease) update(id, { status: 'transferring', photo });
      return lease;
    },
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
        handoff: handoffs.detach(id),
      }));
      // Hide every draft before asynchronous cleanup; a failed deletion must not restore visible health data.
      for (const { id } of current) {
        advance(id);
        validity.delete(id);
        update(id, empty);
      }
      const work = [
        ...current.flatMap(({ id, photo, handoff }) =>
          handoff ? [handoff] : photo ? [retire(id, photo)] : [],
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
        handoffs.has(id) ||
        get(id).status === 'preparing'
      )
        return;
      picking = true;
      try {
        const prior = previousPhoto(get(id));
        const previousValidity = prior ? validity.get(id)?.valid : undefined;
        const currentValidity = operations.captureValidity?.() ?? (() => true);
        const valid = () => currentValidity() && (previousValidity?.() ?? true);
        const generation = operations.captureGeneration?.();
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
        validity.set(id, { valid, generation });
        update(id, { status: 'ready', photo: selected });
      } finally {
        picking = false;
        notify();
      }
    },
  };
}
