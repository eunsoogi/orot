import type { ConversationExecutionAdapter } from '../src/ragConversation/conversationExecutionLease';

/** A single synthetic dispatch observes the original native adapter's opaque attempt key. */
export function observeFixtureConversationLease(
  supplied?: ConversationExecutionAdapter,
) {
  const nativeExecution =
    supplied?.bridgeAvailable === true ? supplied : undefined;
  let observedLeaseId: string | undefined;
  let acquiredLease: string | undefined;
  let acquisitions = 0;
  const execution = nativeExecution
    ? {
        ...nativeExecution,
        async begin(id: string) {
          const acquired = await nativeExecution.begin(id);
          if (acquired) {
            acquiredLease = id;
            acquisitions += 1;
          }
          return acquired;
        },
      }
    : supplied;

  return {
    execution,
    async requireActive(signal?: AbortSignal) {
      const leaseId = acquiredLease;
      if (!nativeExecution || !leaseId || acquisitions !== 1)
        throw new Error('Unique native execution lease unavailable.');
      if (
        !(await nativeExecution.isActive(leaseId)) ||
        acquisitions !== 1 ||
        signal?.aborted
      )
        throw new Error('Native execution lease was not acquired.');
      observedLeaseId = leaseId;
    },
    /** Read the exact positively observed lease; never infer a key from SQLite. */
    async state() {
      const leaseId = observedLeaseId;
      const active =
        leaseId && nativeExecution && acquisitions === 1
          ? await nativeExecution.isActive(leaseId)
          : undefined;
      return active === undefined ||
        observedLeaseId !== leaseId ||
        acquisitions !== 1
        ? 'unknown'
        : active
          ? 'active'
          : 'released';
    },
    /** Observe terminal release without treating elapsed time as completion. */
    async waitForRelease() {
      const leaseId = observedLeaseId;
      if (!leaseId || !nativeExecution || acquisitions !== 1)
        throw new Error('Observed lease identity unavailable.');
      while (await nativeExecution.isActive(leaseId)) {
        if (observedLeaseId !== leaseId || acquisitions !== 1)
          throw new Error('Observed lease identity changed.');
        await new Promise<void>(resolve =>
          requestAnimationFrame(() => resolve()),
        );
      }
      if (observedLeaseId !== leaseId || acquisitions !== 1)
        throw new Error('Observed lease identity changed.');
    },
  };
}
