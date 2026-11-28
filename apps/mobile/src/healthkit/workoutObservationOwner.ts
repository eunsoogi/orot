type Lease = {
  sync(isCurrent: () => boolean): Promise<unknown>;
};

type Options = {
  foreground(): boolean;
  open(current: () => boolean): Promise<Lease | null>;
  notify(listener: () => void): () => void;
  setNative(active: boolean): void;
};

/** Own an active observation only after the exact persisted opt-in was read.
 * A wake is not a record; serialize it and preserve one trailing invalidation. */
export function createWorkoutObservationOwner(options: Options) {
  let generation = 0;
  let retired = false;
  let pending = false;
  let running = false;
  let lease: Lease | null = null;

  const retire = () => {
    generation++;
    pending = false;
    if (lease) {
      lease = null;
      options.setNative(false);
    }
  };
  const current = (owner: number) =>
    !retired && generation === owner && options.foreground();
  const drain = async () => {
    if (running) return;
    running = true;
    try {
      while (pending && lease) {
        pending = false;
        const active = lease;
        const owner = generation;
        if (!current(owner)) break;
        try {
          await active.sync(() => current(owner) && lease === active);
        } catch {
          // A retired or failed read never has permission to retry itself.
        }
      }
    } finally {
      running = false;
    }
  };
  const unlisten = options.notify(() => {
    if (!lease || !current(generation)) return;
    pending = true;
    drain().catch(() => retire());
  });
  return {
    retire,
    async refresh() {
      retire();
      const owner = generation;
      if (!current(owner)) return;
      try {
        const opened = await options.open(() => current(owner));
        if (!opened || !current(owner)) return;
        lease = opened;
        options.setNative(true);
      } catch {
        if (current(owner)) retire();
      }
    },
    dispose() {
      retired = true;
      retire();
      unlisten();
    },
  };
}
