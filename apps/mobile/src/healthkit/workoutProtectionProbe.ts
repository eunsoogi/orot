/** A restoration event is a reason to discard one stale negative probe, not
 * proof of access. Never reprobe a retired request or wait for more events. */
export function createWorkoutProtectionProbe() {
  let restoration = 0;
  return {
    restored() {
      restoration += 1;
    },
    async confirm(
      current: () => boolean,
      probe: () => Promise<boolean | null>,
    ) {
      const revision = restoration;
      const available = await probe();
      if (!current()) return false;
      if (available === true || restoration === revision) return available;
      return probe();
    },
  };
}
