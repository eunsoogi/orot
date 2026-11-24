import {
  parseConsentAuthorityState as parse,
  type ConsentAuthorityState,
} from './consentAuthorityState';

export type { ConsentAuthorityState } from './consentAuthorityState';
export interface ConsentAuthorityPersistence {
  read(): Promise<unknown>;
  write(state: ConsentAuthorityState): Promise<void>;
}

/** Serializes only this captured authority owner, not all storage or provider work.
 * A durable suspension precedes credential mutation; a durable revocation precedes
 * grant cleanup. Failed writes remain blocked in this process and report failure.
 * If the first durable write fails, restart persistence cannot be promised. */
export function createConsentAuthority(
  persistence: ConsentAuthorityPersistence,
  newGeneration: () => string,
) {
  let tail: Promise<unknown> = Promise.resolve();
  let blocked = false;
  let revision = 0;
  let observedGeneration: string | null = null;
  const listeners = new Set<() => void>();
  const serialized = <T>(work: (owner: number) => Promise<T>) => {
    const owner = ++revision;
    blocked = true;
    observedGeneration = null;
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* Observers cannot block revocation. */
      }
    }
    const next = tail.catch(() => undefined).then(() => work(owner));
    tail = next;
    return next;
  };
  const transition = (status: ConsentAuthorityState['status']) =>
    serialized(async () => {
      blocked = true;
      const next = parse({ version: 1, generation: newGeneration(), status });
      if (!next) throw new Error('Consent authority identity unavailable');
      await persistence.write(next);
      blocked = status !== 'active';
      return next;
    });
  /** Distinguish actual opt-out/absence from inaccessible or changing authority.
   * Only an active state may issue a native settings witness. */
  async function reviewState(observeActive = true) {
    const pending = tail;
    const captured = revision;
    await pending;
    const raw = await persistence.read();
    const current = () => pending === tail && captured === revision;
    if (!current()) return null;
    if (raw === null && !blocked) return { kind: 'unset', current } as const;
    const state = parse(raw);
    if (!state) return null;
    if (state.status === 'active' && observeActive) {
      if (blocked) return null;
      observedGeneration = state.generation;
    }
    return {
      kind: state.status,
      generation: state.generation,
      current: () =>
        current() &&
        (state.status !== 'active' ||
          (!blocked && observedGeneration === state.generation)),
    } as const;
  }
  return {
    reviewState,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async current(): Promise<ConsentAuthorityState | null> {
      await tail.catch(() => undefined);
      if (blocked) return null;
      const owner = tail;
      const state = parse(await persistence.read());
      if (blocked || owner !== tail || state?.status !== 'active') return null;
      observedGeneration = state.generation;
      return state;
    },
    /** Review-only proof of denied authority. A failed read/mutation is not an
     * unchecked setting, and this witness cannot authorize provider dispatch. */
    async reviewInactive(): Promise<(() => boolean) | null> {
      try {
        const state = await reviewState(false);
        return state &&
          (state.kind === 'suspended' || state.kind === 'revoked') &&
          state.current()
          ? state.current
          : null;
      } catch {
        return null;
      }
    },
    /** Synchronous dispatch fence issued only after current() read the durable owner.
     * Any queued mutation invalidates it immediately, before native storage awaits. */
    witness(generation: string): () => boolean {
      const captured = revision;
      const issued = !blocked && observedGeneration === generation;
      return () =>
        issued &&
        !blocked &&
        captured === revision &&
        observedGeneration === generation;
    },
    /** Explicit settings migration only: absent storage is not a malformed or revoked
     * authority. A read-only account refresh must never call this boundary. */
    initializeMissing(stillValid: () => Promise<boolean>) {
      return serialized(async owner => {
        const raw = await persistence.read();
        if (raw !== null) {
          blocked = owner !== revision || parse(raw)?.status !== 'active';
          return false;
        }
        if (!(await stillValid()) || owner !== revision) return false;
        if ((await persistence.read()) !== null) return false;
        const active = parse({
          version: 1,
          generation: newGeneration(),
          status: 'active',
        });
        if (!active) throw new Error('Consent authority identity unavailable');
        await persistence.write(active);
        if (!(await stillValid()) || owner !== revision) {
          await persistence.write({ ...active, status: 'suspended' });
          return false;
        }
        blocked = false;
        return true;
      });
    },
    suspend: () => transition('suspended'),
    /** Read rollback provenance inside the same serialized mutation that advances
     * this owner. A prior snapshot taken before entering the queue can be stale. */
    suspendForJointReplacement(stillValid: () => boolean) {
      return serialized(async owner => {
        const raw = await persistence.read();
        const previous = parse(raw);
        if (
          !stillValid() ||
          owner !== revision ||
          (raw !== null && !previous)
        ) {
          blocked = owner !== revision || previous?.status !== 'active';
          throw new Error('Consent authority owner unavailable');
        }
        const next = parse({
          version: 1,
          generation: newGeneration(),
          status: 'suspended',
        });
        if (!next || next.generation === previous?.generation)
          throw new Error('Consent authority identity unavailable');
        await persistence.write(next);
        return { prior: previous?.status === 'active' ? previous : null, next };
      });
    },
    revoke: () => transition('revoked'),
    /** Only an explicit new settings decision may issue a fresh active generation. */
    activate: () => transition('active'),
    /** Activation is last: committed grant rows remain unusable while suspended.
     * The production composition must reuse this captured owner for all mutations. */
    complete(
      suspension: ConsentAuthorityState,
      stillValid: () => Promise<boolean>,
    ) {
      return serialized(async owner => {
        blocked = true;
        const current = parse(await persistence.read());
        if (
          current?.status !== 'suspended' ||
          current.generation !== suspension.generation ||
          !(await stillValid()) ||
          owner !== revision
        )
          return false;
        const after = parse(await persistence.read());
        if (
          after?.status !== 'suspended' ||
          after.generation !== suspension.generation
        )
          return false;
        const active: ConsentAuthorityState = { ...after, status: 'active' };
        await persistence.write(active);
        if (!(await stillValid()) || owner !== revision) {
          // Preserve an unavailable durable state when ownership changed during the write.
          await persistence.write({ ...active, status: 'suspended' });
          return false;
        }
        blocked = false;
        return true;
      });
    },
    /** Reject a late failed settings operation without changing a newer owner. */
    suspendCurrent(generation: string) {
      return serialized(async () => {
        const current = parse(await persistence.read());
        if (current?.generation !== generation) {
          blocked = current?.status !== 'active';
          return;
        }
        await persistence.write({ ...current, status: 'suspended' });
        blocked = true;
      });
    },
    /** Cancellation may restore an old grant only with a separately proven unchanged
     * credential principal, and only if this exact suspension still owns the state. */
    restore(
      suspension: ConsentAuthorityState,
      prior: ConsentAuthorityState,
      unchanged: () => Promise<boolean>,
    ) {
      return serialized(async owner => {
        blocked = true;
        const current = parse(await persistence.read());
        if (
          current?.status !== 'suspended' ||
          current.generation !== suspension.generation ||
          prior.status !== 'active' ||
          !parse(prior) ||
          !(await unchanged()) ||
          owner !== revision
        )
          return false;
        // Re-read after the asynchronous credential proof to reject a newer durable owner.
        const after = parse(await persistence.read());
        if (
          after?.status !== 'suspended' ||
          after.generation !== suspension.generation
        )
          return false;
        await persistence.write(prior);
        if (owner !== revision) return false;
        blocked = false;
        return true;
      });
    },
  };
}
