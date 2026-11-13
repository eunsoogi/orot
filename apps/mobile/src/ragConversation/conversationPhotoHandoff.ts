export interface PhotoRequestIdentity {
  readonly sessionId: string;
  readonly sessionVersion: number;
  readonly requestId: string;
  readonly inputRevision: number;
}

/** Holds the staged original until checkpoint ownership is confirmed or its absence is confirmed. */
export function createConversationPhotoHandoffs<T>(input: {
  readonly committed: (id: number, photo: T, removed: boolean) => void;
  readonly rolledBack: (
    id: number,
    photo: T,
    removed: boolean,
  ) => Promise<void>;
}) {
  type Result = { ok: true } | { ok: false; error: unknown };
  type Pending = { removed: boolean; finished: Promise<Result> };
  const active = new Map<number, Pending>();
  return {
    has: (id: number) => active.has(id),
    detach(id: number): Promise<void> | null {
      const pending = active.get(id);
      if (!pending) return null;
      pending.removed = true;
      return pending.finished.then(result => {
        if (!result.ok) throw result.error;
      });
    },
    begin(
      id: number,
      photo: T,
      identity: PhotoRequestIdentity,
      valid: () => boolean,
      generation?: number,
    ) {
      if (
        active.has(id) ||
        !valid() ||
        typeof identity.sessionId !== 'string' ||
        !identity.sessionId ||
        identity.sessionId.length > 200 ||
        typeof identity.requestId !== 'string' ||
        !identity.requestId ||
        identity.requestId.length > 200 ||
        !Number.isSafeInteger(identity.sessionVersion) ||
        identity.sessionVersion < 0 ||
        !Number.isSafeInteger(identity.inputRevision) ||
        identity.inputRevision < 0
      )
        return null;
      let settle!: (result: Result) => void;
      const pending: Pending = {
        removed: false,
        finished: new Promise(resolve => {
          settle = resolve;
        }),
      };
      active.set(id, pending);
      let settled = false;
      const current = () => active.get(id) === pending && !settled;
      return {
        photo,
        identity: Object.freeze({ ...identity }),
        // This epoch fences the live picker; durable deletion generations come from storage.
        ...(generation === undefined ? {} : { stagingGeneration: generation }),
        // Call only after protected storage proves the request owns this exact source.
        commit() {
          if (!current()) return null;
          settled = true;
          if (!valid()) pending.removed = true;
          if (!pending.removed) active.delete(id);
          input.committed(id, photo, pending.removed);
          if (!pending.removed) {
            settle({ ok: true });
            return { photo, removed: false as const };
          }
          // The request owner must retire its checkpoint and file before deletion can finish.
          return {
            photo,
            removed: true as const,
            acknowledgeRemoval(result: Result) {
              if (active.get(id) !== pending) return;
              active.delete(id);
              settle(result);
            },
          };
        },
        // An ambiguous checkpoint must remain locked until the storage owner reconciles it.
        async rollback() {
          if (!current()) return;
          settled = true;
          if (!valid()) pending.removed = true;
          if (!pending.removed) active.delete(id);
          try {
            await input.rolledBack(id, photo, pending.removed);
            if (active.get(id) === pending) active.delete(id);
            settle({ ok: true });
          } catch (error) {
            if (active.get(id) === pending) active.delete(id);
            settle({ ok: false, error });
            throw error;
          }
        },
      };
    },
  };
}
